import type { FastifyInstance } from 'fastify';

import {
  supabase,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function blockedPeriodsRoute(app: FastifyInstance) {
  /**
   * GET /api/rooms/:roomId/blocked-periods
   *
   * HOST:
   * - Xem các khoảng thời gian đã block của room mình
   */
  app.get(
    '/api/rooms/:roomId/blocked-periods',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const accessToken = authorization.slice(7).trim();

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('blocked_periods')
        .select(`
          id,
          room_id,
          start_at,
          end_at,
          reason,
          created_by,
          created_at
        `)
        .eq('room_id', roomId)
        .order('start_at', { ascending: true });

      if (error) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to fetch blocked periods',
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
   * POST /api/rooms/:roomId/blocked-periods
   *
   * HOST:
   * - Block một khoảng thời gian của room
   */
  app.post(
    '/api/rooms/:roomId/blocked-periods',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const body = request.body as {
        start_at?: string;
        end_at?: string;
        reason?: string;
      };

      if (!body.start_at) {
        return reply.status(400).send({
          success: false,
          message: 'Start time is required',
        });
      }

      if (!body.end_at) {
        return reply.status(400).send({
          success: false,
          message: 'End time is required',
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
          message: 'End time must be after start time',
        });
      }

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const accessToken = authorization.slice(7).trim();

      const userSupabase =
        createUserSupabaseClient(accessToken);

      /*
       * Kiểm tra room tồn tại và thuộc property của HOST.
       */
      const { data: room, error: roomError } =
        await userSupabase
          .from('rooms')
          .select(`
            id,
            property_id,
            properties!inner (
              id,
              owner_id
            )
          `)
          .eq('id', roomId)
          .maybeSingle();

      if (roomError) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to verify room',
          error: roomError.message,
        });
      }

      if (!room) {
        return reply.status(404).send({
          success: false,
          message: 'Room not found or not owned by user',
        });
      }

      /*
       * Không cho block nếu đã có booking đang giữ slot.
       */
      const { data: overlappingBookings, error: bookingError } =
        await userSupabase
          .from('bookings')
          .select('id')
          .eq('room_id', roomId)
          .in('status', [
            'PENDING',
            'CONFIRMED',
            'CHECKED_IN',
          ])
          .lt('start_at', endAt.toISOString())
          .gt('end_at', startAt.toISOString())
          .limit(1);

      if (bookingError) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to check existing bookings',
          error: bookingError.message,
        });
      }

      if (overlappingBookings?.length) {
        return reply.status(409).send({
          success: false,
          message:
            'Cannot block period because room is already booked',
        });
      }

      const { data, error } = await userSupabase
        .from('blocked_periods')
        .insert({
          room_id: roomId,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          reason: body.reason?.trim() || null,
          created_by: request.user.id,
        })
        .select()
        .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create blocked period',
          error: error.message,
        });
      }

      return reply.status(201).send({
        success: true,
        data,
      });
    },
  );

  /**
   * PATCH /api/rooms/:roomId/blocked-periods/:blockedId
   */
  app.patch(
    '/api/rooms/:roomId/blocked-periods/:blockedId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, blockedId } = request.params as {
        roomId: string;
        blockedId: string;
      };

      const body = request.body as {
        start_at?: string;
        end_at?: string;
        reason?: string;
      };

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const accessToken = authorization.slice(7).trim();

      const userSupabase =
        createUserSupabaseClient(accessToken);

      /*
       * Lấy dữ liệu hiện tại.
       */
      const { data: current, error: currentError } =
        await userSupabase
          .from('blocked_periods')
          .select(`
            id,
            room_id,
            start_at,
            end_at,
            reason
          `)
          .eq('id', blockedId)
          .eq('room_id', roomId)
          .maybeSingle();

      if (currentError) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to fetch blocked period',
          error: currentError.message,
        });
      }

      if (!current) {
        return reply.status(404).send({
          success: false,
          message:
            'Blocked period not found or not owned by user',
        });
      }

      const finalStart =
        body.start_at ?? current.start_at;

      const finalEnd =
        body.end_at ?? current.end_at;

      const startAt = new Date(finalStart);
      const endAt = new Date(finalEnd);

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
          message: 'End time must be after start time',
        });
      }

      /*
       * Không cho sửa thành khoảng thời gian
       * đè lên booking hiện tại.
       */
      const { data: overlappingBookings, error: bookingError } =
        await userSupabase
          .from('bookings')
          .select('id')
          .eq('room_id', roomId)
          .in('status', [
            'PENDING',
            'CONFIRMED',
            'CHECKED_IN',
          ])
          .lt('start_at', endAt.toISOString())
          .gt('end_at', startAt.toISOString())
          .limit(1);

      if (bookingError) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to check existing bookings',
          error: bookingError.message,
        });
      }

      if (overlappingBookings?.length) {
        return reply.status(409).send({
          success: false,
          message:
            'Cannot update blocked period because room is already booked',
        });
      }

      const updateData: Record<string, unknown> = {
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
      };

      if (body.reason !== undefined) {
        updateData.reason =
          body.reason.trim() || null;
      }

      const { data, error } = await userSupabase
        .from('blocked_periods')
        .update(updateData)
        .eq('id', blockedId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update blocked period',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message:
            'Blocked period not found or not owned by user',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * DELETE /api/rooms/:roomId/blocked-periods/:blockedId
   */
  app.delete(
    '/api/rooms/:roomId/blocked-periods/:blockedId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, blockedId } = request.params as {
        roomId: string;
        blockedId: string;
      };

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const accessToken = authorization.slice(7).trim();

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('blocked_periods')
        .delete()
        .eq('id', blockedId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to delete blocked period',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message:
            'Blocked period not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Blocked period deleted successfully',
        data,
      };
    },
  );
}