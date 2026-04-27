import { FastifyInstance } from 'fastify';
import axios from 'axios';
import { register } from '../plugins/metrics';

export default async function healthRoutes(fastify: FastifyInstance) {
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
}
