import type { FastifyInstance } from 'fastify';

export async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => {
    return {
      success: true,
      service: 'homestay-server',
      timestamp: new Date().toISOString(),
    };
  });
}
