import { supabaseAdmin } from '../lib/supabase.js';

export type NotificationType =
  | 'BOOKING_CREATED'
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_REFUNDED'
  | 'BOOKING_CHECKED_IN'
  | 'BOOKING_CHECKED_OUT'
  | 'SYSTEM';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
}

export async function createNotification(
  params: CreateNotificationParams,
) {
  const {
    userId,
    type,
    title,
    message,
  } = params;

  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }

  if (!title?.trim()) {
    throw new Error('NOTIFICATION_TITLE_REQUIRED');
  }

  if (!message?.trim()) {
    throw new Error('NOTIFICATION_MESSAGE_REQUIRED');
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title: title.trim(),
      message: message.trim(),
    })
    .select(`
      id,
      user_id,
      type,
      title,
      message,
      read_at,
      created_at
    `)
    .single();

  if (error) {
    throw new Error(
      `NOTIFICATION_CREATE_FAILED: ${error.message}`,
    );
  }

  return data;
}