import { buildApp } from './app.js';
import { env } from './config/env.js';
import { pricingPlanService } from './services/pricing-plan.service.js';

const app = await buildApp();

try {
  await app.listen({
    port: env.PORT,
    host: '0.0.0.0',
  });

  console.log(`Server running on http://localhost:${env.PORT}`);

  // Synchronize pricing plans to database in background
  pricingPlanService.syncAllPropertiesToDatabase().catch((err) => {
    console.error('Initial DB pricing sync error:', err);
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
