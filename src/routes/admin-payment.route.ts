import type { FastifyInstance } from 'fastify';
import { createUserSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import {
  notifyPaymentReceived,
  notifyPaymentRefunded,
} from '../services/payment-notification.service.js';

function getAccessToken(request: any): string {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Missing access token');
  }

  return authorization.slice(7).trim();
}

function mapAdminPaymentError(message: string) {
  const upper = message.toUpperCase();

  if (upper.includes('ADMIN_REQUIRED')) {
    return {
      status: 403,
      message: 'Admin access required',
    };
  }

  if (upper.includes('BOOKING_NOT_FOUND')) {
    return {
      status: 404,
      message: 'Booking not found',
    };
  }

  if (
    upper.includes('INVALID_PAYMENT_STATUS') ||
    upper.includes('PAYMENT_AMOUNT_REQUIRED') ||
    upper.includes('PAYMENT_AMOUNT_MISMATCH') ||
    upper.includes('INVALID_PARTIAL_AMOUNT') ||
    upper.includes('NO_SUCCESSFUL_PAYMENT') ||
    upper.includes('TRANSACTION_ALREADY_EXISTS')
  ) {
    return {
      status: 409,
      message,
    };
  }

  return {
    status: 400,
    message,
  };
}

export async function adminPaymentRoute(app: FastifyInstance) {
  // =========================================================
  // GET PAYMENT HISTORY
  // GET /api/admin/bookings/:bookingId/payments
  // =========================================================
  app.get(
    '/api/admin/bookings/:bookingId/payments',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

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
        .order('created_at', {
          ascending: false,
        });

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

  // =========================================================
  // UPDATE PAYMENT STATUS
  // PATCH /api/admin/bookings/:bookingId/payment
  // =========================================================
  app.patch(
    '/api/admin/bookings/:bookingId/payment',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { bookingId } = request.params as {
        bookingId: string;
      };

      const body = request.body as {
        payment_status?: string;
        provider?: string;
        transaction_id?: string;
        amount?: number;
      };

      const allowedStatuses = [
        'UNPAID',
        'PARTIAL',
        'PAID',
        'FAILED',
        'REFUNDED',
      ];

      // -------------------------------------------------------
      // Validate payment_status
      // -------------------------------------------------------
      if (!body.payment_status) {
        return reply.status(400).send({
          success: false,
          message: 'payment_status is required',
        });
      }

      if (!allowedStatuses.includes(body.payment_status)) {
        return reply.status(400).send({
          success: false,
          message: 'Invalid payment_status',
          allowed_statuses: allowedStatuses,
        });
      }

      // -------------------------------------------------------
      // Validate amount
      // -------------------------------------------------------
      if (
        body.payment_status === 'PAID' ||
        body.payment_status === 'PARTIAL'
      ) {
        if (
          body.amount === undefined ||
          body.amount === null ||
          Number.isNaN(Number(body.amount)) ||
          Number(body.amount) <= 0
        ) {
          return reply.status(400).send({
            success: false,
            message:
              'amount is required and must be greater than 0',
          });
        }
      }

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      // -------------------------------------------------------
      // Call Admin Payment RPC
      // -------------------------------------------------------
      const { data, error } = await userSupabase.rpc(
        'admin_update_booking_payment',
        {
          p_booking_id: bookingId,
          p_payment_status: body.payment_status,
          p_provider: body.provider ?? 'MANUAL',
          p_transaction_id:
            body.transaction_id ?? null,
          p_amount:
            body.amount !== undefined
              ? Number(body.amount)
              : null,
        },
      );

      if (error) {
        const mapped = mapAdminPaymentError(
          error.message,
        );

        return reply.status(mapped.status).send({
          success: false,
          message: mapped.message,
          error: error.message,
        });
      }

      // const booking = Array.isArray(data)
      //   ? data[0]
      //   : data;

      // return {
      //   success: true,
      //   message: 'Payment status updated successfully',
      //   data: booking,
      // };
      const booking = Array.isArray(data)
        ? data[0]
        : data;

      if (!booking) {
        return reply.status(500).send({
          success: false,
          message: 'Payment update returned no booking data',
        });
      }

      try {
        if (body.payment_status === 'PAID') {
          await notifyPaymentReceived({
            userId: booking.user_id,
            bookingCode: booking.booking_code,
            amount: body.amount,
            currency: booking.currency,
          });
        }

        if (body.payment_status === 'REFUNDED') {
          await notifyPaymentRefunded({
            userId: booking.user_id,
            bookingCode: booking.booking_code,
            currency: booking.currency,
          });
        }
      } catch (notificationError) {
        request.log.error(
          notificationError,
          'Failed to create payment notification',
        );
      }

      return {
        success: true,
        message: 'Payment status updated successfully',
        data: booking,
      };

    },
  );
}