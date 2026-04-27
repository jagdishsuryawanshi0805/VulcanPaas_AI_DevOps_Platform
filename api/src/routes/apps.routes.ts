import { FastifyInstance } from 'fastify';
import { appRegistry } from '../state/memory';

export default async function appsRoutes(fastify: FastifyInstance) {
  fastify.get('/apps', async () => {
    return Array.from(appRegistry.values());
  });
}
