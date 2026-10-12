import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin, createUserSupabaseClient } from '../lib/supabase.js';

async function requireAdmin(request: any, reply: any) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({
      success: false,
      message: 'Missing access token',
    });
    return null;
  }
  const token = authHeader.substring(7);
  const userClient = createUserSupabaseClient(token);
  const { data, error } = await userClient.rpc('is_admin');
  if (error || data !== true) {
    reply.code(403).send({
      success: false,
      message: 'ADMIN_REQUIRED',
    });
    return null;
  }
  return { token, actorId: request.user?.id };
}

export async function adminAuditLogsRoute(app: FastifyInstance) {
  app.get(
    '/api/admin/audit-logs',
    { preHandler: authenticate },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply);
      if (!admin) return;

      const query = request.query as {
        action?: string;
        entity_type?: string;
        user_id?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 100);
      const offset = Math.max(Number(query.offset ?? 0), 0);

      let dbQuery = supabaseAdmin
        .from('audit_logs')
        .select(
          `
          id,
          user_id,
          action,
          entity_type,
          entity_id,
          old_value,
          new_value,
          created_at,
          profiles:user_id (
            id,
            full_name,
            avatar_url
          )
        `,
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (query.action?.trim()) {
        dbQuery = dbQuery.eq('action', query.action.trim());
      }
      if (query.entity_type?.trim()) {
        dbQuery = dbQuery.eq('entity_type', query.entity_type.trim());
      }
      if (query.user_id?.trim()) {
        dbQuery = dbQuery.eq('user_id', query.user_id.trim());
      }

      const { data, error, count } = await dbQuery;

      if (error) {
        const fallbackQuery = await supabaseAdmin
          .from('audit_logs')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (fallbackQuery.error) {
          return reply.code(400).send({
            success: false,
            message: 'Failed to fetch audit logs',
            error: fallbackQuery.error.message,
          });
        }

        return reply.send({
          success: true,
          data: fallbackQuery.data ?? [],
          pagination: {
            total: fallbackQuery.count ?? 0,
            limit,
            offset,
          },
        });
      }

      return reply.send({
        success: true,
        data: data ?? [],
        pagination: {
          total: count ?? 0,
          limit,
          offset,
        },
      });
    },
  );
}
