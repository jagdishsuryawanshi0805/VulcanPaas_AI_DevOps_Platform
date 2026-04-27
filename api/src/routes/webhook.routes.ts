import { FastifyInstance } from 'fastify';
import { deployments, repoRegistry, allocatePort } from '../state/memory';
import { verifyGitHubSignature, cloneOrPullRepo } from '../services/github';
import { detectProjectType, generateDockerfile, readVulcanConfig } from '../services/project';
import { isDomainAllowed, writeDomainNginxConfig, reloadNginx } from '../services/nginx';
import { buildAndDeployApp } from '../services/docker';
import { analyzeCommitWithDeepseek } from '../services/security';

export default async function webhookRoutes(fastify: FastifyInstance) {
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
      date: new Date().toISOString(),
      review: '',
      url: ''
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

        const vulcanConfig = readVulcanConfig(repoDir);
        if (vulcanConfig.domain) {
          if (isDomainAllowed(vulcanConfig.domain)) {
            fastify.log.info(`Custom domain detected: ${vulcanConfig.domain} → port ${port}`);
            writeDomainNginxConfig(vulcanConfig.domain, port);
            reloadNginx();
            deployment.url = `https://${vulcanConfig.domain}/`;
          } else {
            fastify.log.warn(`Domain "${vulcanConfig.domain}" rejected — not in ALLOWED_DOMAINS.`);
            deployment.review += `\n\n⚠️ **Domain Rejected:** \`${vulcanConfig.domain}\` is not in the platform's allowed domain list. Update \`ALLOWED_DOMAINS\` in VulcanPaaS \.env to enable this domain.`;
          }
        }

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
      previewUrl: `http://localhost/apps/${slug}/`,
      customDomain: 'Detected from vulcan.json after repo clone — check deployment status'
    });
  });
}
