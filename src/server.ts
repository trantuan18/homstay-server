import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();

try {
  await app.listen({
    port: env.PORT,
    host: '0.0.0.0',
  });

  console.log(`Server running on http://localhost:${env.PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
