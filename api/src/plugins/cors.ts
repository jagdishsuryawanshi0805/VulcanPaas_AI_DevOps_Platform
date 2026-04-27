import { FastifyInstance } from 'fastify';

export function setupCors(fastify: FastifyInstance) {
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
}
