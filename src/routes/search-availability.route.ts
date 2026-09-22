import type { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase.js';

export async function searchAvailabilityRoute(
  app: FastifyInstance,
) {
  // =========================================================
  // SEARCH AVAILABLE ROOMS
  //
  // GET /api/search/rooms/available
  //
  // Example:
  // /api/search/rooms/available
  //   ?start_at=2026-09-20T10:00:00+07:00
  //   &end_at=2026-09-20T14:00:00+07:00
  //   &capacity=2
  //   &min_price=100000
  //   &max_price=500000
  // =========================================================
  app.get(
    '/api/search/rooms/available',
    async (request, reply) => {
      const query = request.query as {
        start_at?: string;
        end_at?: string;
        city?: string;
        property_id?: string;
        capacity?: string;
        min_price?: string;
        max_price?: string;
        limit?: string;
        offset?: string;
      };

      // -------------------------------------------------------
      // REQUIRED TIME
      // -------------------------------------------------------
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

      // -------------------------------------------------------
      // PAGINATION
      // -------------------------------------------------------
      const limit = Math.min(
        Math.max(Number(query.limit ?? 20), 1),
        100,
      );

      const offset = Math.max(
        Number(query.offset ?? 0),
        0,
      );

      // -------------------------------------------------------
      // BASIC ROOM SEARCH
      // -------------------------------------------------------
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
            booking_interval_minutes,
            minimum_booking_minutes,
            maximum_booking_minutes,
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
        });

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

      const {
        data: rooms,
        error,
        count,
      } = await dbQuery;

      if (error) {
        return reply.status(400).send({
          success: false,
          message:
            'Failed to search available rooms',
          error: error.message,
        });
      }

      // -------------------------------------------------------
      // CHECK AVAILABILITY FOR EACH ROOM
      // -------------------------------------------------------
      const availabilityResults = await Promise.all(
        (rooms ?? []).map(async (room: any) => {
          const { data, error: availabilityError } =
            await supabase.rpc(
              'check_room_availability',
              {
                p_room_id: room.id,
                p_start_at: startAt.toISOString(),
                p_end_at: endAt.toISOString(),
              },
            );

          if (availabilityError) {
            return {
              room,
              available: false,
              reason: 'AVAILABILITY_CHECK_FAILED',
            };
          }

          const result = Array.isArray(data)
            ? data[0]
            : data;

          return {
            room,
            available: Boolean(
              result?.available,
            ),
            reason:
              result?.reason ??
              'UNKNOWN',
          };
        }),
      );

      // -------------------------------------------------------
      // ONLY RETURN AVAILABLE ROOMS
      // -------------------------------------------------------
      const availableRooms =
        availabilityResults
          .filter(
            (item) => item.available,
          )
          .map((item) => ({
            ...item.room,
            availability: {
              available: true,
              start_at:
                startAt.toISOString(),
              end_at:
                endAt.toISOString(),
            },
          }));

      // -------------------------------------------------------
      // APPLY PAGINATION AFTER AVAILABILITY CHECK
      // -------------------------------------------------------
      const paginatedRooms =
        availableRooms.slice(
          offset,
          offset + limit,
        );

      return {
        success: true,
        data: paginatedRooms,
        pagination: {
          total: availableRooms.length,
          limit,
          offset,
        },
        search: {
          start_at:
            startAt.toISOString(),
          end_at:
            endAt.toISOString(),
          city:
            query.city ?? null,
          property_id:
            query.property_id ?? null,
          capacity:
            query.capacity
              ? Number(query.capacity)
              : null,
          min_price:
            query.min_price
              ? Number(query.min_price)
              : null,
          max_price:
            query.max_price
              ? Number(query.max_price)
              : null,
        },
      };
    },
  );
}