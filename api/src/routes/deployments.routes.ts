import { FastifyInstance } from 'fastify';
import { deployments } from '../state/memory';

export default async function deploymentsRoutes(fastify: FastifyInstance) {
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
}
