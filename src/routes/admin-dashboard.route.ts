import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import {
  supabaseAdmin,
  createUserSupabaseClient,
} from '../lib/supabase.js';

async function requireAdmin(
  request: any,
  reply: any,
) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      message: 'Missing access token',
    });
    return null;
  }

  const token = authHeader.substring(7);

  const userClient = createUserSupabaseClient(token);

  const {
    data,
    error,
  } = await userClient.rpc('is_admin');

  if (error || data !== true) {
    reply.code(403).send({
      success: false,
      message: 'ADMIN_REQUIRED',
    });
    return null;
  }

  return true;
}

export async function adminDashboardRoute(
  app: FastifyInstance,
) {
  /**
   * GET /api/admin/dashboard
   */
  app.get(
    '/api/admin/dashboard',
    { preHandler: authenticate },
    async (request, reply) => {
      const isAdmin = await requireAdmin(
        request,
        reply,
      );

      if (!isAdmin) return;

      const query = request.query as {
        property_id?: string;
        from?: string;
        to?: string;
      };

      /*
       * Mặc định thống kê từ đầu tháng
       * đến thời điểm hiện tại.
       */
      const now = new Date();

      const defaultFrom = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      const from =
        query.from ??
        defaultFrom.toISOString();

      const to =
        query.to ??
        now.toISOString();

      /*
       * =========================
       * BOOKINGS
       * =========================
       */

      let bookingsQuery = supabaseAdmin
        .from('bookings')
        .select(
          `
          id,
          status,
          payment_status,
          total,
          currency,
          start_at,
          end_at,
          property_id,
          room_id
        `,
        )
        .gte('created_at', from)
        .lte('created_at', to);

      if (query.property_id) {
        bookingsQuery = bookingsQuery.eq(
          'property_id',
          query.property_id,
        );
      }

      const {
        data: bookings,
        error: bookingsError,
      } = await bookingsQuery;

      if (bookingsError) {
        return reply.code(500).send({
          success: false,
          message: bookingsError.message,
        });
      }

      const bookingRows = bookings ?? [];

      /*
       * =========================
       * BOOKING COUNTS
       * =========================
       */

      const bookingStats = {
        total: bookingRows.length,
        pending: 0,
        confirmed: 0,
        checked_in: 0,
        checked_out: 0,
        cancelled: 0,
        expired: 0,
        no_show: 0,
      };

      for (const booking of bookingRows) {
        switch (booking.status) {
          case 'PENDING':
            bookingStats.pending++;
            break;

          case 'CONFIRMED':
            bookingStats.confirmed++;
            break;

          case 'CHECKED_IN':
            bookingStats.checked_in++;
            break;

          case 'CHECKED_OUT':
            bookingStats.checked_out++;
            break;

          case 'CANCELLED':
            bookingStats.cancelled++;
            break;

          case 'EXPIRED':
            bookingStats.expired++;
            break;

          case 'NO_SHOW':
            bookingStats.no_show++;
            break;
        }
      }

      /*
       * =========================
       * REVENUE
       * =========================
       *
       * Chỉ tính booking:
       * CONFIRMED
       * CHECKED_IN
       * CHECKED_OUT
       *
       * và payment đã PAID/PARTIAL.
       */

      let revenue = 0;
      let paidRevenue = 0;
      let partialRevenue = 0;

      for (const booking of bookingRows) {
        const total = Number(booking.total ?? 0);

        if (
          booking.status === 'CONFIRMED' ||
          booking.status === 'CHECKED_IN' ||
          booking.status === 'CHECKED_OUT'
        ) {
          revenue += total;
        }

        if (booking.payment_status === 'PAID') {
          paidRevenue += total;
        }

        if (
          booking.payment_status === 'PARTIAL'
        ) {
          partialRevenue += total;
        }
      }

      /*
       * =========================
       * PROPERTIES
       * =========================
       */

      let propertiesQuery = supabaseAdmin
        .from('properties')
        .select('id, status');

      if (query.property_id) {
        propertiesQuery = propertiesQuery.eq(
          'id',
          query.property_id,
        );
      }

      const {
        data: properties,
        error: propertiesError,
      } = await propertiesQuery;

      if (propertiesError) {
        return reply.code(500).send({
          success: false,
          message: propertiesError.message,
        });
      }

      const propertyRows = properties ?? [];

      const propertyStats = {
        total: propertyRows.length,
        active: propertyRows.filter(
          (p) => p.status === 'ACTIVE',
        ).length,
        inactive: propertyRows.filter(
          (p) => p.status === 'INACTIVE',
        ).length,
        suspended: propertyRows.filter(
          (p) => p.status === 'SUSPENDED',
        ).length,
      };

      /*
       * =========================
       * ROOMS
       * =========================
       */

      let roomsQuery = supabaseAdmin
        .from('rooms')
        .select('id, status, property_id');

      if (query.property_id) {
        roomsQuery = roomsQuery.eq(
          'property_id',
          query.property_id,
        );
      }

      const {
        data: rooms,
        error: roomsError,
      } = await roomsQuery;

      if (roomsError) {
        return reply.code(500).send({
          success: false,
          message: roomsError.message,
        });
      }

      const roomRows = rooms ?? [];

      const roomStats = {
        total: roomRows.length,
        available: roomRows.filter(
          (r) => r.status === 'AVAILABLE',
        ).length,
        maintenance: roomRows.filter(
          (r) => r.status === 'MAINTENANCE',
        ).length,
        inactive: roomRows.filter(
          (r) => r.status === 'INACTIVE',
        ).length,
      };

      /*
       * =========================
       * PAYMENTS
       * =========================
       */

      let paymentsQuery = supabaseAdmin
        .from('payments')
        .select(
          'id, amount, status, currency, booking_id',
        )
        .gte('created_at', from)
        .lte('created_at', to);

      const {
        data: payments,
        error: paymentsError,
      } = await paymentsQuery;

      if (paymentsError) {
        return reply.code(500).send({
          success: false,
          message: paymentsError.message,
        });
      }

      const paymentRows = payments ?? [];

      const paymentStats = {
        total: paymentRows.length,
        pending: 0,
        processing: 0,
        success: 0,
        failed: 0,
        refunded: 0,
        success_amount: 0,
        refunded_amount: 0,
      };

      for (const payment of paymentRows) {
        const amount = Number(
          payment.amount ?? 0,
        );

        switch (payment.status) {
          case 'PENDING':
            paymentStats.pending++;
            break;

          case 'PROCESSING':
            paymentStats.processing++;
            break;

          case 'SUCCESS':
            paymentStats.success++;
            paymentStats.success_amount += amount;
            break;

          case 'FAILED':
            paymentStats.failed++;
            break;

          case 'REFUNDED':
            paymentStats.refunded++;
            paymentStats.refunded_amount += amount;
            break;
        }
      }

      /*
       * =========================
       * RESPONSE
       * =========================
       */

      return reply.send({
        success: true,

        period: {
          from,
          to,
        },

        filters: {
          property_id:
            query.property_id ?? null,
        },

        bookings: bookingStats,

        revenue: {
          booking_revenue: revenue,
          paid_revenue: paidRevenue,
          partial_revenue: partialRevenue,
          currency: 'VND',
        },

        properties: propertyStats,

        rooms: roomStats,

        payments: paymentStats,
      });
    },
  );
}