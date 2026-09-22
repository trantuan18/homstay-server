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

function parseDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

export async function adminOccupancyRoute(
  app: FastifyInstance,
) {
  /**
   * GET /api/admin/analytics/occupancy
   *
   * Query:
   *
   * from=2026-09-01T00:00:00.000Z
   * to=2026-09-30T23:59:59.999Z
   * property_id=optional
   * room_id=optional
   */
  app.get(
    '/api/admin/analytics/occupancy',
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
        room_id?: string;
      };

      if (!query.from || !query.to) {
        return reply.code(400).send({
          success: false,
          message: 'FROM_AND_TO_REQUIRED',
        });
      }

      const from = parseDate(query.from);
      const to = parseDate(query.to);

      if (!from || !to || from >= to) {
        return reply.code(400).send({
          success: false,
          message: 'INVALID_DATE_RANGE',
        });
      }

      /*
       * Không cho query quá dài ở MVP.
       * Tối đa 31 ngày.
       */
      const diffMs =
        to.getTime() - from.getTime();

      const diffDays =
        diffMs /
        (1000 * 60 * 60 * 24);

      if (diffDays > 31) {
        return reply.code(400).send({
          success: false,
          message:
            'DATE_RANGE_MAX_31_DAYS',
        });
      }

      /*
       * =========================
       * ROOMS
       * =========================
       */

      let roomsQuery = supabaseAdmin
        .from('rooms')
        .select(
          `
          id,
          name,
          property_id,
          status,
          properties!inner (
            id,
            name,
            timezone,
            booking_interval_minutes,
            status
          )
        `,
        )
        .eq('status', 'AVAILABLE')
        .eq(
          'properties.status',
          'ACTIVE',
        );

      if (query.property_id) {
        roomsQuery =
          roomsQuery.eq(
            'property_id',
            query.property_id,
          );
      }

      if (query.room_id) {
        roomsQuery =
          roomsQuery.eq(
            'id',
            query.room_id,
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

      /*
       * =========================
       * BOOKINGS
       * =========================
       */

      const roomIds =
        roomRows.map((room) => room.id);

      if (roomIds.length === 0) {
        return reply.send({
          success: true,
          period: {
            from: from.toISOString(),
            to: to.toISOString(),
          },
          summary: {
            total_rooms: 0,
            occupied_minutes: 0,
            available_minutes: 0,
            occupancy_percent: 0,
          },
          rooms: [],
          hourly: [],
        });
      }

      const {
        data: bookings,
        error: bookingsError,
      } = await supabaseAdmin
        .from('bookings')
        .select(
          `
          id,
          room_id,
          start_at,
          end_at,
          status
        `,
        )
        .in('room_id', roomIds)
        .in('status', [
          'PENDING',
          'CONFIRMED',
          'CHECKED_IN',
        ])
        .lt(
          'start_at',
          to.toISOString(),
        )
        .gt(
          'end_at',
          from.toISOString(),
        );

      if (bookingsError) {
        return reply.code(500).send({
          success: false,
          message: bookingsError.message,
        });
      }

      const bookingRows =
        bookings ?? [];

      /*
       * =========================
       * BLOCKED PERIODS
       * =========================
       */

      const {
        data: blockedPeriods,
        error: blockedError,
      } = await supabaseAdmin
        .from('blocked_periods')
        .select(
          `
          id,
          room_id,
          start_at,
          end_at
        `,
        )
        .in('room_id', roomIds)
        .lt(
          'start_at',
          to.toISOString(),
        )
        .gt(
          'end_at',
          from.toISOString(),
        );

      if (blockedError) {
        return reply.code(500).send({
          success: false,
          message: blockedError.message,
        });
      }

      const blockedRows =
        blockedPeriods ?? [];

      /*
       * =========================
       * OVERLAP MINUTES
       * =========================
       */

      function overlapMinutes(
        startA: Date,
        endA: Date,
        startB: Date,
        endB: Date,
      ) {
        const start = Math.max(
          startA.getTime(),
          startB.getTime(),
        );

        const end = Math.min(
          endA.getTime(),
          endB.getTime(),
        );

        if (end <= start) {
          return 0;
        }

        return Math.floor(
          (end - start) /
            (1000 * 60),
        );
      }

      /*
       * =========================
       * ROOM OCCUPANCY
       * =========================
       */

      const roomStats = roomRows.map(
        (room: any) => {
          const roomBookings =
            bookingRows.filter(
              (booking) =>
                booking.room_id ===
                room.id,
            );

          const roomBlocked =
            blockedRows.filter(
              (blocked) =>
                blocked.room_id ===
                room.id,
            );

          let occupiedMinutes = 0;

          for (const booking of roomBookings) {
            occupiedMinutes +=
              overlapMinutes(
                from,
                to,
                new Date(
                  booking.start_at,
                ),
                new Date(
                  booking.end_at,
                ),
              );
          }

          let blockedMinutes = 0;

          for (const blocked of roomBlocked) {
            blockedMinutes +=
              overlapMinutes(
                from,
                to,
                new Date(
                  blocked.start_at,
                ),
                new Date(
                  blocked.end_at,
                ),
              );
          }

          const totalMinutes =
            Math.floor(
              diffMs /
                (1000 * 60),
            );

          /*
           * Available time =
           * period - blocked period
           */
          const availableMinutes =
            Math.max(
              totalMinutes -
                blockedMinutes,
              0,
            );

          const occupancyPercent =
            availableMinutes > 0
              ? Number(
                  (
                    (occupiedMinutes /
                      availableMinutes) *
                    100
                  ).toFixed(2),
                )
              : 0;

          return {
            room_id: room.id,
            room_name: room.name,
            property_id:
              room.property_id,
            property_name:
              room.properties?.name ??
              null,
            timezone:
              room.properties
                ?.timezone ??
              'Asia/Ho_Chi_Minh',

            occupied_minutes:
              occupiedMinutes,

            blocked_minutes:
              blockedMinutes,

            available_minutes:
              availableMinutes,

            occupancy_percent:
              occupancyPercent,
          };
        },
      );

      /*
       * =========================
       * SUMMARY
       * =========================
       */

      const totalOccupied =
        roomStats.reduce(
          (sum, room) =>
            sum +
            room.occupied_minutes,
          0,
        );

      const totalAvailable =
        roomStats.reduce(
          (sum, room) =>
            sum +
            room.available_minutes,
          0,
        );

      const totalBlocked =
        roomStats.reduce(
          (sum, room) =>
            sum +
            room.blocked_minutes,
          0,
        );

      const occupancyPercent =
        totalAvailable > 0
          ? Number(
              (
                (totalOccupied /
                  totalAvailable) *
                100
              ).toFixed(2),
            )
          : 0;

      /*
       * =========================
       * HOURLY DISTRIBUTION
       * =========================
       *
       * Chia theo UTC hour.
       * Đây là dữ liệu raw để frontend
       * có thể convert theo timezone
       * của Property.
       */

      const hourlyMap = new Map<
        string,
        {
          hour: string;
          occupied_minutes: number;
          booking_count: number;
        }
      >();

      const cursor =
        new Date(from);

      cursor.setUTCMinutes(0);
      cursor.setUTCSeconds(0);
      cursor.setUTCMilliseconds(0);

      while (cursor < to) {
        const hour =
          cursor.toISOString();

        hourlyMap.set(hour, {
          hour,
          occupied_minutes: 0,
          booking_count: 0,
        });

        cursor.setUTCHours(
          cursor.getUTCHours() + 1,
        );
      }

      for (const booking of bookingRows) {
        const bookingStart =
          new Date(
            booking.start_at,
          );

        const bookingEnd =
          new Date(
            booking.end_at,
          );

        const cursor =
          new Date(
            Math.max(
              bookingStart.getTime(),
              from.getTime(),
            ),
          );

        cursor.setUTCMinutes(0);
        cursor.setUTCSeconds(0);
        cursor.setUTCMilliseconds(0);

        while (
          cursor < bookingEnd &&
          cursor < to
        ) {
          const hourStart =
            new Date(cursor);

          const hourEnd =
            new Date(cursor);

          hourEnd.setUTCHours(
            hourEnd.getUTCHours() + 1,
          );

          const minutes =
            overlapMinutes(
              from,
              to,
              bookingStart,
              bookingEnd,
            ) > 0
              ? overlapMinutes(
                  hourStart,
                  hourEnd,
                  bookingStart,
                  bookingEnd,
                )
              : 0;

          const key =
            hourStart.toISOString();

          const row =
            hourlyMap.get(key);

          if (row && minutes > 0) {
            row.occupied_minutes +=
              minutes;

            row.booking_count++;
          }

          cursor.setUTCHours(
            cursor.getUTCHours() + 1,
          );
        }
      }

      return reply.send({
        success: true,

        period: {
          from: from.toISOString(),
          to: to.toISOString(),
        },

        filters: {
          property_id:
            query.property_id ??
            null,
          room_id:
            query.room_id ?? null,
        },

        summary: {
          total_rooms:
            roomRows.length,

          occupied_minutes:
            totalOccupied,

          blocked_minutes:
            totalBlocked,

          available_minutes:
            totalAvailable,

          occupancy_percent:
            occupancyPercent,
        },

        rooms: roomStats,

        hourly:
          Array.from(
            hourlyMap.values(),
          ),
      });
    },
  );
}