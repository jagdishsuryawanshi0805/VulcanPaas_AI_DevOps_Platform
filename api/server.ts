import Fastify from 'fastify';
import client from 'prom-client';
import dotenv from 'dotenv';
import { syncGitHubWebhooks } from './src/services';
import { setupRoutes } from './src/routes';

dotenv.config();

const fastify = Fastify({ logger: true });

// --- Auto Webhook Sync ---
syncGitHubWebhooks();
setInterval(syncGitHubWebhooks, 5 * 60 * 1000);

// --- Prometheus Metrics Setup ---
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

// --- CORS Configuration ---
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

// --- Link the Routes ---
setupRoutes(fastify, register);

// --- Boot Server ---
fastify.listen({ port: 5000, host: '0.0.0.0' }, (err: any) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  fastify.log.info('🚀 VulcanPaaS API running on port 5000');
});
