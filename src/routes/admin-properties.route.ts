import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import {
  supabaseAdmin,
  createUserSupabaseClient,
} from '../lib/supabase.js';

export async function adminPropertiesRoute(
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
  // GET ALL PROPERTIES
  // GET /api/admin/properties
  // =========================================================
  app.get(
    '/api/admin/properties',
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
          status?: string;
          owner_id?: string;
          city?: string;
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
          .from('properties')
          .select(
            `
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
            updated_at,
            profiles!properties_owner_id_fkey (
              id,
              full_name,
              phone,
              avatar_url
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

        if (query.status) {
          dbQuery = dbQuery.eq(
            'status',
            query.status,
          );
        }

        if (query.owner_id) {
          dbQuery = dbQuery.eq(
            'owner_id',
            query.owner_id,
          );
        }

        if (query.city?.trim()) {
          dbQuery = dbQuery.ilike(
            'city',
            `%${query.city.trim()}%`,
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
              'Failed to get properties',
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
  // GET PROPERTY DETAIL
  // GET /api/admin/properties/:id
  // =========================================================
  app.get(
    '/api/admin/properties/:id',
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
          .from('properties')
          .select(
            `
            *,
            profiles!properties_owner_id_fkey (
              id,
              full_name,
              phone,
              avatar_url
            ),
            rooms (
              id,
              name,
              slug,
              capacity,
              base_hourly_price,
              base_daily_price,
              status
            )
          `,
          )
          .eq('id', id)
          .single();

        if (error) {
          return reply.status(404).send({
            success: false,
            message:
              'Property not found',
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
  // CREATE PROPERTY
  // POST /api/admin/properties
  // =========================================================
  app.post(
    '/api/admin/properties',
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

        const body =
          request.body as any;

        if (!body.owner_id) {
          return reply.status(400).send({
            success: false,
            message:
              'owner_id is required',
          });
        }

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

        const payload = {
          owner_id: body.owner_id,
          name: body.name.trim(),
          slug: body.slug.trim(),
          description:
            body.description ?? null,
          address:
            body.address ?? null,
          city:
            body.city ?? null,
          country:
            body.country ?? 'Vietnam',
          latitude:
            body.latitude ?? null,
          longitude:
            body.longitude ?? null,
          timezone:
            body.timezone ??
            'Asia/Ho_Chi_Minh',
          booking_interval_minutes:
            body.booking_interval_minutes ??
            60,
          minimum_booking_minutes:
            body.minimum_booking_minutes ??
            60,
          maximum_booking_minutes:
            body.maximum_booking_minutes ??
            1440,
          check_in_time:
            body.check_in_time ?? null,
          check_out_time:
            body.check_out_time ?? null,
          cancellation_deadline_hours:
            body.cancellation_deadline_hours ??
            24,
          cancellation_fee_percent:
            body.cancellation_fee_percent ??
            0,
          status:
            body.status ?? 'ACTIVE',
        };

        const {
          data,
          error,
        } = await supabaseAdmin
          .from('properties')
          .insert(payload)
          .select()
          .single();

        if (error) {
          return reply.status(400).send({
            success: false,
            message:
              'Failed to create property',
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
  // UPDATE PROPERTY
  // PATCH /api/admin/properties/:id
  // =========================================================
  app.patch(
    '/api/admin/properties/:id',
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
          'owner_id',
          'name',
          'slug',
          'description',
          'address',
          'city',
          'country',
          'latitude',
          'longitude',
          'timezone',
          'booking_interval_minutes',
          'minimum_booking_minutes',
          'maximum_booking_minutes',
          'check_in_time',
          'check_out_time',
          'cancellation_deadline_hours',
          'cancellation_fee_percent',
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
          .from('properties')
          .update(payload)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          return reply.status(400).send({
            success: false,
            message:
              'Failed to update property',
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
  // DEACTIVATE PROPERTY
  // DELETE /api/admin/properties/:id
  // =========================================================
  app.delete(
    '/api/admin/properties/:id',
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
          .from('properties')
          .update({
            status: 'INACTIVE',
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
              'Property not found',
          });
        }

        return {
          success: true,
          message:
            'Property deactivated successfully',
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