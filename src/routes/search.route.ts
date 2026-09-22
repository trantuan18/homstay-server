import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

export async function searchRoute(app: FastifyInstance) {
  // =========================================================
  // SEARCH ROOMS
  // GET /api/search/rooms
  // =========================================================
  app.get(
    '/api/search/rooms',
    async (request, reply) => {
      const query = request.query as {
        city?: string;
        property_id?: string;
        capacity?: string;
        min_price?: string;
        max_price?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(
        Math.max(Number(query.limit ?? 20), 1),
        100,
      );

      const offset = Math.max(
        Number(query.offset ?? 0),
        0,
      );

      let dbQuery = supabase
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
          properties!inner (
            id,
            name,
            slug,
            description,
            address,
            city,
            country,
            timezone,
            status
          ),
          room_images (
            id,
            image_url,
            sort_order
          )
        `,
          {
            count: 'exact',
          },
        )
        .eq('status', 'AVAILABLE')
        .eq('properties.status', 'ACTIVE')
        .order('created_at', {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      // -------------------------------------------------------
      // CITY
      // -------------------------------------------------------
      if (query.city?.trim()) {
        dbQuery = dbQuery.eq(
          'properties.city',
          query.city.trim(),
        );
      }

      // -------------------------------------------------------
      // PROPERTY
      // -------------------------------------------------------
      if (query.property_id?.trim()) {
        dbQuery = dbQuery.eq(
          'property_id',
          query.property_id.trim(),
        );
      }

      // -------------------------------------------------------
      // CAPACITY
      // -------------------------------------------------------
      if (query.capacity) {
        const capacity = Number(query.capacity);

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

        dbQuery = dbQuery.gte(
          'capacity',
          capacity,
        );
      }

      // -------------------------------------------------------
      // MIN PRICE
      // -------------------------------------------------------
      if (query.min_price) {
        const minPrice = Number(
          query.min_price,
        );

        if (
          Number.isNaN(minPrice) ||
          minPrice < 0
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'min_price must be greater than or equal to 0',
          });
        }

        dbQuery = dbQuery.gte(
          'base_hourly_price',
          minPrice,
        );
      }

      // -------------------------------------------------------
      // MAX PRICE
      // -------------------------------------------------------
      if (query.max_price) {
        const maxPrice = Number(
          query.max_price,
        );

        if (
          Number.isNaN(maxPrice) ||
          maxPrice < 0
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'max_price must be greater than or equal to 0',
          });
        }

        dbQuery = dbQuery.lte(
          'base_hourly_price',
          maxPrice,
        );
      }

      // -------------------------------------------------------
      // SEARCH
      // -------------------------------------------------------
      if (query.search?.trim()) {
        const search = query.search.trim();

        dbQuery = dbQuery.or(
          `name.ilike.%${search}%,description.ilike.%${search}%`,
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
          message: 'Failed to search rooms',
          error: error.message,
        });
      }

      return {
        success: true,
        data,
        pagination: {
          total: count ?? 0,
          limit,
          offset,
        },
      };
    },
  );

  // =========================================================
  // SEARCH PROPERTIES
  // GET /api/search/properties
  // =========================================================
  app.get(
    '/api/search/properties',
    async (request, reply) => {
      const query = request.query as {
        city?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(
        Math.max(Number(query.limit ?? 20), 1),
        100,
      );

      const offset = Math.max(
        Number(query.offset ?? 0),
        0,
      );

      let dbQuery = supabase
        .from('properties')
        .select(
          `
          id,
          name,
          slug,
          description,
          address,
          city,
          country,
          timezone,
          booking_interval_minutes,
          minimum_booking_minutes,
          maximum_booking_minutes,
          check_in_time,
          check_out_time,
          status,
          created_at
        `,
          {
            count: 'exact',
          },
        )
        .eq('status', 'ACTIVE')
        .order('created_at', {
          ascending: false,
        })
        .range(
          offset,
          offset + limit - 1,
        );

      // -------------------------------------------------------
      // CITY
      // -------------------------------------------------------
      if (query.city?.trim()) {
        dbQuery = dbQuery.eq(
          'city',
          query.city.trim(),
        );
      }

      // -------------------------------------------------------
      // SEARCH
      // -------------------------------------------------------
      if (query.search?.trim()) {
        const search = query.search.trim();

        dbQuery = dbQuery.or(
          `name.ilike.%${search}%,description.ilike.%${search}%,city.ilike.%${search}%`,
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
            'Failed to search properties',
          error: error.message,
        });
      }

      return {
        success: true,
        data,
        pagination: {
          total: count ?? 0,
          limit,
          offset,
        },
      };
    },
  );
}