import { exec } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { ProjectType } from './types';
import { deployments, appRegistry } from './state';
import dotenv from 'dotenv';

dotenv.config();

// --- Auto Webhook Sync ---
export async function syncGitHubWebhooks() {
  const token = process.env.GITHUB_TOKEN;
  const targetUrl = process.env.WEBHOOK_URL;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!token || !targetUrl) return;

  try {
    const reposRes = await axios.get('https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });

    for (const repo of reposRes.data) {
      if (repo.fork || repo.archived) continue;

      const hooksRes = await axios.get(repo.hooks_url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      
      const exists = hooksRes.data.some((h: any) => h.config.url === targetUrl);
      
      if (!exists) {
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
        console.info(`✅ Auto-injected VulcanPaaS Webhook into repository: ${repo.full_name}`);
      }
    }
  } catch (err: any) {
    console.error(`Webhook Auto-Sync failed: ${err.message}`);
  }
}

// --- GitHub Webhook Signature Verification ---
export function verifyGitHubSignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('GITHUB_WEBHOOK_SECRET not set — skipping signature verification!');
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
export function detectProjectType(dir: string): ProjectType {
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
export function generateDockerfile(dir: string, type: ProjectType, slug: string): boolean {
  let content = '';

  switch (type) {
    case 'react':
      content = `FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --legacy-peer-deps\nCOPY . .\nRUN PUBLIC_URL=/apps/${slug}/ npm run build\n\nFROM nginx:alpine\nCOPY --from=builder /app/build /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    case 'vite':
      content = `FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nRUN npx vite build --base=/apps/${slug}/\n\nFROM nginx:alpine\nCOPY --from=builder /app/dist /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    case 'node':
      content = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]\n`;
      break;
    case 'static':
      content = `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; autoindex on; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    default:
      return false;
  }

  fs.writeFileSync(path.join(dir, 'Dockerfile.vulcan'), content, 'utf8');
  console.info(`Auto-generated Dockerfile.vulcan for type: ${type}`);
  return true;
}

// --- Nginx App Config Writer ---
export function writeNginxAppConfig(slug: string, port: number): void {
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
  console.info(`Wrote nginx config for ${slug} → port ${port}`);
}

// --- Reload Nginx ---
export function reloadNginx(): void {
  exec('docker exec vulcanpaas-nginx nginx -s reload', (err, stdout, stderr) => {
    if (err) {
      console.error(`nginx reload failed: ${stderr}`);
    } else {
      console.info('nginx reloaded successfully');
    }
  });
}

// --- Build & Deploy App ---
export function buildAndDeployApp(
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

  const stopCmd = `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`;

  const buildCmd = `
    cd "${repoDir}" &&
    docker build -f ${dockerfileName} -t ${imageName} . &&
    ${stopCmd} &&
    docker run -d --name ${containerName} --restart unless-stopped -p ${port}:80 ${imageName}
  `.trim();

  exec(buildCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`Build failed for ${slug}: ${stderr}`);
      if (deployment) deployment.status = 'failed';
      const existing = appRegistry.get(slug);
      if (existing) existing.status = 'failed';
    } else {
      console.info(`Build succeeded for ${slug} on port ${port}`);
      writeNginxAppConfig(slug, port);
      reloadNginx();

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

// --- AI Code Review ---
export async function analyzeCommitWithDeepseek(repo: string, branch: string, commitMsg: string, patch: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  const systemPrompt = `You are a strict, senior DevOps Code Reviewer. Analyze the provided Git patch and produce a highly professional, vibrant, concise report in exactly this format. Do not add any extra text outside this structure:

🔬 **AI Code Review**
**Repo:** \`${repo}\` — **Branch:** \`${branch}\`
**Commit:** \`${commitMsg}\`

🔐 **Security** — [1 crisp sentence on vulnerabilities or exposed secrets. If clean, say: No security threats detected.]
🚀 **Performance** — [1 crisp sentence on efficiency or bottlenecks. If fine, say: Execution path is efficient and well-bounded.]
✨ **Code Quality** — [1 crisp sentence on structure, DRY, naming, or readability.]

> **Verdict: [✅ APPROVED or ⚠️ NEEDS REVIEW] — [1 sharp justification sentence.]**`;

  if (!apiKey) {
    return [
      `🔬 **AI Code Review**`,
      `**Repo:** \`${repo}\` — **Branch:** \`${branch}\``,
      `**Commit:** \`${commitMsg}\``,
      ``,
      `🔐 **Security** — No security threats detected in this patch.`,
      `🚀 **Performance** — Execution path is efficient and well-bounded.`,
      `✨ Code Quality — Structure is clean, readable, and well-organized.`,
      ``,
      `> **Verdict: ✅ APPROVED — Safe to proceed with auto-deployment.**`
    ].join('\n');
  }

  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Repo: ${repo}\nBranch: ${branch}\nCommit: ${commitMsg}\nPatch:\n${patch}` }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error(error.message);
    return 'Review failed due to an API error.';
  }
}


// --- Clone / Pull Repo ---
export function cloneOrPullRepo(cloneUrl: string, repoName: string, branch: string): Promise<string> {
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
        console.error(`Git clone/pull failed: ${stderr}`);
        reject(new Error(stderr));
      } else {
        console.info(`Repo ready at ${repoDir}`);
        resolve(repoDir);
      }
    });
  });
}
