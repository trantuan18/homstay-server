import type { FastifyInstance } from 'fastify';
import {
  createUserSupabaseClient,
} from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;
  return authorization.slice(7).trim();
}

export async function paymentsRoute(app: FastifyInstance) {
  /**
   * GET /api/bookings/:bookingId/payments
   *
   * Customer xem payment của booking của mình.
   * Host có thể xem nếu RLS cho phép theo booking/property.
   */
  app.get(
    '/api/bookings/:bookingId/payments',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('payments')
        .select(`
          id,
          booking_id,
          user_id,
          provider,
          transaction_id,
          amount,
          currency,
          status,
          paid_at,
          created_at
        `)
        .eq('booking_id', bookingId)
        .order('created_at', { ascending: false });

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get payments',
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
   * POST /api/bookings/:bookingId/payment/confirm
   *
   * TEST ONLY:
   * Xác nhận thanh toán bằng RPC confirm_booking_payment().
   */
  app.post(
    '/api/bookings/:bookingId/payment/confirm',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const body = request.body as {
        provider?: string;
        transaction_id?: string;
        amount?: number;
      };

      if (!body.provider) {
        return reply.status(400).send({
          success: false,
          message: 'provider is required',
        });
      }

      if (!body.transaction_id) {
        return reply.status(400).send({
          success: false,
          message: 'transaction_id is required',
        });
      }

      if (
        typeof body.amount !== 'number' ||
        body.amount <= 0
      ) {
        return reply.status(400).send({
          success: false,
          message: 'amount must be a positive number',
        });
      }

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase.rpc(
        'confirm_booking_payment',
        {
          p_booking_id: bookingId,
          p_provider: body.provider,
          p_transaction_id: body.transaction_id,
          p_amount: body.amount,
        },
      );

      if (error) {
        const message = error.message.toUpperCase();

        let status = 400;

        if (message.includes('AUTH_REQUIRED')) {
          status = 401;
        }

        if (
          message.includes('BOOKING_NOT_FOUND') ||
          message.includes('BOOKING_NOT_OWNED')
        ) {
          status = 404;
        }

        if (
          message.includes('AMOUNT_MISMATCH') ||
          message.includes('INVALID_BOOKING_STATUS') ||
          message.includes('TRANSACTION_ALREADY_EXISTS')
        ) {
          status = 409;
        }

        return reply.status(status).send({
          success: false,
          message: error.message,
          error: error.message,
        });
      }

      const payment = Array.isArray(data) ? data[0] : data;

      return reply.status(201).send({
        success: true,
        message: 'Payment confirmed successfully',
        data: payment,
      });
    },
  );

  /**
   * POST /api/bookings/:bookingId/payment/refund
   *
   * TEST ONLY.
   */
  app.post(
    '/api/bookings/:bookingId/payment/refund',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const accessToken = getAccessToken(request);
      const userSupabase = createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase.rpc(
        'refund_booking_payment',
        {
          p_booking_id: bookingId,
        },
      );

      if (error) {
        return reply.status(400).send({
          success: false,
          message: error.message,
          error: error.message,
        });
      }

      const payment = Array.isArray(data) ? data[0] : data;

      return {
        success: true,
        message: 'Payment refunded successfully',
        data: payment,
      };
    },
  );
}