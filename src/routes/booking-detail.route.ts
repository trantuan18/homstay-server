import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { createUserSupabaseClient } from '../lib/supabase.js';

export async function bookingDetailRoute(
  app: FastifyInstance,
) {
  app.get(
    '/api/bookings/:id/detail',
    { preHandler: authenticate },
    async (request, reply) => {
      const authHeader =
        request.headers.authorization;

      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const token = authHeader.substring(7);

      const userClient =
        createUserSupabaseClient(token);

      /*
       * =========================
       * CURRENT USER
       * =========================
       */

      const {
        data: authData,
        error: authError,
      } = await userClient.auth.getUser();

      if (
        authError ||
        !authData.user
      ) {
        return reply.code(401).send({
          success: false,
          message: 'UNAUTHORIZED',
        });
      }

      const userId =
        authData.user.id;

      const { id } =
        request.params as {
          id: string;
        };

      /*
       * =========================
       * BOOKING
       * =========================
       */

      const {
        data: booking,
        error: bookingError,
      } = await userClient
        .from('bookings')
        .select(
          `
          id,
          booking_code,
          user_id,
          property_id,
          room_id,
          start_at,
          end_at,
          guest_count,
          guest_name,
          guest_phone,
          guest_email,
          subtotal,
          discount,
          tax,
          total,
          currency,
          status,
          payment_status,
          expires_at,
          notes,
          cancellation_reason,
          cancelled_at,
          created_at,
          updated_at
        `,
        )
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (
        bookingError ||
        !booking
      ) {
        return reply.code(404).send({
          success: false,
          message: 'BOOKING_NOT_FOUND',
        });
      }

      /*
       * =========================
       * PROPERTY
       * =========================
       */

      const {
        data: property,
      } = await userClient
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
          check_in_time,
          check_out_time
        `,
        )
        .eq(
          'id',
          booking.property_id,
        )
        .single();

      /*
       * =========================
       * ROOM
       * =========================
       */

      const {
        data: room,
      } = await userClient
        .from('rooms')
        .select(
          `
          id,
          name,
          slug,
          description,
          capacity,
          base_hourly_price,
          base_daily_price,
          status
        `,
        )
        .eq(
          'id',
          booking.room_id,
        )
        .single();

      /*
       * =========================
       * ROOM IMAGES
       * =========================
       */

      const {
        data: images,
      } = await userClient
        .from('room_images')
        .select(
          `
          id,
          image_url,
          public_id,
          sort_order
        `,
        )
        .eq(
          'room_id',
          booking.room_id,
        )
        .order(
          'sort_order',
          { ascending: true },
        );

      /*
       * =========================
       * PAYMENTS
       * =========================
       */

      const {
        data: payments,
      } = await userClient
        .from('payments')
        .select(
          `
          id,
          provider,
          transaction_id,
          amount,
          currency,
          status,
          paid_at,
          created_at
        `,
        )
        .eq(
          'booking_id',
          booking.id,
        )
        .order(
          'created_at',
          { ascending: false },
        );

      /*
       * =========================
       * REVIEW
       * =========================
       */

      const {
        data: review,
      } = await userClient
        .from('reviews')
        .select(
          `
          id,
          rating,
          comment,
          status,
          created_at
        `,
        )
        .eq(
          'booking_id',
          booking.id,
        )
        .maybeSingle();

      /*
       * =========================
       * RESPONSE
       * =========================
       */

      return reply.send({
        success: true,

        data: {
          booking,

          property,

          room,

          images:
            images ?? [],

          payments:
            payments ?? [],

          review:
            review ?? null,
        },
      });
    },
  );
}