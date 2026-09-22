import type { FastifyInstance } from 'fastify';
import {
  createUserSupabaseClient,
} from '../lib/supabase.js';

import {
  notifyBookingConfirmed,
  notifyBookingCancelled,
  notifyBookingCheckedIn,
  notifyBookingCheckedOut,
} from '../services/booking-notification.service.js';

import { authenticate } from '../middleware/auth.js';

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;
  return authorization.slice(7).trim();
}

function mapAdminError(message: string) {
  const upper = message.toUpperCase();

  if (upper.includes('ADMIN_REQUIRED')) {
    return { status: 403, message: 'Admin access required' };
  }

  if (
    upper.includes('USER_REQUIRED') ||
    upper.includes('ROOM_REQUIRED') ||
    upper.includes('START_END_REQUIRED') ||
    upper.includes('INVALID_TIME_RANGE') ||
    upper.includes('INVALID_GUEST_COUNT') ||
    upper.includes('BOOKING_TOO_SHORT') ||
    upper.includes('BOOKING_TOO_LONG') ||
    upper.includes('INVALID_BOOKING_STATUS')
  ) {
    return { status: 400, message };
  }

  if (
    upper.includes('USER_NOT_FOUND') ||
    upper.includes('BOOKING_NOT_FOUND')
  ) {
    return { status: 404, message };
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

export async function adminBookingsRoute(app: FastifyInstance) {

  // =========================================================
  // GET ALL BOOKINGS
  // =========================================================

  app.get(
    '/api/admin/bookings',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const query = request.query as {
        property_id?: string;
        room_id?: string;
        status?: string;
        payment_status?: string;
        start_date?: string;
        end_date?: string;
      };

      const accessToken = getAccessToken(request);
      const userSupabase =
        createUserSupabaseClient(accessToken);

      let queryBuilder = userSupabase
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

      if (query.property_id) {
        queryBuilder = queryBuilder.eq(
          'property_id',
          query.property_id,
        );
      }

      if (query.room_id) {
        queryBuilder = queryBuilder.eq(
          'room_id',
          query.room_id,
        );
      }

      if (query.status) {
        queryBuilder = queryBuilder.eq(
          'status',
          query.status,
        );
      }

      if (query.payment_status) {
        queryBuilder = queryBuilder.eq(
          'payment_status',
          query.payment_status,
        );
      }

      if (query.start_date) {
        queryBuilder = queryBuilder.gte(
          'start_at',
          query.start_date,
        );
      }

      if (query.end_date) {
        queryBuilder = queryBuilder.lte(
          'start_at',
          query.end_date,
        );
      }

      const { data, error } = await queryBuilder;

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get admin bookings',
          error: error.message,
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  // =========================================================
  // GET BOOKING DETAIL
  // =========================================================

  app.get(
    '/api/admin/bookings/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const accessToken = getAccessToken(request);
      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('bookings')
        .select(`
          *,
          payments (
            id,
            provider,
            transaction_id,
            amount,
            currency,
            status,
            paid_at,
            created_at
          )
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

  // =========================================================
  // CREATE BOOKING FOR CUSTOMER
  // =========================================================

  app.post(
    '/api/admin/bookings',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const body = request.body as {
        user_id?: string;
        room_id?: string;
        start_at?: string;
        end_at?: string;
        guest_count?: number;
        guest_name?: string;
        guest_phone?: string;
        guest_email?: string;
        notes?: string;
      };

      if (!body.user_id) {
        return reply.status(400).send({
          success: false,
          message: 'user_id is required',
        });
      }

      if (!body.room_id) {
        return reply.status(400).send({
          success: false,
          message: 'room_id is required',
        });
      }

      if (!body.start_at || !body.end_at) {
        return reply.status(400).send({
          success: false,
          message: 'start_at and end_at are required',
        });
      }

      const startAt = new Date(body.start_at);
      const endAt = new Date(body.end_at);

      if (
        Number.isNaN(startAt.getTime()) ||
        Number.isNaN(endAt.getTime())
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid date format',
        });
      }

      if (startAt >= endAt) {
        return reply.status(400).send({
          success: false,
          message: 'end_at must be after start_at',
        });
      }

      const guestCount = body.guest_count ?? 1;

      if (
        !Number.isInteger(guestCount) ||
        guestCount <= 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'guest_count must be a positive integer',
        });
      }

      const accessToken = getAccessToken(request);
      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } =
        await userSupabase.rpc(
          'admin_create_booking',
          {
            p_user_id: body.user_id,
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
        const mapped =
          mapAdminError(error.message);

        return reply.status(mapped.status).send({
          success: false,
          message: mapped.message,
          error: error.message,
        });
      }

      const booking =
        Array.isArray(data) ? data[0] : data;

      return reply.status(201).send({
        success: true,
        message: 'Booking created successfully',
        data: booking,
      });
    },
  );

  // =========================================================
  // UPDATE BOOKING STATUS
  // =========================================================

  app.patch(
  '/api/admin/bookings/:id/status',
  { preHandler: authenticate },
  async (request, reply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({
        success: false,
        message: 'Missing access token',
      });
    }

    const token = authHeader.substring(7);

    const userClient = createUserSupabaseClient(token);

    const {
      data: isAdmin,
      error: adminError,
    } = await userClient.rpc('is_admin');

    if (adminError || isAdmin !== true) {
      return reply.code(403).send({
        success: false,
        message: 'ADMIN_REQUIRED',
      });
    }

    const { id } = request.params as {
      id: string;
    };

    const { status } = request.body as {
      status?: string;
    };

    if (!status) {
      return reply.code(400).send({
        success: false,
        message: 'STATUS_REQUIRED',
      });
    }

    const {
      data,
      error,
    } = await userClient.rpc(
      'admin_update_booking_status',
      {
        p_booking_id: id,
        p_status: status,
      },
    );

    if (error) {
      const message = error.message;

      if (message.includes('BOOKING_NOT_FOUND')) {
        return reply.code(404).send({
          success: false,
          message: 'BOOKING_NOT_FOUND',
        });
      }

      if (
        message.includes('INVALID_STATUS_TRANSITION') ||
        message.includes('PAYMENT_REQUIRED')
      ) {
        return reply.code(400).send({
          success: false,
          message,
        });
      }

      return reply.code(500).send({
        success: false,
        message,
      });
    }

    return reply.send({
      success: true,
      message: 'BOOKING_STATUS_UPDATED',
      data,
    });
  },
);
}