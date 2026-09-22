import type { FastifyInstance } from 'fastify';

import {
  supabase,
  supabaseAdmin,
  createUserSupabaseClient,
} from '../lib/supabase.js';

import { authenticate } from '../middleware/auth.js';

export async function amenitiesRoute(app: FastifyInstance) {
  /**
   * GET /api/amenities
   *
   * Public:
   * - Lấy toàn bộ danh sách tiện ích
   */
  app.get('/api/amenities', async (_request, reply) => {
    const { data, error } = await supabase
      .from('amenities')
      .select(`
        id,
        name,
        icon,
        created_at
      `)
      .order('name', { ascending: true });

    if (error) {
      return reply.status(500).send({
        success: false,
        message: 'Failed to fetch amenities',
        error: error.message,
      });
    }

    return {
      success: true,
      data,
    };
  });

  /**
   * POST /api/amenities
   *
   * HOST:
   * - Tạo tiện ích mới
   *
   * Lưu ý:
   * amenities hiện đang có RLS public SELECT בלבד,
   * chưa có policy INSERT cho client.
   *
   * Vì vậy API này dùng supabaseAdmin.
   */
  app.post(
    '/api/amenities',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const body = request.body as {
        name?: string;
        icon?: string;
      };

      if (!body.name?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Amenity name is required',
        });
      }

      const authorization = request.headers.authorization;

      if (!authorization?.startsWith('Bearer ')) {
        return reply.status(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      /*
       * Kiểm tra role HOST bằng RPC is_host()
       * thông qua user client để vẫn tuân theo auth.
       */
      const accessToken = authorization.slice(7).trim();

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data: isHost, error: roleError } =
        await userSupabase.rpc('is_host');

      if (roleError) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to verify host role',
          error: roleError.message,
        });
      }

      if (!isHost) {
        return reply.status(403).send({
          success: false,
          message: 'Host role required',
        });
      }

      /*
       * Amenity là dữ liệu dùng chung toàn hệ thống.
       * Tạo bằng server-side admin client.
       */
      const { data, error } = await supabaseAdmin
        .from('amenities')
        .insert({
          name: body.name.trim(),
          icon: body.icon?.trim() || null,
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            message: 'Amenity already exists',
          });
        }

        return reply.status(400).send({
          success: false,
          message: 'Failed to create amenity',
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
   * GET /api/rooms/:roomId/amenities
   *
   * Public:
   * - Lấy các tiện ích của room
   */
  app.get(
    '/api/rooms/:roomId/amenities',
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const { data, error } = await supabase
        .from('room_amenities')
        .select(`
          room_id,
          amenity_id,
          amenities (
            id,
            name,
            icon
          ),
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
        .eq('rooms.properties.status', 'ACTIVE');

      if (error) {
        return reply.status(500).send({
          success: false,
          message: 'Failed to fetch room amenities',
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
   * POST /api/rooms/:roomId/amenities
   *
   * HOST:
   * - Gắn amenity vào room
   *
   * RLS room_amenities sẽ kiểm tra ownership.
   */
  app.post(
    '/api/rooms/:roomId/amenities',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const body = request.body as {
        amenity_id?: string;
      };

      if (!body.amenity_id?.trim()) {
        return reply.status(400).send({
          success: false,
          message: 'Amenity ID is required',
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
        .from('room_amenities')
        .insert({
          room_id: roomId,
          amenity_id: body.amenity_id.trim(),
        })
        .select(`
          room_id,
          amenity_id,
          amenities (
            id,
            name,
            icon
          )
        `)
        .single();

      if (error) {
        if (error.code === '23505') {
          return reply.status(409).send({
            success: false,
            message: 'Amenity already assigned to this room',
          });
        }

        if (error.code === '23503') {
          return reply.status(400).send({
            success: false,
            message: 'Room or amenity not found',
          });
        }

        return reply.status(400).send({
          success: false,
          message: 'Failed to assign amenity',
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
   * DELETE /api/rooms/:roomId/amenities/:amenityId
   *
   * HOST:
   * - Gỡ amenity khỏi room
   */
  app.delete(
    '/api/rooms/:roomId/amenities/:amenityId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId, amenityId } = request.params as {
        roomId: string;
        amenityId: string;
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
        .from('room_amenities')
        .delete()
        .eq('room_id', roomId)
        .eq('amenity_id', amenityId)
        .select()
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to remove amenity',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Room amenity not found or not owned by user',
        });
      }

      return {
        success: true,
        message: 'Amenity removed successfully',
        data,
      };
    },
  );
}