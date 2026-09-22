import type { FastifyInstance } from 'fastify';

import {
  supabase,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function propertiesRoute(app: FastifyInstance) {
  /**
   * GET /api/properties
   *
   * Public:
   * - Chỉ lấy property ACTIVE
   */
  app.get('/api/properties', async (_request, reply) => {
    const { data, error } = await supabase
      .from('properties')
      .select(`
        id,
        owner_id,
        name,
        slug,
        description,
        address,
        city,
        country,
        latitude,
        longitude,
        timezone,
        booking_interval_minutes,
        minimum_booking_minutes,
        maximum_booking_minutes,
        check_in_time,
        check_out_time,
        cancellation_deadline_hours,
        cancellation_fee_percent,
        status,
        created_at,
        updated_at
      `)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch properties',
        error: error.message,
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * GET /api/properties/:id
   *
   * Public:
   * - Chỉ lấy property ACTIVE
   */
  app.get('/api/properties/:id', async (request, reply) => {
    const { id } = request.params as {
      id: string;
    };

    const { data, error } = await supabase
      .from('properties')
      .select(`
        id,
        owner_id,
        name,
        slug,
        description,
        address,
        city,
        country,
        latitude,
        longitude,
        timezone,
        booking_interval_minutes,
        minimum_booking_minutes,
        maximum_booking_minutes,
        check_in_time,
        check_out_time,
        cancellation_deadline_hours,
        cancellation_fee_percent,
        status,
        created_at,
        updated_at
      `)
      .eq('id', id)
      .eq('status', 'ACTIVE')
      .maybeSingle();

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch property',
        error: error.message,
      });
    }

    if (!data) {
      return reply.status(404).send({
        success: false,
        message: 'Property not found',
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * POST /api/properties
   *
   * HOST:
   * - Phải đăng nhập
   * - RLS kiểm tra is_host()
   * - owner_id phải bằng user hiện tại
   */
  app.post(
    '/api/properties',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const body = request.body as {
        name?: string;
        slug?: string;
        description?: string;
        address?: string;
        city?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
        timezone?: string;
        booking_interval_minutes?: number;
        minimum_booking_minutes?: number;
        maximum_booking_minutes?: number;
        check_in_time?: string;
        check_out_time?: string;
        cancellation_deadline_hours?: number;
        cancellation_fee_percent?: number;
      };

      if (!body.name?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Property name is required',
        });
      }

      if (!body.slug?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Property slug is required',
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

      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('properties')
        .insert({
          owner_id: request.user.id,
          name: body.name.trim(),
          slug: body.slug.trim(),
          description: body.description ?? null,
          address: body.address ?? null,
          city: body.city ?? null,
          country: body.country ?? 'Vietnam',
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          timezone: body.timezone ?? 'Asia/Ho_Chi_Minh',
          booking_interval_minutes:
            body.booking_interval_minutes ?? 60,
          minimum_booking_minutes:
            body.minimum_booking_minutes ?? 60,
          maximum_booking_minutes:
            body.maximum_booking_minutes ?? 1440,
          check_in_time: body.check_in_time ?? null,
          check_out_time: body.check_out_time ?? null,
          cancellation_deadline_hours:
            body.cancellation_deadline_hours ?? 24,
          cancellation_fee_percent:
            body.cancellation_fee_percent ?? 0,
        })
        .select()
        .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create property',
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
   * PATCH /api/properties/:id
   *
   * HOST:
   * - Chỉ sửa property của chính mình
   */
  app.patch(
    '/api/properties/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const body = request.body as {
        name?: string;
        slug?: string;
        description?: string;
        address?: string;
        city?: string;
        country?: string;
        latitude?: number;
        longitude?: number;
        timezone?: string;
        booking_interval_minutes?: number;
        minimum_booking_minutes?: number;
        maximum_booking_minutes?: number;
        check_in_time?: string;
        check_out_time?: string;
        cancellation_deadline_hours?: number;
        cancellation_fee_percent?: number;
        status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
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

      const updateData: Record<string, unknown> = {};

      if (body.name !== undefined) {
        updateData.name = body.name.trim();
      }

      if (body.slug !== undefined) {
        updateData.slug = body.slug.trim();
      }

      if (body.description !== undefined) {
        updateData.description = body.description;
      }

      if (body.address !== undefined) {
        updateData.address = body.address;
      }

      if (body.city !== undefined) {
        updateData.city = body.city;
      }

      if (body.country !== undefined) {
        updateData.country = body.country;
      }

      if (body.latitude !== undefined) {
        updateData.latitude = body.latitude;
      }

      if (body.longitude !== undefined) {
        updateData.longitude = body.longitude;
      }

      if (body.timezone !== undefined) {
        updateData.timezone = body.timezone;
      }

      if (body.booking_interval_minutes !== undefined) {
        updateData.booking_interval_minutes =
          body.booking_interval_minutes;
      }

      if (body.minimum_booking_minutes !== undefined) {
        updateData.minimum_booking_minutes =
          body.minimum_booking_minutes;
      }

      if (body.maximum_booking_minutes !== undefined) {
        updateData.maximum_booking_minutes =
          body.maximum_booking_minutes;
      }

      if (body.check_in_time !== undefined) {
        updateData.check_in_time = body.check_in_time;
      }

      if (body.check_out_time !== undefined) {
        updateData.check_out_time = body.check_out_time;
      }

      if (body.cancellation_deadline_hours !== undefined) {
        updateData.cancellation_deadline_hours =
          body.cancellation_deadline_hours;
      }

      if (body.cancellation_fee_percent !== undefined) {
        updateData.cancellation_fee_percent =
          body.cancellation_fee_percent;
      }

      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'No fields to update',
        });
      }

      updateData.updated_at = new Date().toISOString();

      const { data, error } = await userSupabase
        .from('properties')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update property',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Property not found or not owned by user',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );
    /**
   * DELETE /api/properties/:id
   *
   * Soft delete:
   * - Không xóa record khỏi DB
   * - Chuyển status -> INACTIVE
   */
  app.delete(
    '/api/properties/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
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
        .from('properties')
        .update({
          status: 'INACTIVE',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to deactivate property',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Property not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Property deactivated successfully',
        data,
      };
    },
  );
}