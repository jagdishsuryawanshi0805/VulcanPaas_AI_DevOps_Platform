import { FastifyInstance } from 'fastify';
import { repoRegistry, deployments } from '../state/memory';

export default async function reposRoutes(fastify: FastifyInstance) {
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
}
