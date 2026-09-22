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
  const userClient =
    createUserSupabaseClient(token);

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

function getDateKey(date: string) {
  return date.substring(0, 10);
}

export async function adminAnalyticsRoute(
  app: FastifyInstance,
) {
  /**
   * GET /api/admin/analytics
   *
   * Query:
   * from=2026-09-01
   * to=2026-09-30
   * property_id=optional
   */
  app.get(
    '/api/admin/analytics',
    { preHandler: authenticate },
    async (request, reply) => {
      const isAdmin = await requireAdmin(
        request,
        reply,
      );

      if (!isAdmin) return;

      const query = request.query as {
        from?: string;
        to?: string;
        property_id?: string;
      };

      const now = new Date();

      const defaultFrom = new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
      );

      const fromDate =
        query.from ??
        defaultFrom.toISOString().substring(0, 10);

      const toDate =
        query.to ??
        now.toISOString().substring(0, 10);

      /*
       * Validate date
       */
      const from = new Date(
        `${fromDate}T00:00:00.000Z`,
      );

      const to = new Date(
        `${toDate}T23:59:59.999Z`,
      );

      if (
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        from > to
      ) {
        return reply.code(400).send({
          success: false,
          message: 'INVALID_DATE_RANGE',
        });
      }

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
          booking_code,
          status,
          payment_status,
          total,
          currency,
          start_at,
          end_at,
          property_id,
          room_id,
          created_at
        `,
        )
        .gte('created_at', from.toISOString())
        .lte('created_at', to.toISOString());

      if (query.property_id) {
        bookingsQuery =
          bookingsQuery.eq(
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
       * DAILY BOOKING STATS
       * =========================
       */

      const dailyMap = new Map<
        string,
        {
          date: string;
          bookings: number;
          confirmed: number;
          cancelled: number;
          checked_in: number;
          checked_out: number;
          revenue: number;
        }
      >();

      for (
        let current = new Date(from);
        current <= to;
        current.setUTCDate(
          current.getUTCDate() + 1,
        )
      ) {
        const date =
          current.toISOString().substring(0, 10);

        dailyMap.set(date, {
          date,
          bookings: 0,
          confirmed: 0,
          cancelled: 0,
          checked_in: 0,
          checked_out: 0,
          revenue: 0,
        });
      }

      for (const booking of bookingRows) {
        const date = getDateKey(
          booking.created_at,
        );

        const day = dailyMap.get(date);

        if (!day) continue;

        day.bookings++;

        if (
          booking.status === 'CONFIRMED'
        ) {
          day.confirmed++;
        }

        if (
          booking.status === 'CANCELLED'
        ) {
          day.cancelled++;
        }

        if (
          booking.status === 'CHECKED_IN'
        ) {
          day.checked_in++;
        }

        if (
          booking.status === 'CHECKED_OUT'
        ) {
          day.checked_out++;
        }

        if (
          booking.payment_status === 'PAID'
        ) {
          day.revenue += Number(
            booking.total ?? 0,
          );
        }
      }

      const daily = Array.from(
        dailyMap.values(),
      );

      /*
       * =========================
       * PROPERTY PERFORMANCE
       * =========================
       */

      const propertyMap = new Map<
        string,
        {
          property_id: string;
          bookings: number;
          revenue: number;
        }
      >();

      for (const booking of bookingRows) {
        if (!booking.property_id) continue;

        const existing =
          propertyMap.get(
            booking.property_id,
          ) ?? {
            property_id:
              booking.property_id,
            bookings: 0,
            revenue: 0,
          };

        existing.bookings++;

        if (
          booking.payment_status === 'PAID'
        ) {
          existing.revenue += Number(
            booking.total ?? 0,
          );
        }

        propertyMap.set(
          booking.property_id,
          existing,
        );
      }

      const propertyIds =
        Array.from(
          propertyMap.keys(),
        );

      let propertyRows: any[] = [];

      if (propertyIds.length > 0) {
        const {
          data,
          error,
        } = await supabaseAdmin
          .from('properties')
          .select(
            'id, name, city, status',
          )
          .in('id', propertyIds);

        if (error) {
          return reply.code(500).send({
            success: false,
            message: error.message,
          });
        }

        propertyRows = data ?? [];
      }

      const propertyPerformance =
        propertyRows
          .map((property) => {
            const stats =
              propertyMap.get(
                property.id,
              );

            return {
              property_id:
                property.id,
              name: property.name,
              city: property.city,
              status: property.status,
              bookings:
                stats?.bookings ?? 0,
              revenue:
                stats?.revenue ?? 0,
            };
          })
          .sort(
            (a, b) =>
              b.revenue - a.revenue,
          );

      /*
       * =========================
       * ROOM PERFORMANCE
       * =========================
       */

      const roomMap = new Map<
        string,
        {
          room_id: string;
          bookings: number;
          revenue: number;
        }
      >();

      for (const booking of bookingRows) {
        if (!booking.room_id) continue;

        const existing =
          roomMap.get(
            booking.room_id,
          ) ?? {
            room_id: booking.room_id,
            bookings: 0,
            revenue: 0,
          };

        existing.bookings++;

        if (
          booking.payment_status === 'PAID'
        ) {
          existing.revenue += Number(
            booking.total ?? 0,
          );
        }

        roomMap.set(
          booking.room_id,
          existing,
        );
      }

      const roomIds =
        Array.from(roomMap.keys());

      let roomRows: any[] = [];

      if (roomIds.length > 0) {
        const {
          data,
          error,
        } = await supabaseAdmin
          .from('rooms')
          .select(
            `
            id,
            name,
            property_id,
            status
          `,
          )
          .in('id', roomIds);

        if (error) {
          return reply.code(500).send({
            success: false,
            message: error.message,
          });
        }

        roomRows = data ?? [];
      }

      const roomPerformance =
        roomRows
          .map((room) => {
            const stats =
              roomMap.get(room.id);

            return {
              room_id: room.id,
              name: room.name,
              property_id:
                room.property_id,
              status: room.status,
              bookings:
                stats?.bookings ?? 0,
              revenue:
                stats?.revenue ?? 0,
            };
          })
          .sort(
            (a, b) =>
              b.revenue - a.revenue,
          );

      /*
       * =========================
       * SUMMARY
       * =========================
       */

      const totalRevenue =
        bookingRows.reduce(
          (sum, booking) => {
            if (
              booking.payment_status ===
              'PAID'
            ) {
              return (
                sum +
                Number(
                  booking.total ?? 0,
                )
              );
            }

            return sum;
          },
          0,
        );

      const totalBookings =
        bookingRows.length;

      const confirmedBookings =
        bookingRows.filter(
          (b) =>
            b.status === 'CONFIRMED',
        ).length;

      const cancelledBookings =
        bookingRows.filter(
          (b) =>
            b.status === 'CANCELLED',
        ).length;

      const averageBookingValue =
        confirmedBookings > 0
          ? Math.round(
              totalRevenue /
                confirmedBookings,
            )
          : 0;

      return reply.send({
        success: true,

        period: {
          from: fromDate,
          to: toDate,
        },

        filters: {
          property_id:
            query.property_id ?? null,
        },

        summary: {
          total_bookings:
            totalBookings,

          confirmed_bookings:
            confirmedBookings,

          cancelled_bookings:
            cancelledBookings,

          total_revenue:
            totalRevenue,

          average_booking_value:
            averageBookingValue,

          currency: 'VND',
        },

        daily,

        property_performance:
          propertyPerformance,

        room_performance:
          roomPerformance,
      });
    },
  );
}