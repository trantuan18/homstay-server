import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import {
  supabaseAdmin,
  createUserSupabaseClient,
} from '../lib/supabase.js';

export async function adminRoomsRoute(
  app: FastifyInstance,
) {
  // =========================================================
  // ADMIN CHECK
  // =========================================================
  async function requireAdmin(
    accessToken: string,
  ) {
    const userClient =
      createUserSupabaseClient(accessToken);

    const { data, error } =
      await userClient.rpc('is_admin');

    if (error || data !== true) {
      throw new Error('ADMIN_REQUIRED');
    }
  }

  // =========================================================
  // GET ALL ROOMS
  // GET /api/admin/rooms
  // =========================================================
  app.get(
    '/api/admin/rooms',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token =
          request.headers.authorization
            ?.replace('Bearer ', '');

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: 'Missing access token',
          });
        }

        await requireAdmin(token);

        const query = request.query as {
          property_id?: string;
          status?: string;
          search?: string;
          limit?: string;
          offset?: string;
        };

        const limit = Math.min(
          Math.max(
            Number(query.limit ?? 20),
            1,
          ),
          100,
        );

        const offset = Math.max(
          Number(query.offset ?? 0),
          0,
        );

        let dbQuery = supabaseAdmin
          .from('rooms')
          .select(
            `
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
              status,
              owner_id
            )
          `,
            { count: 'exact' },
          )
          .order('created_at', {
            ascending: false,
          })
          .range(
            offset,
            offset + limit - 1,
          );

        if (query.property_id) {
          dbQuery = dbQuery.eq(
            'property_id',
            query.property_id,
          );
        }

        if (query.status) {
          dbQuery = dbQuery.eq(
            'status',
            query.status,
          );
        }

        if (query.search?.trim()) {
          dbQuery = dbQuery.or(
            `name.ilike.%${query.search.trim()}%,slug.ilike.%${query.search.trim()}%`,
          );
        }

        const {
          data,
          error,
          count,
        } = await dbQuery;

        if (error) {
          return reply.status(400).send({
            success: false,
            message:
              'Failed to get rooms',
            error: error.message,
          });
        }

        return {
          success: true,
          data: data ?? [],
          pagination: {
            total: count ?? 0,
            limit,
            offset,
          },
        };
      } catch (error: any) {
        if (
          error?.message ===
          'ADMIN_REQUIRED'
        ) {
          return reply.status(403).send({
            success: false,
            message:
              'Admin access required',
          });
        }

        return reply.status(500).send({
          success: false,
          message:
            error?.message ??
            'Internal server error',
        });
      }
    },
  );

  // =========================================================
  // GET ROOM DETAIL
  // GET /api/admin/rooms/:id
  // =========================================================
  app.get(
    '/api/admin/rooms/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token =
          request.headers.authorization
            ?.replace('Bearer ', '');

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: 'Missing access token',
          });
        }

        await requireAdmin(token);

        const { id } =
          request.params as {
            id: string;
          };

        const {
          data,
          error,
        } = await supabaseAdmin
          .from('rooms')
          .select(
            `
            *,
            properties (
              id,
              name,
              slug,
              city,
              status,
              owner_id
            ),
            room_images (
              id,
              image_url,
              public_id,
              sort_order
            ),
            room_amenities (
              amenity_id,
              amenities (
                id,
                name,
                icon
              )
            ),
            pricing_rules (
              id,
              rule_name,
              day_of_week,
              start_time,
              end_time,
              min_duration_minutes,
              max_duration_minutes,
              price,
              priority,
              active
            )
          `,
          )
          .eq('id', id)
          .single();

        if (error) {
          return reply.status(404).send({
            success: false,
            message: 'Room not found',
          });
        }

        return {
          success: true,
          data,
        };
      } catch (error: any) {
        if (
          error?.message ===
          'ADMIN_REQUIRED'
        ) {
          return reply.status(403).send({
            success: false,
            message:
              'Admin access required',
          });
        }

        return reply.status(500).send({
          success: false,
          message:
            error?.message ??
            'Internal server error',
        });
      }
    },
  );

  // =========================================================
  // CREATE ROOM
  // POST /api/admin/properties/:propertyId/rooms
  // =========================================================
  app.post(
    '/api/admin/properties/:propertyId/rooms',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token =
          request.headers.authorization
            ?.replace('Bearer ', '');

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: 'Missing access token',
          });
        }

        await requireAdmin(token);

        const {
          propertyId,
        } = request.params as {
          propertyId: string;
        };

        const body =
          request.body as any;

        if (!body.name?.trim()) {
          return reply.status(400).send({
            success: false,
            message:
              'name is required',
          });
        }

        if (!body.slug?.trim()) {
          return reply.status(400).send({
            success: false,
            message:
              'slug is required',
          });
        }

        const capacity = Number(
          body.capacity ?? 2,
        );

        if (
          Number.isNaN(capacity) ||
          capacity <= 0
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'capacity must be greater than 0',
          });
        }

        const {
          data: property,
          error: propertyError,
        } = await supabaseAdmin
          .from('properties')
          .select('id')
          .eq('id', propertyId)
          .single();

        if (
          propertyError ||
          !property
        ) {
          return reply.status(404).send({
            success: false,
            message:
              'Property not found',
          });
        }

        const {
          data,
          error,
        } = await supabaseAdmin
          .from('rooms')
          .insert({
            property_id: propertyId,
            name: body.name.trim(),
            slug: body.slug.trim(),
            description:
              body.description ?? null,
            capacity,
            base_hourly_price:
              body.base_hourly_price ?? 0,
            base_daily_price:
              body.base_daily_price ?? 0,
            status:
              body.status ??
              'AVAILABLE',
          })
          .select()
          .single();

        if (error) {
          return reply.status(400).send({
            success: false,
            message:
              'Failed to create room',
            error: error.message,
          });
        }

        return reply.status(201).send({
          success: true,
          data,
        });
      } catch (error: any) {
        if (
          error?.message ===
          'ADMIN_REQUIRED'
        ) {
          return reply.status(403).send({
            success: false,
            message:
              'Admin access required',
          });
        }

        return reply.status(500).send({
          success: false,
          message:
            error?.message ??
            'Internal server error',
        });
      }
    },
  );

  // =========================================================
  // UPDATE ROOM
  // PATCH /api/admin/rooms/:id
  // =========================================================
  app.patch(
    '/api/admin/rooms/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token =
          request.headers.authorization
            ?.replace('Bearer ', '');

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: 'Missing access token',
          });
        }

        await requireAdmin(token);

        const { id } =
          request.params as {
            id: string;
          };

        const body =
          request.body as any;

        const allowedFields = [
          'property_id',
          'name',
          'slug',
          'description',
          'capacity',
          'base_hourly_price',
          'base_daily_price',
          'status',
        ];

        const payload: Record<
          string,
          any
        > = {};

        for (const field of allowedFields) {
          if (
            body[field] !== undefined
          ) {
            payload[field] =
              typeof body[field] ===
              'string'
                ? body[field].trim()
                : body[field];
          }
        }

        if (
          payload.capacity !==
          undefined
        ) {
          const capacity = Number(
            payload.capacity,
          );

          if (
            Number.isNaN(capacity) ||
            capacity <= 0
          ) {
            return reply.status(400).send({
              success: false,
              message:
                'capacity must be greater than 0',
            });
          }

          payload.capacity =
            capacity;
        }

        if (
          Object.keys(payload)
            .length === 0
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'No fields to update',
          });
        }

        payload.updated_at =
          new Date().toISOString();

        const {
          data,
          error,
        } = await supabaseAdmin
          .from('rooms')
          .update(payload)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return reply.status(400).send({
            success: false,
            message:
              'Failed to update room',
            error: error.message,
          });
        }

        return {
          success: true,
          data,
        };
      } catch (error: any) {
        if (
          error?.message ===
          'ADMIN_REQUIRED'
        ) {
          return reply.status(403).send({
            success: false,
            message:
              'Admin access required',
          });
        }

        return reply.status(500).send({
          success: false,
          message:
            error?.message ??
            'Internal server error',
        });
      }
    },
  );

  // =========================================================
  // UPDATE ROOM STATUS
  // PATCH /api/admin/rooms/:id/status
  // =========================================================
  app.patch(
    '/api/admin/rooms/:id/status',
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const token =
          request.headers.authorization
            ?.replace('Bearer ', '');

        if (!token) {
          return reply.status(401).send({
            success: false,
            message: 'Missing access token',
          });
        }

        await requireAdmin(token);

        const { id } =
          request.params as {
            id: string;
          };

        const body =
          request.body as {
            status?: string;
          };

        const allowedStatuses = [
          'AVAILABLE',
          'MAINTENANCE',
          'INACTIVE',
        ];

        if (
          !body.status ||
          !allowedStatuses.includes(
            body.status,
          )
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'Invalid room status',
          });
        }

        const {
          data,
          error,
        } = await supabaseAdmin
          .from('rooms')
          .update({
            status: body.status,
            updated_at:
              new Date().toISOString(),
          })
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return reply.status(404).send({
            success: false,
            message:
              'Room not found',
          });
        }

        return {
          success: true,
          message:
            'Room status updated successfully',
          data,
        };
      } catch (error: any) {
        if (
          error?.message ===
          'ADMIN_REQUIRED'
        ) {
          return reply.status(403).send({
            success: false,
            message:
              'Admin access required',
          });
        }

        return reply.status(500).send({
          success: false,
          message:
            error?.message ??
            'Internal server error',
        });
      }
    },
  );
}