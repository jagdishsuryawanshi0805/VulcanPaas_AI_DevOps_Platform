import Fastify from 'fastify';
import dotenv from 'dotenv';
import { syncGitHubWebhooks } from './src/services/github';
import { setupMetrics } from './src/plugins/metrics';
import { setupCors } from './src/plugins/cors';

import webhookRoutes from './src/routes/webhook.routes';
import chatRoutes from './src/routes/chat.routes';
import appsRoutes from './src/routes/apps.routes';
import reposRoutes from './src/routes/repos.routes';
import deploymentsRoutes from './src/routes/deployments.routes';
import healthRoutes from './src/routes/health.routes';

dotenv.config();

const fastify = Fastify({ logger: true });

// --- System Plugins ---
setupCors(fastify);
setupMetrics(fastify);

// --- Routes ---
fastify.register(webhookRoutes);
fastify.register(chatRoutes);
fastify.register(appsRoutes);
fastify.register(reposRoutes);
fastify.register(deploymentsRoutes);
fastify.register(healthRoutes);

// --- Auto Webhook Sync ---
syncGitHubWebhooks();
setInterval(syncGitHubWebhooks, 5 * 60 * 1000);

// --- Boot Server ---
fastify.listen({ port: 5000, host: '0.0.0.0' }, (err: any) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info('🚀 VulcanPaaS API running on port 5000');
});
