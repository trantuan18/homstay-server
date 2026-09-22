import type { FastifyInstance } from 'fastify';

import {
  supabase,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function roomImagesRoute(app: FastifyInstance) {
  /**
   * GET /api/rooms/:roomId/images
   *
   * Public:
   * - Chỉ xem ảnh của room AVAILABLE
   * - Property phải ACTIVE
   */
  app.get('/api/rooms/:roomId/images', async (request, reply) => {
    const { roomId } = request.params as {
      roomId: string;
    };

    const { data, error } = await supabase
      .from('room_images')
      .select(`
        id,
        room_id,
        image_url,
        public_id,
        sort_order,
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
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch room images',
        error: error.message,
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * POST /api/rooms/:roomId/images
   *
   * HOST:
   * - Thêm ảnh cho room của mình
   * - RLS sẽ kiểm tra ownership
   */
  app.post(
    '/api/rooms/:roomId/images',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const body = request.body as {
        image_url?: string;
        public_id?: string;
        sort_order?: number;
      };

      if (!body.image_url?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Image URL is required',
        });
      }

      if (
        body.sort_order !== undefined &&
        (!Number.isInteger(body.sort_order) ||
          body.sort_order < 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Sort order must be a non-negative integer',
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
        .from('room_images')
        .insert({
          room_id: roomId,
          image_url: body.image_url.trim(),
          public_id: body.public_id?.trim() || null,
          sort_order: body.sort_order ?? 0,
        })
        .select()
        .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create room image',
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
   * PATCH /api/rooms/:roomId/images/:imageId
   *
   * HOST:
   * - Cập nhật URL / public_id / thứ tự ảnh
   */
  app.patch(
    '/api/rooms/:roomId/images/:imageId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, imageId } = request.params as {
        roomId: string;
        imageId: string;
      };

      const body = request.body as {
        image_url?: string;
        public_id?: string;
        sort_order?: number;
      };

      if (
        body.sort_order !== undefined &&
        (!Number.isInteger(body.sort_order) ||
          body.sort_order < 0)
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Sort order must be a non-negative integer',
        });
      }

      if (
        body.image_url !== undefined &&
        !body.image_url.trim()
      ) {
        return reply.status(400).send({
          success: false,
          message: 'Image URL cannot be empty',
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

      if (body.image_url !== undefined) {
        updateData.image_url = body.image_url.trim();
      }

      if (body.public_id !== undefined) {
        updateData.public_id =
          body.public_id.trim() || null;
      }

      if (body.sort_order !== undefined) {
        updateData.sort_order = body.sort_order;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'No fields to update',
        });
      }

      const { data, error } = await userSupabase
        .from('room_images')
        .update(updateData)
        .eq('id', imageId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update room image',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Room image not found or not owned by user',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  /**
   * DELETE /api/rooms/:roomId/images/:imageId
   */
  app.delete(
    '/api/rooms/:roomId/images/:imageId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, imageId } = request.params as {
        roomId: string;
        imageId: string;
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
        .from('room_images')
        .delete()
        .eq('id', imageId)
        .eq('room_id', roomId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to delete room image',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Room image not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Room image deleted successfully',
        data,
      };
    },
  );
}