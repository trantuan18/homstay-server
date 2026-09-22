import type { FastifyInstance } from 'fastify';

import { supabase } from '../lib/supabase.js';

export async function availabilityRoute(app: FastifyInstance) {
  /**
   * GET /api/rooms/:roomId/availability
   *
   * Kiểm tra một khoảng thời gian có thể booking hay không.
   *
   * Query:
   * ?start_at=2026-09-20T14:00:00+07:00
   * &end_at=2026-09-20T18:00:00+07:00
   */
  app.get(
    '/api/rooms/:roomId/availability',
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const query = request.query as {
        start_at?: string;
        end_at?: string;
      };

      if (!query.start_at) {
        return reply.status(400).send({
          success: false,
          message: 'start_at is required',
        });
      }

      if (!query.end_at) {
        return reply.status(400).send({
          success: false,
          message: 'end_at is required',
        });
      }

      const startAt = new Date(query.start_at);
      const endAt = new Date(query.end_at);

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

      const { data, error } = await supabase.rpc(
        'check_room_availability',
        {
          p_room_id: roomId,
          p_start_at: startAt.toISOString(),
          p_end_at: endAt.toISOString(),
        },
      );

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to check room availability',
          error: error.message,
        });
      }

      const result = data?.[0];

      if (!result) {
        return reply.status(500).send({
          success: false,
          message: 'Availability check returned no result',
        });
      }

      return {
        success: true,
        available: result.available,
        reason: result.reason,
        data: {
          room_id: roomId,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
        },
      };
    },
  );
}