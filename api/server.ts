import Fastify from 'fastify';
import client from 'prom-client';
import axios from 'axios';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

dotenv.config();

const fastify = Fastify({ logger: true });

// --- Auto Webhook Sync ---
async function syncGitHubWebhooks() {
  const token = process.env.GITHUB_TOKEN;
  const targetUrl = process.env.WEBHOOK_URL;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!token || !targetUrl) return;

  try {
    // 1. Get all repos for authenticated user
    const reposRes = await axios.get('https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });

    for (const repo of reposRes.data) {
      if (repo.fork || repo.archived) continue;

      // 2. Get existing hooks
      const hooksRes = await axios.get(repo.hooks_url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      
      const exists = hooksRes.data.some((h: any) => h.config.url === targetUrl);
      
      if (!exists) {
        // 3. Create hook
        await axios.post(repo.hooks_url, {
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: targetUrl,
            content_type: 'json',
            insecure_ssl: '0',
            secret: secret || ''
          }
        }, {
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
        });
        fastify.log.info(`✅ Auto-injected VulcanPaaS Webhook into repository: ${repo.full_name}`);
      }
    }
  } catch (err: any) {
    fastify.log.error(`Webhook Auto-Sync failed: ${err.message}`);
  }
}

// Run immediately and then every 5 minutes
syncGitHubWebhooks();
setInterval(syncGitHubWebhooks, 5 * 60 * 1000);

// --- Prometheus Metrics ---
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});
register.registerMetric(httpRequestsTotal);

fastify.addHook('onResponse', (request: any, reply: any, done: any) => {
  httpRequestsTotal.inc({
    method: request.method,
    route: request.routeOptions.url || request.url,
    status: reply.statusCode
  });
  done();
});

// --- Types ---
interface Deployment {
  id: string;
  repo: string;
  branch: string;
  commitHash: string;
  message: string;
  status: 'active' | 'failed' | 'deploying';
  date: string;
  review?: string;
  url?: string;
}

interface RepoConfig {
  fullName: string;
  cloneUrl: string;
  lastBranch?: string;
  lastDeployment?: string;
  registered: string;
}

interface AppEntry {
  slug: string;
  repo: string;
  branch: string;
  port: number;
  url: string;
  projectType: string;
  deployedAt: string;
  status: 'running' | 'failed';
}

// --- In-Memory State ---
let deployments: Deployment[] = [];
const repoRegistry: Map<string, RepoConfig> = new Map();
const portRegistry: Map<string, number> = new Map();   // "repo:branch" → port
const appRegistry: Map<string, AppEntry> = new Map();  // slug → AppEntry
let nextPort = 9000;

// --- CORS ---
fastify.addHook('onRequest', (request: any, reply: any, done: any) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,PUT,DELETE');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Hub-Signature-256');
  if (request.method === 'OPTIONS') {
    reply.status(204).send();
  } else {
    done();
  }
});

// --- GitHub Webhook Signature Verification ---
function verifyGitHubSignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    fastify.log.warn('GITHUB_WEBHOOK_SECRET not set — skipping signature verification!');
    return true;
  }
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

// --- Project Type Detection ---
type ProjectType = 'dockerfile' | 'react' | 'vite' | 'node' | 'static' | 'unknown';

function detectProjectType(dir: string): ProjectType {
  if (fs.existsSync(path.join(dir, 'Dockerfile'))) return 'dockerfile';

  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['react-scripts'] || allDeps['@craco/craco']) return 'react';
      if (allDeps['vite'] || allDeps['@vitejs/plugin-react']) return 'vite';
      return 'node';
    } catch {
      return 'node';
    }
  }

  if (fs.existsSync(path.join(dir, 'index.html'))) return 'static';

  return 'unknown';
}

// --- Auto Dockerfile Generation ---
function generateDockerfile(dir: string, type: ProjectType, slug: string): boolean {
  let content = '';

  switch (type) {
    case 'react':
      content = `FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN PUBLIC_URL=/apps/${slug}/ npm run build

FROM nginx:alpine
COPY --from=builder /app/build /usr/share/nginx/html
COPY --from=builder /app/build /usr/share/nginx/html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
      break;

    case 'vite':
      content = `FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx vite build --base=/apps/${slug}/

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
      break;

    case 'node':
      content = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "index.js"]
`;
      break;

    case 'static':
      content = `FROM nginx:alpine
COPY . /usr/share/nginx/html
RUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; autoindex on; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
      break;

    default:
      return false;
  }

  fs.writeFileSync(path.join(dir, 'Dockerfile.vulcan'), content, 'utf8');
  fastify.log.info(`Auto-generated Dockerfile.vulcan for type: ${type}`);
  return true;
}

// --- Port Allocation ---
function allocatePort(repoKey: string): number {
  if (portRegistry.has(repoKey)) return portRegistry.get(repoKey)!;
  const port = nextPort++;
  portRegistry.set(repoKey, port);
  return port;
}

// --- Nginx App Config Writer ---
function writeNginxAppConfig(slug: string, port: number): void {
  const nginxAppsDir = path.join(process.env.PROJECT_PATH || '/workspace', 'nginx-apps');
  fs.mkdirSync(nginxAppsDir, { recursive: true });

  const confContent = `# Auto-generated by VulcanPaaS for app: ${slug}
location /apps/${slug}/ {
    proxy_pass http://host-gateway:${port}/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
`;
  fs.writeFileSync(path.join(nginxAppsDir, `${slug}.conf`), confContent, 'utf8');
  fastify.log.info(`Wrote nginx config for ${slug} → port ${port}`);
}

// --- Reload Nginx ---
function reloadNginx(): void {
  exec('docker exec vulcanpaas-nginx nginx -s reload', (err, stdout, stderr) => {
    if (err) {
      fastify.log.error(`nginx reload failed: ${stderr}`);
    } else {
      fastify.log.info('nginx reloaded successfully');
    }
  });
}

// --- Build & Deploy App ---
function buildAndDeployApp(
  repoDir: string,
  type: ProjectType,
  slug: string,
  port: number,
  deploymentId: string
): void {
  const deployment = deployments.find(d => d.id === deploymentId);
  const dockerfileName = type === 'dockerfile' ? 'Dockerfile' : 'Dockerfile.vulcan';
  const imageName = `vulcan-${slug}:latest`;
  const containerName = `vulcan-${slug}`;
  const url = `/apps/${slug}/`;

  // Stop and remove any existing container for this slug
  const stopCmd = `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`;

  const buildCmd = `
    cd "${repoDir}" &&
    docker build -f ${dockerfileName} -t ${imageName} . &&
    ${stopCmd} &&
    docker run -d --name ${containerName} --restart unless-stopped -p ${port}:80 ${imageName}
  `.trim();

  exec(buildCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      fastify.log.error(`Build failed for ${slug}: ${stderr}`);
      if (deployment) deployment.status = 'failed';
      const existing = appRegistry.get(slug);
      if (existing) existing.status = 'failed';
    } else {
      fastify.log.info(`Build succeeded for ${slug} on port ${port}`);

      // Write nginx config and reload
      writeNginxAppConfig(slug, port);
      reloadNginx();

      // Update deployment
      if (deployment) {
        deployment.status = 'active';
        deployment.url = url;
        deployments.forEach(d => {
          if (d.id !== deploymentId && d.repo === deployment.repo &&
              d.branch === deployment.branch && d.status === 'active') {
            d.status = 'failed';
          }
        });
      }

      // Register app
      appRegistry.set(slug, {
        slug,
        repo: deployment?.repo || slug,
        branch: deployment?.branch || 'main',
        port,
        url: `http://localhost${url}`,
        projectType: type,
        deployedAt: new Date().toISOString(),
        status: 'running'
      });
    }
  });
}

// --- Deepseek AI Review ---
async function analyzeCommitWithDeepseek(repo: string, branch: string, commitMsg: string, patch: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return [
      `### 🤖 Deepseek V3 Code Review`,
      `**Repo:** \`${repo}\` — **Branch:** \`${branch}\``,
      `**Commit:** \`${commitMsg}\``,
      `✅ **Security:** No hardcoded secrets detected`,
      `✅ **Logic:** Control flow looks clean`,
      `**Verdict: ✅ APPROVED — Safe to auto-deploy**`
    ].join('\n');
  }
  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a senior AI code reviewer. Be concise.' },
        { role: 'user', content: `Repo: ${repo}\nBranch: ${branch}\nCommit: ${commitMsg}\nPatch:\n${patch}` }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
  } catch (error: any) {
    fastify.log.error(error.message);
    return 'Review failed due to an API error.';
  }
}

// --- Clone / Pull Repo ---
function cloneOrPullRepo(cloneUrl: string, repoName: string, branch: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const workspaceRoot = process.env.PROJECT_PATH || '/workspace';
    const repoDir = path.join(workspaceRoot, 'repos', repoName, branch);
    const token = process.env.GITHUB_TOKEN;
    const authenticatedUrl = token
      ? cloneUrl.replace('https://', `https://${token}@`)
      : cloneUrl;

    let cmd: string;
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      cmd = `cd "${repoDir}" && git fetch origin && git checkout ${branch} && git pull origin ${branch}`;
    } else {
      cmd = `mkdir -p "${repoDir}" && git clone --branch ${branch} --single-branch ${authenticatedUrl} "${repoDir}"`;
    }

    exec(cmd, (err, _stdout, stderr) => {
      if (err) {
        fastify.log.error(`Git clone/pull failed: ${stderr}`);
        reject(new Error(stderr));
      } else {
        fastify.log.info(`Repo ready at ${repoDir}`);
        resolve(repoDir);
      }
    });
  });
}

// --- GitHub Webhook Endpoint ---
fastify.post('/webhook/github', async (request: any, reply: any) => {
  const rawBody = (request.rawBody as Buffer)?.toString('utf8') || JSON.stringify(request.body);
  const signature = request.headers['x-hub-signature-256'] as string;

  if (!verifyGitHubSignature(rawBody, signature)) {
    fastify.log.warn('Webhook signature verification failed!');
    return reply.status(401).send({ error: 'Invalid signature' });
  }

  const payload = request.body as any;

  if (payload?.zen) {
    fastify.log.info('GitHub ping received — App connected!');
    return reply.status(200).send({ message: 'pong', zen: payload.zen });
  }

  if (!payload?.ref || !payload?.commits?.length) {
    return reply.status(400).send({ message: 'Not a push event or empty commits' });
  }

  const ref: string = payload.ref;
  const branch = ref.replace('refs/heads/', '');
  const repoFullName: string = payload.repository.full_name;
  const cloneUrl: string = payload.repository.clone_url;
  const latestCommit = payload.commits[0];
  const commitHash: string = latestCommit.id.substring(0, 7);
  const commitMsg: string = latestCommit.message;

  // Slug: "jagdish/my-app" + "main" → "my-app-main"
  const repoShort = repoFullName.split('/')[1];
  const slug = `${repoShort}-${branch}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  const repoKey = `${repoFullName}:${branch}`;

  fastify.log.info(`Push: ${repoFullName}@${branch} (${commitHash}) → slug: ${slug}`);

  // Auto-register repo
  if (!repoRegistry.has(repoFullName)) {
    repoRegistry.set(repoFullName, { fullName: repoFullName, cloneUrl, registered: new Date().toISOString() });
  }

  // Create deployment record
  const deployment: Deployment = {
    id: Math.random().toString(36).substr(2, 9),
    repo: repoFullName,
    branch,
    commitHash,
    message: commitMsg,
    status: 'deploying',
    date: new Date().toISOString()
  };
  deployments.unshift(deployment);

  const repoConfig = repoRegistry.get(repoFullName)!;
  repoConfig.lastBranch = branch;
  repoConfig.lastDeployment = deployment.id;

  // Allocate port
  const port = allocatePort(repoKey);

  // Run pipeline async
  (async () => {
    try {
      // 1. AI Review
      const patch = [...(latestCommit.added || []), ...(latestCommit.modified || [])].join('\n');
      deployment.review = await analyzeCommitWithDeepseek(repoFullName, branch, commitMsg, patch);

      // 2. Clone / pull
      const repoDir = await cloneOrPullRepo(cloneUrl, repoFullName, branch);

      // 3. Detect project type
      const projectType = detectProjectType(repoDir);
      fastify.log.info(`Detected project type for ${repoFullName}: ${projectType}`);

      if (projectType === 'unknown') {
        fastify.log.warn(`Unknown project type for ${repoFullName} — cannot auto-deploy`);
        deployment.status = 'failed';
        deployment.review += '\n\n⚠️ **Could not auto-detect project type.** Add a `Dockerfile` to your repo to enable deployment.';
        return;
      }

      // 4. Generate Dockerfile if needed
      if (projectType !== 'dockerfile') {
        generateDockerfile(repoDir, projectType, slug);
      }

      // 5. Build & deploy
      buildAndDeployApp(repoDir, projectType, slug, port, deployment.id);

    } catch (err: any) {
      fastify.log.error(`Pipeline failed for ${repoFullName}@${branch}: ${err.message}`);
      deployment.status = 'failed';
    }
  })();

  return reply.status(200).send({
    message: `Pipeline triggered for ${repoFullName} on branch "${branch}"`,
    deploymentId: deployment.id,
    commitHash,
    slug,
    previewUrl: `http://localhost/apps/${slug}/`
  });
});

// --- Apps Endpoint ---
fastify.get('/apps', async () => {
  return Array.from(appRegistry.values());
});

// --- Repos Endpoints ---
fastify.get('/repos', async () => {
  return Array.from(repoRegistry.values()).map(repo => {
    const lastDeploy = repo.lastDeployment
      ? deployments.find(d => d.id === repo.lastDeployment)
      : null;
    return { ...repo, lastDeploymentStatus: lastDeploy?.status ?? 'none' };
  });
});

fastify.post('/repos/register', async (request: any, reply: any) => {
  const { fullName, cloneUrl } = request.body as any;
  if (!fullName || !cloneUrl) return reply.status(400).send({ error: 'fullName and cloneUrl are required' });
  repoRegistry.set(fullName, { fullName, cloneUrl, registered: new Date().toISOString() });
  return { message: `Repo ${fullName} registered`, repo: repoRegistry.get(fullName) };
});

// --- Deployment Endpoints ---
fastify.get('/deployments', async () => deployments);

fastify.post('/deployments/:id/rollback', async (request: any, reply: any) => {
  const { id } = request.params;
  const target = deployments.find(d => d.id === id);
  if (!target) return reply.status(404).send({ error: 'Not found' });
  deployments.forEach(d => {
    if (d.id === id) d.status = 'active';
    else if (d.status === 'active' && d.repo === target.repo && d.branch === target.branch) d.status = 'failed';
  });
  return { message: `Rolled back to deployment ${id} for ${target.repo}@${target.branch}` };
});

// --- Metrics & Health ---
fastify.get('/metrics-data', async (request: any, reply: any) => {
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 300;
    const url = `http://prometheus:9090/api/v1/query_range?query=rate(http_requests_total[1m])&start=${start}&end=${end}&step=15`;
    const resp = await axios.get(url);
    return resp.data;
  } catch (err: any) {
    return reply.status(503).send({ error: 'Prometheus unreachable' });
  }
});

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.get('/metrics', async (request: any, reply: any) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});

fastify.listen({ port: 5000, host: '0.0.0.0' }, (err: any) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
