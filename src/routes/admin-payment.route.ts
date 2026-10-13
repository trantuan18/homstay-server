import type { FastifyInstance } from 'fastify';
import { createUserSupabaseClient, supabaseAdmin } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';
import {
  notifyPaymentReceived,
  notifyPaymentRefunded,
} from '../services/payment-notification.service.js';
import { notifyBookingConfirmed } from '../services/booking-notification.service.js';

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

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      // -------------------------------------------------------
      // Auto-resolve amount for PAID if not provided
      // -------------------------------------------------------
      if (
        body.payment_status === 'PAID' &&
        (body.amount === undefined ||
          body.amount === null ||
          Number.isNaN(Number(body.amount)) ||
          Number(body.amount) <= 0)
      ) {
        const { data: bookingData } = await userSupabase
          .from('bookings')
          .select('total')
          .eq('id', bookingId)
          .single();

        if (bookingData?.total) {
          body.amount = Number(bookingData.total);
        }
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

      // -------------------------------------------------------
      // Call Admin Payment RPC with Direct DB Fallback
      // -------------------------------------------------------
      let booking: any = null;
      const { data: rpcData, error: rpcError } = await userSupabase.rpc(
        'admin_update_booking_payment',
        {
          p_booking_id: bookingId,
          p_payment_status: body.payment_status,
          p_provider: body.provider ?? 'MANUAL',
          p_transaction_id: body.transaction_id ?? null,
          p_amount:
            body.amount !== undefined ? Number(body.amount) : null,
        },
      );

      if (!rpcError && rpcData) {
        booking = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      } else {
        // Fallback: direct database update via service-role supabaseAdmin
        const { data: updatedBooking, error: directErr } = await supabaseAdmin
          .from('bookings')
          .update({
            payment_status: body.payment_status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId)
          .select()
          .single();

        if (directErr || !updatedBooking) {
          return reply.status(400).send({
            success: false,
            message: directErr?.message || rpcError?.message || 'Failed to update payment status',
          });
        }

        booking = updatedBooking;

        // Record payment in payments table if amount is given
        if (body.payment_status === 'PAID' || body.payment_status === 'PARTIAL') {
          await supabaseAdmin.from('payments').insert({
            booking_id: bookingId,
            user_id: booking.user_id,
            provider: body.provider ?? 'MANUAL',
            transaction_id: body.transaction_id ?? null,
            amount: body.amount ?? booking.total,
            currency: booking.currency ?? 'VND',
            status: 'SUCCESS',
            paid_at: new Date().toISOString(),
          });
        }
      }

      // -------------------------------------------------------
      // Auto-confirm booking if PAID and currently PENDING
      // -------------------------------------------------------
      if (body.payment_status === 'PAID') {
        const { data: currentBooking } = await supabaseAdmin
          .from('bookings')
          .select('status')
          .eq('id', bookingId)
          .single();

        if (currentBooking?.status === 'PENDING') {
          await supabaseAdmin
            .from('bookings')
            .update({
              status: 'CONFIRMED',
              updated_at: new Date().toISOString(),
            })
            .eq('id', bookingId);
          booking.status = 'CONFIRMED';

          notifyBookingConfirmed({
            userId: booking.user_id,
            bookingCode: booking.booking_code,
            startAt: booking.start_at,
            endAt: booking.end_at,
          }).catch(() => {});
        }
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