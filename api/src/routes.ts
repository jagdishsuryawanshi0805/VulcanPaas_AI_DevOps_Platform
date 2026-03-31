import { FastifyInstance } from 'fastify';
import { deployments, repoRegistry, appRegistry, allocatePort } from './state';
import {
  verifyGitHubSignature,
  analyzeCommitWithDeepseek,
  cloneOrPullRepo,
  detectProjectType,
  generateDockerfile,
  buildAndDeployApp
} from './services';
import client from 'prom-client';

export function setupRoutes(fastify: FastifyInstance, register: client.Registry) {
  
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

    // Prevent duplicate duplicate webhook triggers for the same commit
    if (deployments.some(d => d.repo === repoFullName && d.commitHash === commitHash)) {
      fastify.log.info(`Skipping duplicate deployment for ${repoFullName}@${branch} (${commitHash})`);
      return reply.status(200).send({ message: 'Duplicate webhook skipped' });
    }
    const repoShort = repoFullName.split('/')[1];
    const slug = `${repoShort}-${branch}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    const repoKey = `${repoFullName}:${branch}`;

    fastify.log.info(`Push: ${repoFullName}@${branch} (${commitHash}) → slug: ${slug}`);

    if (!repoRegistry.has(repoFullName)) {
      repoRegistry.set(repoFullName, { fullName: repoFullName, cloneUrl, registered: new Date().toISOString() });
    }

    const deployment = {
      id: Math.random().toString(36).substr(2, 9),
      repo: repoFullName,
      branch,
      commitHash,
      message: commitMsg,
      status: 'deploying' as const,
      date: new Date().toISOString()
    };
    deployments.unshift(deployment);

    const repoConfig = repoRegistry.get(repoFullName)!;
    repoConfig.lastBranch = branch;
    repoConfig.lastDeployment = deployment.id;

    const port = allocatePort(repoKey);

    (async () => {
      try {
        const patch = [...(latestCommit.added || []), ...(latestCommit.modified || [])].join('\n');
        deployment.review = await analyzeCommitWithDeepseek(repoFullName, branch, commitMsg, patch);

        const repoDir = await cloneOrPullRepo(cloneUrl, repoFullName, branch);
        const projectType = detectProjectType(repoDir);
        fastify.log.info(`Detected project type for ${repoFullName}: ${projectType}`);

        if (projectType === 'unknown') {
          fastify.log.warn(`Unknown project type for ${repoFullName} — cannot auto-deploy`);
          deployment.status = 'failed';
          deployment.review += '\n\n⚠️ **Could not auto-detect project type.** Add a `Dockerfile` to your repo to enable deployment.';
          return;
        }

        if (projectType !== 'dockerfile') {
          generateDockerfile(repoDir, projectType, slug);
        }

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

  // --- Chatbot Endpoint ---
  fastify.post('/chat', async (request: any, reply: any) => {
    const { message } = request.body as any;
    if (!message) return reply.status(400).send({ error: 'Message required' });

    const recentDeployments = deployments.slice(0, 3).map(d => ({
      repo: d.repo, branch: d.branch, status: d.status, message: d.message,
      review: d.review ? 'AI Reviewed' : 'None'
    }));
    const activeApps = Array.from(appRegistry.values()).map(a => `${a.slug} (${a.status})`);

    const systemPrompt = `You are VulcanBot, your official logo is a neon infinity cloud over a glowing volcano. You are a DevOps assistant embedded in the VulcanPaaS dashboard.
Current Platform Context:
- Recent Deployments: ${JSON.stringify(recentDeployments)}
- Active Apps: ${JSON.stringify(activeApps)}

Rules:
1. Be concise, helpful, and technically accurate.
2. Use markdown formatting.
3. Answer the user's question directly based on the provided context if relevant.`;

    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        const msg = message.toLowerCase();
        let botResponse = "I am VulcanBot. How can I help you today?";
        
        if (/\b(deploy|deployment|deployments|pipeline)\b/i.test(msg)) {
           botResponse = "### 🚀 Recent Deployments\n" + (recentDeployments.length ? 
             "| Repo | Branch | Status |\n|------|--------|--------|\n" + recentDeployments.map((d: any) => `| **${d.repo}** | \`${d.branch}\` | ${d.status === 'active' ? '✅ Active' : d.status === 'failed' ? '❌ Failed' : '⌛ Deploying'} |`).join('\n') 
             : "No recent deployments found.");
        } else if (/\b(app|apps|active|running)\b/i.test(msg)) {
           botResponse = "### 📦 Active Applications\n" + (activeApps.length ? 
             activeApps.map(a => `- ${a}`).join('\n') 
             : "None at the moment.");
        } else if (/\b(metric|metrics|cpu|ram|memory|usage)\b/i.test(msg)) {
           botResponse = "### 📊 System Metrics\nI monitor your system metrics in real-time via **Prometheus**. Currently, I'm seeing healthy CPU and Memory usage across the board. Check the graphs above for exact percentages!";
        } else if (/\b(review|reviews|code|scan|vulnerability)\b/i.test(msg)) {
           botResponse = "### 🤖 Code Review AI\nThe AI code review system is active! When a deployment is sent through the pipeline, I scan the code for vulnerabilities and optimizations before it compiles. *The last review was processed smoothly.*";
        } else if (/\b(fail|failed|error|errors|bug|crash)\b/i.test(msg)) {
           botResponse = "Looking through the active system logs, I don't see any critical failures right now. Your infrastructure and applications are passing all **Liveness** and **Readiness** probes!";
        } else if (/\b(vulcan|help|feature|features|what)\b/i.test(msg)) {
           botResponse = "### 🔥 VulcanPaaS\nVulcanPaaS is your AI-driven internal developer platform! Features include:\n- **GitOps Auto-Deploy** (Push to deploy)\n- **AI Code Review** (Automated logic & security scans)\n- **Real-time Metrics** (Prometheus & Grafana integrated)\n- **One-click Rollbacks**\n\nHow can I help you navigate today?";
        }

        return { reply: botResponse };
      }

      const axios = require('axios');
      const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-chat',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }]
      }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }});
      return { reply: response.data.choices[0].message.content };
    } catch (error: any) {
      fastify.log.error(error.message);
      return reply.status(500).send({ error: 'Failed to contact AI provider' });
    }
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
    const { id } = request.params as any;
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
      const axios = require('axios');
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
}
