import {
  createNotification,
} from './notification.service.js';

interface BookingNotificationData {
  userId: string;
  bookingCode: string;
  roomName?: string;
  startAt?: string;
  endAt?: string;
}

export async function notifyBookingCreated(
  data: BookingNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'BOOKING_CREATED',
    title: 'Booking created',
    message:
      `Booking ${data.bookingCode} has been created successfully.`,
  });
}

export async function notifyBookingConfirmed(
  data: BookingNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'BOOKING_CONFIRMED',
    title: 'Booking confirmed',
    message:
      `Booking ${data.bookingCode} has been confirmed.`,
  });
}

export async function notifyBookingCancelled(
  data: BookingNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'BOOKING_CANCELLED',
    title: 'Booking cancelled',
    message:
      `Booking ${data.bookingCode} has been cancelled.`,
  });
}

export async function notifyBookingCheckedIn(
  data: BookingNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'BOOKING_CHECKED_IN',
    title: 'Check-in confirmed',
    message:
      `Booking ${data.bookingCode} has been checked in.`,
  });
}

export async function notifyBookingCheckedOut(
  data: BookingNotificationData,
) {
  return createNotification({
    userId: data.userId,
    type: 'BOOKING_CHECKED_OUT',
    title: 'Check-out completed',
    message:
      `Booking ${data.bookingCode} has been checked out.`,
  });
}