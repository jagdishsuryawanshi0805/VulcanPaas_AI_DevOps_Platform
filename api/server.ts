import Fastify from 'fastify';
import client from 'prom-client';

const fastify = Fastify({ logger: true });

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});
register.registerMetric(httpRequestsTotal);

fastify.addHook('onResponse', (request, reply, done) => {
  httpRequestsTotal.inc({
    method: request.method,
    route: request.routeOptions.url || request.url,
    status: reply.statusCode
  });
  done();
});

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.get('/metrics', async (request, reply) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});

fastify.listen({ port: 5000, host: '0.0.0.0' }, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
});
