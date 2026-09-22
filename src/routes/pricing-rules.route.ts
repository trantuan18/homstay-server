import type { FastifyInstance } from 'fastify';

import {
  supabase,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function pricingRulesRoute(app: FastifyInstance) {
  /**
   * GET /api/rooms/:roomId/pricing-rules
   *
   * Public:
   * - Chỉ xem pricing rule của room AVAILABLE
   * - Property phải ACTIVE
   */
  app.get(
    '/api/rooms/:roomId/pricing-rules',
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const { data, error } = await supabase
        .from('pricing_rules')
        .select(`
          id,
          room_id,
          rule_name,
          day_of_week,
          start_time,
          end_time,
          min_duration_minutes,
          max_duration_minutes,
          price,
          priority,
          active,
          created_at,
          rooms!inner (
            id,
            status,
            properties!inner (
              id,
              status
            )
          )
        `)
        .eq('room_id', roomId)
        .eq('rooms.status', 'AVAILABLE')
        .eq('rooms.properties.status', 'ACTIVE')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to fetch pricing rules',
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
   * POST /api/rooms/:roomId/pricing-rules
   *
   * HOST:
   * - Tạo pricing rule cho room của mình
   */
  app.post(
    '/api/rooms/:roomId/pricing-rules',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const body = request.body as {
        rule_name?: string;
        day_of_week?: number | null;
        start_time?: string | null;
        end_time?: string | null;
        min_duration_minutes?: number | null;
        max_duration_minutes?: number | null;
        price?: number;
        priority?: number;
        active?: boolean;
      };

      if (!body.rule_name?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Rule name is required',
        });
      }

      if (
        body.day_of_week !== undefined &&
        body.day_of_week !== null &&
        (!Number.isInteger(body.day_of_week) ||
          body.day_of_week < 1 ||
          body.day_of_week > 7)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'day_of_week must be between 1 and 7',
        });
      }

      if (
        body.min_duration_minutes !== undefined &&
        body.min_duration_minutes !== null &&
        (!Number.isInteger(body.min_duration_minutes) ||
          body.min_duration_minutes <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Minimum duration must be a positive integer',
        });
      }

      if (
        body.max_duration_minutes !== undefined &&
        body.max_duration_minutes !== null &&
        (!Number.isInteger(body.max_duration_minutes) ||
          body.max_duration_minutes <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Maximum duration must be a positive integer',
        });
      }

      if (
        body.min_duration_minutes !== undefined &&
        body.max_duration_minutes !== undefined &&
        body.min_duration_minutes !== null &&
        body.max_duration_minutes !== null &&
        body.min_duration_minutes > body.max_duration_minutes
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Minimum duration cannot exceed maximum duration',
        });
      }

      if (
        body.price !== undefined &&
        body.price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Price cannot be negative',
        });
      }

      if (
        body.priority !== undefined &&
        !Number.isInteger(body.priority)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Priority must be an integer',
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

      const { data, error } = await userSupabase
        .from('pricing_rules')
        .insert({
          room_id: roomId,
          rule_name: body.rule_name.trim(),
          day_of_week:
            body.day_of_week ?? null,
          start_time:
            body.start_time ?? null,
          end_time:
            body.end_time ?? null,
          min_duration_minutes:
            body.min_duration_minutes ?? null,
          max_duration_minutes:
            body.max_duration_minutes ?? null,
          price: body.price ?? 0,
          priority: body.priority ?? 0,
          active: body.active ?? true,
        })
        .select()
        .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create pricing rule',
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
   * PATCH /api/rooms/:roomId/pricing-rules/:ruleId
   *
   * HOST:
   * - Cập nhật pricing rule
   */
  app.patch(
    '/api/rooms/:roomId/pricing-rules/:ruleId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, ruleId } = request.params as {
        roomId: string;
        ruleId: string;
      };

      const body = request.body as {
        rule_name?: string;
        day_of_week?: number | null;
        start_time?: string | null;
        end_time?: string | null;
        min_duration_minutes?: number | null;
        max_duration_minutes?: number | null;
        price?: number;
        priority?: number;
        active?: boolean;
      };

      if (
        body.day_of_week !== undefined &&
        body.day_of_week !== null &&
        (!Number.isInteger(body.day_of_week) ||
          body.day_of_week < 1 ||
          body.day_of_week > 7)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'day_of_week must be between 1 and 7',
        });
      }

      if (
        body.min_duration_minutes !== undefined &&
        body.min_duration_minutes !== null &&
        (!Number.isInteger(body.min_duration_minutes) ||
          body.min_duration_minutes <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Minimum duration must be a positive integer',
        });
      }

      if (
        body.max_duration_minutes !== undefined &&
        body.max_duration_minutes !== null &&
        (!Number.isInteger(body.max_duration_minutes) ||
          body.max_duration_minutes <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Maximum duration must be a positive integer',
        });
      }

      if (
        body.min_duration_minutes !== undefined &&
        body.max_duration_minutes !== undefined &&
        body.min_duration_minutes !== null &&
        body.max_duration_minutes !== null &&
        body.min_duration_minutes > body.max_duration_minutes
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Minimum duration cannot exceed maximum duration',
        });
      }

      if (
        body.price !== undefined &&
        body.price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Price cannot be negative',
        });
      }

      if (
        body.priority !== undefined &&
        !Number.isInteger(body.priority)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Priority must be an integer',
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

      const updateData: Record<string, unknown> = {};

      if (body.rule_name !== undefined) {
        if (!body.rule_name.trim()) {
          return reply.status(400).send({
            success: false,
            message: 'Rule name cannot be empty',
          });
        }

        updateData.rule_name = body.rule_name.trim();
      }

      if (body.day_of_week !== undefined) {
        updateData.day_of_week = body.day_of_week;
      }

      if (body.start_time !== undefined) {
        updateData.start_time = body.start_time;
      }

      if (body.end_time !== undefined) {
        updateData.end_time = body.end_time;
      }

      if (body.min_duration_minutes !== undefined) {
        updateData.min_duration_minutes =
          body.min_duration_minutes;
      }

      if (body.max_duration_minutes !== undefined) {
        updateData.max_duration_minutes =
          body.max_duration_minutes;
      }

      if (body.price !== undefined) {
        updateData.price = body.price;
      }

      if (body.priority !== undefined) {
        updateData.priority = body.priority;
      }

      if (body.active !== undefined) {
        updateData.active = body.active;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'No fields to update',
        });
      }

      const { data, error } = await userSupabase
        .from('pricing_rules')
        .update(updateData)
        .eq('id', ruleId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update pricing rule',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message:
            'Pricing rule not found or not owned by user',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * DELETE /api/rooms/:roomId/pricing-rules/:ruleId
   */
  app.delete(
    '/api/rooms/:roomId/pricing-rules/:ruleId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, ruleId } = request.params as {
        roomId: string;
        ruleId: string;
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
        .from('pricing_rules')
        .delete()
        .eq('id', ruleId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to delete pricing rule',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message:
            'Pricing rule not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Pricing rule deleted successfully',
        data,
      };
    },
  );
}