import { FastifyInstance } from 'fastify';
import { createUserSupabaseClient, supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function getExtension(mimetype: string) {
  switch (mimetype) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

export async function roomImageUploadRoute(app: FastifyInstance) {
  app.post(
    '/api/admin/rooms/:roomId/images/upload',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const token = request.headers.authorization?.replace(
        'Bearer ',
        '',
      );

      if (!token) {
        return reply.code(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      // =====================================================
      // CHECK ADMIN
      // =====================================================

      const userClient = createUserSupabaseClient(token);

      const { data: isAdmin, error: adminError } =
        await userClient.rpc('is_admin');

      if (adminError || !isAdmin) {
        return reply.code(403).send({
          success: false,
          message: 'ADMIN_REQUIRED',
        });
      }

      // =====================================================
      // CHECK ROOM
      // =====================================================

      const { data: room, error: roomError } = await supabaseAdmin
        .from('rooms')
        .select(`
          id,
          property_id,
          name
        `)
        .eq('id', roomId)
        .single();

      if (roomError || !room) {
        return reply.code(404).send({
          success: false,
          message: 'ROOM_NOT_FOUND',
        });
      }

      // =====================================================
      // GET FILE
      // =====================================================

      const file = await request.file();

      if (!file) {
        return reply.code(400).send({
          success: false,
          message: 'IMAGE_FILE_REQUIRED',
        });
      }

      if (!ALLOWED_TYPES.has(file.mimetype)) {
        return reply.code(400).send({
          success: false,
          message: 'INVALID_IMAGE_TYPE',
        });
      }

      const extension = getExtension(file.mimetype);

      if (!extension) {
        return reply.code(400).send({
          success: false,
          message: 'INVALID_IMAGE_TYPE',
        });
      }

      const buffer = await file.toBuffer();

      if (buffer.length === 0) {
        return reply.code(400).send({
          success: false,
          message: 'EMPTY_IMAGE_FILE',
        });
      }

      if (buffer.length > 5 * 1024 * 1024) {
        return reply.code(400).send({
          success: false,
          message: 'IMAGE_TOO_LARGE',
        });
      }

      // =====================================================
      // GENERATE STORAGE PATH
      // =====================================================

      const uniqueId =
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const storagePath =
        `${room.property_id}/${roomId}/${uniqueId}.${extension}`;

      // =====================================================
      // UPLOAD STORAGE
      // =====================================================

      const { error: uploadError } = await supabaseAdmin.storage
        .from('room-images')
        .upload(storagePath, buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (uploadError) {
        return reply.code(500).send({
          success: false,
          message: uploadError.message,
        });
      }

      // =====================================================
      // GET PUBLIC URL
      // =====================================================

      const {
        data: { publicUrl },
      } = supabaseAdmin.storage
        .from('room-images')
        .getPublicUrl(storagePath);

      // =====================================================
      // SAVE DB
      // =====================================================

      const { data: image, error: imageError } = await supabaseAdmin
        .from('room_images')
        .insert({
          room_id: roomId,
          image_url: publicUrl,
          public_id: storagePath,
          sort_order: 0,
        })
        .select()
        .single();

      if (imageError) {
        // Rollback storage if DB insert fails
        await supabaseAdmin.storage
          .from('room-images')
          .remove([storagePath]);

        return reply.code(500).send({
          success: false,
          message: imageError.message,
        });
      }

      return reply.code(201).send({
        success: true,
        message: 'Room image uploaded successfully',
        image,
      });
    },
    );

  app.patch(
  '/api/admin/rooms/:roomId/images/:imageId',
  {
      preHandler: authenticate,
  },
  async (request, reply) => {
      const { roomId, imageId } = request.params as {
      roomId: string;
      imageId: string;
      };

      const body = request.body as {
      sort_order?: number;
      is_primary?: boolean;
      };

      const token = request.headers.authorization?.replace(
      'Bearer ',
      '',
      );

      if (!token) {
      return reply.code(401).send({
          success: false,
          message: 'Missing access token',
      });
      }

      const userClient = createUserSupabaseClient(token);

      const { data: isAdmin, error: adminError } =
      await userClient.rpc('is_admin');

      if (adminError || !isAdmin) {
      return reply.code(403).send({
          success: false,
          message: 'ADMIN_REQUIRED',
      });
      }

      if (
      body.sort_order !== undefined &&
      (!Number.isInteger(body.sort_order) || body.sort_order < 0)
      ) {
      return reply.code(400).send({
          success: false,
          message: 'INVALID_SORT_ORDER',
      });
      }

      const { data: image, error: imageError } = await supabaseAdmin
      .from('room_images')
      .select('*')
      .eq('id', imageId)
      .eq('room_id', roomId)
      .single();

      if (imageError || !image) {
      return reply.code(404).send({
          success: false,
          message: 'IMAGE_NOT_FOUND',
      });
      }

      // Nếu chọn ảnh chính
      if (body.is_primary === true) {
      await supabaseAdmin
          .from('room_images')
          .update({ is_primary: false })
          .eq('room_id', roomId)
          .eq('is_primary', true);
      }

      const updateData: Record<string, unknown> = {};

      if (body.sort_order !== undefined) {
      updateData.sort_order = body.sort_order;
      }

      if (body.is_primary !== undefined) {
      updateData.is_primary = body.is_primary;
      }

      const { data: updatedImage, error: updateError } =
      await supabaseAdmin
          .from('room_images')
          .update(updateData)
          .eq('id', imageId)
          .eq('room_id', roomId)
          .select()
          .single();

      if (updateError) {
      return reply.code(400).send({
          success: false,
          message: updateError.message,
      });
      }

      return reply.send({
      success: true,
      message: 'Room image updated successfully',
      image: updatedImage,
      });
  },
  );

  app.delete(
  '/api/admin/rooms/:roomId/images/:imageId',
  {
    preHandler: authenticate,
  },
  async (request, reply) => {
    const { roomId, imageId } = request.params as {
      roomId: string;
      imageId: string;
    };

    const token = request.headers.authorization?.replace(
      'Bearer ',
      '',
    );

    if (!token) {
      return reply.code(401).send({
        success: false,
        message: 'Missing access token',
      });
    }

    const userClient = createUserSupabaseClient(token);

    const { data: isAdmin, error: adminError } =
      await userClient.rpc('is_admin');

    if (adminError || !isAdmin) {
      return reply.code(403).send({
        success: false,
        message: 'ADMIN_REQUIRED',
      });
    }

    const { data: image, error: imageError } =
      await supabaseAdmin
        .from('room_images')
        .select('*')
        .eq('id', imageId)
        .eq('room_id', roomId)
        .single();

    if (imageError || !image) {
      return reply.code(404).send({
        success: false,
        message: 'IMAGE_NOT_FOUND',
      });
    }

    // Xóa Storage
    if (image.public_id) {
      const { error: storageError } =
        await supabaseAdmin.storage
          .from('room-images')
          .remove([image.public_id]);

      if (storageError) {
        return reply.code(500).send({
          success: false,
          message: storageError.message,
        });
      }
    }

    // Xóa DB
    const { error: deleteError } = await supabaseAdmin
      .from('room_images')
      .delete()
      .eq('id', imageId)
      .eq('room_id', roomId);

    if (deleteError) {
      return reply.code(500).send({
        success: false,
        message: deleteError.message,
      });
    }

    return reply.send({
      success: true,
      message: 'Room image deleted successfully',
    });
  },
);
}