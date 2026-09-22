import {
  createNotification,
} from './notification.service.js';

interface PaymentNotificationData {
  userId: string;
  bookingCode: string;
  amount?: number;
  currency?: string;
}

export async function notifyPaymentReceived(
  data: PaymentNotificationData,
) {
  const amountText =
    data.amount !== undefined
      ? ` Amount: ${data.amount} ${data.currency ?? 'VND'}.`
      : '';

  return createNotification({
    userId: data.userId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment received',
    message:
      `Payment for booking ${data.bookingCode} has been received.${amountText}`,
  });
}

export async function notifyPaymentRefunded(
  data: PaymentNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'PAYMENT_REFUNDED',
    title: 'Payment refunded',
    message:
      `Payment for booking ${data.bookingCode} has been refunded.`,
  });
}