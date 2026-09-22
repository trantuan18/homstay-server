import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

// import { healthRoute } from './routes/health.route.js';
import { authRoute } from './routes/auth.route.js';
import { propertiesRoute } from './routes/properties.route.js';
import { roomsRoute } from './routes/rooms.route.js';
import { roomImagesRoute } from './routes/room-images.route.js';
import { amenitiesRoute } from './routes/amenities.route.js';
import { pricingRulesRoute } from './routes/pricing-rules.route.js';
import { blockedPeriodsRoute } from './routes/blocked-periods.route.js';
import { availabilityRoute } from './routes/availability.route.js';
import { bookingsRoute } from './routes/bookings.route.js';
import { bookingDetailRoute } from './routes/booking-detail.route.js';
import { roomImageUploadRoute } from './routes/room-image-upload.route.js';
import { paymentsRoute } from './routes/payments.route.js';
import { reviewsRoute } from './routes/reviews.route.js';
import { searchRoute } from './routes/search.route.js';
import { adminUsersRoute } from './routes/admin-users.route.js';
import { adminPaymentRoute } from './routes/admin-payment.route.js';
import { adminBookingsRoute } from './routes/admin-bookings.route.js';
import { adminPropertiesRoute,} from './routes/admin-properties.route.js';
import { adminRoomsRoute,} from './routes/admin-rooms.route.js';
import { adminDashboardRoute } from './routes/admin-dashboard.route.js';
import { adminAnalyticsRoute } from './routes/admin-analytics.route.js';
import { adminOccupancyRoute } from './routes/admin-occupancy.route.js';
export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(helmet);

  await app.register(cors, {
    origin: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Homestay Booking API',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // await app.register(healthRoute);
  await app.register(authRoute);

  await app.register(propertiesRoute);
  await app.register(roomsRoute);
  await app.register(roomImagesRoute);
  await app.register(amenitiesRoute);
  await app.register(pricingRulesRoute);
  await app.register(blockedPeriodsRoute);  
  await app.register(availabilityRoute);

  await app.register(bookingsRoute);
  await app.register(bookingDetailRoute);
  await app.register(paymentsRoute);
  await app.register(reviewsRoute);
  await app.register(roomImageUploadRoute);

  await app.register(adminBookingsRoute);
  await app.register(adminPaymentRoute);
  await app.register(adminUsersRoute);
  await app.register(adminPropertiesRoute,);
  await app.register(adminRoomsRoute,);
  await app.register(adminDashboardRoute);
  await app.register(adminAnalyticsRoute);
  await app.register(adminOccupancyRoute);

  await app.register(searchRoute);
  return app;
}
