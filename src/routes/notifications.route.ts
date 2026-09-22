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

export async function notificationsRoute(app: FastifyInstance) {
  // =========================================================
  // GET MY NOTIFICATIONS
  // GET /api/notifications
  // =========================================================
  app.get(
    '/api/notifications',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const query = request.query as {
        unread_only?: string;
        limit?: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const limit = Math.min(
        Math.max(Number(query.limit ?? 50), 1),
        100,
      );

      let dbQuery = userSupabase
        .from('notifications')
        .select(`
          id,
          user_id,
          type,
          title,
          message,
          read_at,
          created_at
        `)
        .order('created_at', {
          ascending: false,
        })
        .limit(limit);

      if (query.unread_only === 'true') {
        dbQuery = dbQuery.is('read_at', null);
      }

      const { data, error } = await dbQuery;

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get notifications',
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
  // GET NOTIFICATION DETAIL
  // GET /api/notifications/:id
  // =========================================================
  app.get(
    '/api/notifications/:id',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('notifications')
        .select(`
          id,
          user_id,
          type,
          title,
          message,
          read_at,
          created_at
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to get notification',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Notification not found',
        });
      }

      return {
        success: true,
        data,
      };
    },
  );

  // =========================================================
  // MARK ONE NOTIFICATION AS READ
  // PATCH /api/notifications/:id/read
  // =========================================================
  app.patch(
    '/api/notifications/:id/read',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const { id } = request.params as {
        id: string;
      };

      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('notifications')
        .update({
          read_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(`
          id,
          user_id,
          type,
          title,
          message,
          read_at,
          created_at
        `)
        .maybeSingle();

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to mark notification as read',
          error: error.message,
        });
      }

      if (!data) {
        return reply.status(404).send({
          success: false,
          message: 'Notification not found',
        });
      }

      return {
        success: true,
        message: 'Notification marked as read',
        data,
      };
    },
  );

  // =========================================================
  // MARK ALL NOTIFICATIONS AS READ
  // PATCH /api/notifications/read-all
  // =========================================================
  app.patch(
    '/api/notifications/read-all',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const accessToken = getAccessToken(request);

      const userSupabase =
        createUserSupabaseClient(accessToken);

      const { data, error } = await userSupabase
        .from('notifications')
        .update({
          read_at: new Date().toISOString(),
        })
        .is('read_at', null)
        .select(`
          id,
          user_id,
          type,
          title,
          message,
          read_at,
          created_at
        `);

      if (error) {
        return reply.status(400).send({
          success: false,
          message: 'Failed to mark notifications as read',
          error: error.message,
        });
      }

      return {
        success: true,
        message: 'All notifications marked as read',
        data,
        count: data?.length ?? 0,
      };
    },
  );
}