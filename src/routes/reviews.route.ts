import type { FastifyInstance } from 'fastify';
import { createUserSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Missing access token');
  }

  return authorization.slice(7).trim();
}

export async function reviewsRoute(app: FastifyInstance) {
  // =========================================================
  // GET ROOM REVIEWS
  // GET /api/rooms/:roomId/reviews
  // =========================================================
  app.get(
    '/api/rooms/:roomId/reviews',
    async (request, reply) => {
      const { roomId } = request.params as {
        roomId: string;
      };

      const query = request.query as {
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

      const { data, error, count } =
        await import('../lib/supabase.js').then(
          ({ supabase }) =>
            supabase
              .from('reviews')
              .select(`
                id,
                booking_id,
                user_id,
                room_id,
                rating,
                comment,
                status,
                created_at
              `, {
                count: 'exact',
              })
              .eq('room_id', roomId)
              .eq('status', 'PUBLISHED')
              .order('created_at', {
                ascending: false,
              })
              .range(
                offset,
                offset + limit - 1,
              ),
        );

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get reviews',
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
  // GET REVIEW DETAIL
  // GET /api/reviews/:id
  // =========================================================
  app.get(
    '/api/reviews/:id',
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const { supabase } =
        await import('../lib/supabase.js');

      const { data, error } =
        await supabase
          .from('reviews')
          .select(`
            id,
            booking_id,
            user_id,
            room_id,
            rating,
            comment,
            status,
            created_at
          `)
          .eq('id', id)
          .eq('status', 'PUBLISHED')
          .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get review',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Review not found',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  // =========================================================
  // CREATE REVIEW
  // POST /api/bookings/:bookingId/review
  // =========================================================
  app.post(
    '/api/bookings/:bookingId/review',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const body = request.body as {
        rating?: number;
        comment?: string;
      };

      if (
        body.rating === undefined ||
        body.rating === null
      ) {
        return reply.status(400).send({
          success: false,
          message: 'rating is required',
        });
      }

      const rating = Number(body.rating);

      if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {
        return reply.status(400).send({
          success: false,
          message: 'rating must be an integer from 1 to 5',
        });
      }

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      // -------------------------------------------------------
      // Check booking belongs to current user
      // -------------------------------------------------------
      const { data: booking, error: bookingError } =
        await userSupabase
          .from('bookings')
          .select(`
            id,
            user_id,
            room_id,
            status
          `)
          .eq('id', bookingId)
          .maybeSingle();

      if (bookingError) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get booking',
          error: bookingError.message,
        });
      }

      if (!booking) {
        return reply.status(404).send({
          success: false,
          message: 'Booking not found',
        });
      }

      // -------------------------------------------------------
      // Review only after checkout
      // -------------------------------------------------------
      if (booking.status !== 'CHECKED_OUT') {
        return reply.status(409).send({
          success: false,
          message:
            'Review can only be created after checkout',
        });
      }

      // -------------------------------------------------------
      // Check existing review
      // -------------------------------------------------------
      const { data: existingReview } =
        await userSupabase
          .from('reviews')
          .select('id')
          .eq('booking_id', bookingId)
          .maybeSingle();

      if (existingReview) {
        return reply.status(409).send({
          success: false,
          message:
            'A review already exists for this booking',
        });
      }

      // -------------------------------------------------------
      // Create review
      // -------------------------------------------------------
      const { data, error } =
        await userSupabase
          .from('reviews')
          .insert({
            booking_id: bookingId,
            user_id: request.user.id,
            room_id: booking.room_id,
            rating,
            comment: body.comment?.trim() || null,
            status: 'PUBLISHED',
          })
          .select(`
            id,
            booking_id,
            user_id,
            room_id,
            rating,
            comment,
            status,
            created_at
          `)
          .single();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to create review',
          error: error.message,
        });
      }

      return reply.status(201).send({
        success: true,
        message: 'Review created successfully',
        data,
      });
    },
  );

  // =========================================================
  // UPDATE MY REVIEW
  // PATCH /api/reviews/:id
  // =========================================================
  app.patch(
    '/api/reviews/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const body = request.body as {
        rating?: number;
        comment?: string;
      };

      const updateData: {
        rating?: number;
        comment?: string | null;
      } = {};

      if (body.rating !== undefined) {
        const rating = Number(body.rating);

        if (
          !Number.isInteger(rating) ||
          rating < 1 ||
          rating > 5
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'rating must be an integer from 1 to 5',
          });
        }

        updateData.rating = rating;
      }

      if (body.comment !== undefined) {
        updateData.comment =
          body.comment?.trim() || null;
      }

      if (Object.keys(updateData).length === 0) {
        return reply.status(400).send({
          success: false,
          message:
            'At least one field is required',
        });
      }

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } =
        await userSupabase
          .from('reviews')
          .update(updateData)
          .eq('id', id)
          .select(`
            id,
            booking_id,
            user_id,
            room_id,
            rating,
            comment,
            status,
            created_at
          `)
          .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to update review',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Review not found',
        });
      }

      return {
        success: true,
        message: 'Review updated successfully',
        data,
      };
    },
  );
}