import type { FastifyInstance } from 'fastify';

import {
  supabase,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function roomsRoute(app: FastifyInstance) {
  /**
   * GET /api/rooms
   *
   * Public:
   * - Chỉ lấy room AVAILABLE
   * - Property phải ACTIVE
   *
   * Optional query:
   * ?property_id=<uuid>
   */
  app.get('/api/rooms', async (request, reply) => {
    const query = request.query as {
      property_id?: string;
    };

    let roomQuery = supabase
      .from('rooms')
      .select(`
        id,
        property_id,
        name,
        slug,
        description,
        capacity,
        base_hourly_price,
        base_daily_price,
        status,
        created_at,
        updated_at,
        properties!inner (
          id,
          name,
          slug,
          city,
          status
        )
      `)
      .eq('status', 'AVAILABLE')
      .eq('properties.status', 'ACTIVE')
      .order('created_at', { ascending: false });

    if (query.property_id) {
      roomQuery = roomQuery.eq(
        'property_id',
        query.property_id,
      );
    }

    const { data, error } = await roomQuery;

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch rooms',
        error: error.message,
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * GET /api/rooms/:id
   *
   * Public:
   * - Chỉ lấy room AVAILABLE
   * - Property phải ACTIVE
   */
  app.get('/api/rooms/:id', async (request, reply) => {
    const { id } = request.params as {
      id: string;
    };

    const { data, error } = await supabase
      .from('rooms')
      .select(`
        id,
        property_id,
        name,
        slug,
        description,
        capacity,
        base_hourly_price,
        base_daily_price,
        status,
        created_at,
        updated_at,
        properties!inner (
          id,
          name,
          slug,
          city,
          status
        )
      `)
      .eq('id', id)
      .eq('status', 'AVAILABLE')
      .eq('properties.status', 'ACTIVE')
      .maybeSingle();

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch room',
        error: error.message,
      });
    }

    if (!data) {
      return reply.status(404).send({
        success: false,
        message: 'Room not found',
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * POST /api/properties/:propertyId/rooms
   *
   * HOST:
   * - Phải đăng nhập
   * - RLS kiểm tra property ownership
   */
  app.post(
    '/api/properties/:propertyId/rooms',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { propertyId } = request.params as {
        propertyId: string;
      };

      const body = request.body as {
        name?: string;
        slug?: string;
        description?: string;
        capacity?: number;
        base_hourly_price?: number;
        base_daily_price?: number;
        status?: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';
      };

      if (!body.name?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Room name is required',
        });
      }

      if (!body.slug?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Room slug is required',
        });
      }

      if (
        body.capacity !== undefined &&
        (!Number.isInteger(body.capacity) ||
          body.capacity <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Capacity must be a positive integer',
        });
      }

      if (
        body.base_hourly_price !== undefined &&
        body.base_hourly_price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Hourly price cannot be negative',
        });
      }

      if (
        body.base_daily_price !== undefined &&
        body.base_daily_price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Daily price cannot be negative',
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
        .from('rooms')
        .insert({
          property_id: propertyId,
          name: body.name.trim(),
          slug: body.slug.trim(),
          description: body.description ?? null,
          capacity: body.capacity ?? 2,
          base_hourly_price:
            body.base_hourly_price ?? 0,
          base_daily_price:
            body.base_daily_price ?? 0,
          status: body.status ?? 'AVAILABLE',
        })
        .select()
        .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create room',
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
   * PATCH /api/rooms/:id
   *
   * HOST:
   * - Chỉ sửa room thuộc property của mình
   */
  app.patch(
    '/api/rooms/:id',
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
        capacity?: number;
        base_hourly_price?: number;
        base_daily_price?: number;
        status?: 'AVAILABLE' | 'MAINTENANCE' | 'INACTIVE';
      };

      if (
        body.capacity !== undefined &&
        (!Number.isInteger(body.capacity) ||
          body.capacity <= 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Capacity must be a positive integer',
        });
      }

      if (
        body.base_hourly_price !== undefined &&
        body.base_hourly_price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Hourly price cannot be negative',
        });
      }

      if (
        body.base_daily_price !== undefined &&
        body.base_daily_price < 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Daily price cannot be negative',
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

      if (body.name !== undefined) {
        if (!body.name.trim()) {
          return reply.status(400).send({
            success: false,
            message: 'Room name cannot be empty',
          });
        }

        updateData.name = body.name.trim();
      }

      if (body.slug !== undefined) {
        if (!body.slug.trim()) {
          return reply.status(400).send({
            success: false,
            message: 'Room slug cannot be empty',
          });
        }

        updateData.slug = body.slug.trim();
      }

      if (body.description !== undefined) {
        updateData.description = body.description;
      }

      if (body.capacity !== undefined) {
        updateData.capacity = body.capacity;
      }

      if (body.base_hourly_price !== undefined) {
        updateData.base_hourly_price =
          body.base_hourly_price;
      }

      if (body.base_daily_price !== undefined) {
        updateData.base_daily_price =
          body.base_daily_price;
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
        .from('rooms')
        .update(updateData)
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update room',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Room not found or not owned by user',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * DELETE /api/rooms/:id
   *
   * Soft delete:
   * - Không xóa record
   * - Chuyển room thành INACTIVE
   */
  app.delete(
    '/api/rooms/:id',
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
        .from('rooms')
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
          message: 'Failed to deactivate room',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Room not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Room deactivated successfully',
        data,
      };
    },
  );
}