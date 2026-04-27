import { FastifyInstance } from 'fastify';
import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});
register.registerMetric(httpRequestsTotal);

export function setupMetrics(fastify: FastifyInstance) {
  fastify.addHook('onResponse', (request: any, reply: any, done: any) => {
    httpRequestsTotal.inc({
      method: request.method,
      route: request.routeOptions?.url || request.url,
      status: reply.statusCode
    });
    done();
  });
}
