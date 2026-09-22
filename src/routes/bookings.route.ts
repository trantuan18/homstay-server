import type { FastifyInstance } from 'fastify';
import {
  createUserSupabaseClient,
  supabase,
} from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import {
  notifyBookingCreated,
} from '../services/booking-notification.service.js';

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;
  return authorization.slice(7).trim();
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function mapBookingError(message: string) {
  const upper = message.toUpperCase();

  if (upper.includes('AUTH_REQUIRED')) {
    return { status: 401, message: 'Authentication required' };
  }

  if (
    upper.includes('ROOM_REQUIRED') ||
    upper.includes('START_END_REQUIRED') ||
    upper.includes('INVALID_TIME_RANGE') ||
    upper.includes('INVALID_GUEST_COUNT') ||
    upper.includes('BOOKING_TOO_SHORT') ||
    upper.includes('BOOKING_TOO_LONG')
  ) {
    return { status: 400, message };
  }

  if (
    upper.includes('ROOM_NOT_AVAILABLE') ||
    upper.includes('ROOM_BLOCKED') ||
    upper.includes('ROOM_BOOKED')
  ) {
    return { status: 409, message };
  }

  return { status: 400, message };
}

export async function bookingsRoute(app: FastifyInstance) {
  /**
   * POST /api/bookings
   *
   * Tạo booking mới thông qua DB RPC create_booking().
   */
  app.post(
    '/api/bookings',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const body = request.body as {
        room_id?: string;
        start_at?: string;
        end_at?: string;
        guest_count?: number;
        guest_name?: string;
        guest_phone?: string;
        guest_email?: string;
        notes?: string;
      };

      if (!body.room_id) {
        return reply.status(400).send({
          success: false,
          message: 'room_id is required',
        });
      }

      const startAt = parseDate(body.start_at);
      const endAt = parseDate(body.end_at);

      if (!startAt) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid start_at',
        });
      }

      if (!endAt) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid end_at',
        });
      }

      if (startAt >= endAt) {
        return reply.status(400).send({
          success: false,
          message: 'end_at must be after start_at',
        });
      }

      const guestCount = body.guest_count ?? 1;

      if (!Number.isInteger(guestCount) || guestCount <= 0) {
        return reply.status(400).send({
          success: false,
          message: 'guest_count must be a positive integer',
        });
      }

      const accessToken = getAccessToken(request);

      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase.rpc(
        'create_booking',
        {
          p_room_id: body.room_id,
          p_start_at: startAt.toISOString(),
          p_end_at: endAt.toISOString(),
          p_guest_count: guestCount,
          p_guest_name: body.guest_name ?? null,
          p_guest_phone: body.guest_phone ?? null,
          p_guest_email: body.guest_email ?? null,
          p_notes: body.notes ?? null,
        },
      );

      if (error) {
        const mapped = mapBookingError(error.message);

        return reply.status(mapped.status).send({
          success: false,
          message: mapped.message,
          error: error.message,
        });
      }

      // const booking = Array.isArray(data) ? data[0] : data;

      // if (!booking) {
      //   return reply.status(500).send({
      //     success: false,
      //     message: 'Booking was not created',
      //   });
      // }

      // return reply.status(201).send({
      //   success: true,
      //   message: 'Booking created successfully',
      //   data: booking,
      // });

      const booking = Array.isArray(data)
        ? data[0]
        : data;

      if (!booking) {
        return reply.status(500).send({
          success: false,
          message: 'Booking creation returned no data',
        });
      }

      try {
        await notifyBookingCreated({
          userId: booking.user_id,
          bookingCode: booking.booking_code,
        });
      } catch (notificationError) {
        request.log.error(
          notificationError,
          'Failed to create booking notification',
        );
      }

      return {
        success: true,
        message: 'Booking created successfully',
        data: booking,
      };
    },
  );

  /**
   * GET /api/bookings
   *
   * Customer: chỉ thấy booking của mình.
   * Host: thấy booking thuộc property của mình.
   */
  app.get(
    '/api/bookings',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const accessToken = getAccessToken(request);

      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          user_id,
          property_id,
          room_id,
          start_at,
          end_at,
          guest_count,
          guest_name,
          guest_phone,
          guest_email,
          subtotal,
          discount,
          tax,
          total,
          currency,
          status,
          payment_status,
          expires_at,
          notes,
          cancellation_reason,
          cancelled_at,
          created_at,
          updated_at
        `)
        .order('start_at', { ascending: false });

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get bookings',
          error: error.message,
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * GET /api/bookings/:id
   */
  app.get(
    '/api/bookings/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('bookings')
        .select(`
          id,
          booking_code,
          user_id,
          property_id,
          room_id,
          start_at,
          end_at,
          guest_count,
          guest_name,
          guest_phone,
          guest_email,
          subtotal,
          discount,
          tax,
          total,
          currency,
          status,
          payment_status,
          expires_at,
          notes,
          cancellation_reason,
          cancelled_at,
          created_at,
          updated_at
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get booking',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Booking not found',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * POST /api/bookings/:id/cancel
   */
  app.post(
    '/api/bookings/:id/cancel',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const body = request.body as {
        reason?: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase.rpc(
        'cancel_booking',
        {
          p_booking_id: id,
          p_reason: body?.reason ?? null,
        },
      );

      if (error) {
        const mapped = mapBookingError(error.message);

        return reply.status(mapped.status).send({
          success: false,
          message: mapped.message,
          error: error.message,
        });
      }

      const booking = Array.isArray(data) ? data[0] : data;

      return {
        success: true,
        message: 'Booking cancelled successfully',
        data: booking,
      };
    },
  );

  /**
   * GET /api/bookings/price
   *
   * Tính giá trước khi tạo booking.
   */
  app.get(
    '/api/bookings/price',
    async (request, reply) => {
      const query = request.query as {
        room_id?: string;
        start_at?: string;
        end_at?: string;
      };

      if (!query.room_id) {
        return reply.status(400).send({
          success: false,
          message: 'room_id is required',
        });
      }

      const startAt = parseDate(query.start_at);
      const endAt = parseDate(query.end_at);

      if (!startAt || !endAt) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid start_at or end_at',
        });
      }

      if (startAt >= endAt) {
        return reply.status(400).send({
          success: false,
          message: 'end_at must be after start_at',
        });
      }

      const { data, error } = await supabase.rpc(
        'calculate_booking_price',
        {
          p_room_id: query.room_id,
          p_start_at: startAt.toISOString(),
          p_end_at: endAt.toISOString(),
        },
      );

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to calculate booking price',
          error: error.message,
        });
      }

      const result = Array.isArray(data) ? data[0] : data;

      if (!result) {
        return reply.status(500).send({
          success: false,
          message: 'Price calculation returned no result',
        });
      }

      return {
        success: true,
        data: result,
      };
    },
  );
}