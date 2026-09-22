import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import {
  supabaseAdmin,
  createUserSupabaseClient,
} from '../lib/supabase.js';

const VALID_ROLES = [
  'CUSTOMER',
  'HOST',
  'STAFF',
  'ADMIN',
  'SUPER_ADMIN',
] as const;

type Role = (typeof VALID_ROLES)[number];

async function requireAdmin(
  request: any,
  reply: any,
) {
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

  const actorId = request.user?.id;

  if (!actorId) {
    reply.code(401).send({
      success: false,
      message: 'UNAUTHORIZED',
    });
    return null;
  }

  const { data: actorRole, error: actorRoleError } =
    await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', actorId)
      .single();

  if (actorRoleError || !actorRole) {
    reply.code(403).send({
      success: false,
      message: 'ADMIN_ROLE_NOT_FOUND',
    });
    return null;
  }

  return {
    actorId,
    actorRole: actorRole.role as Role,
  };
}

export async function adminUsersRoute(app: FastifyInstance) {
  /**
   * GET /api/admin/users
   * List users
   */
  app.get(
    '/api/admin/users',
    { preHandler: authenticate },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply);

      if (!admin) return;

      const query = request.query as {
        role?: string;
        search?: string;
        limit?: string;
        offset?: string;
      };

      const limit = Math.min(
        Math.max(Number(query.limit) || 20, 1),
        100,
      );

      const offset = Math.max(
        Number(query.offset) || 0,
        0,
      );

      let dbQuery = supabaseAdmin
        .from('profiles')
        .select(
          `
          id,
          full_name,
          phone,
          avatar_url,
          created_at,
          updated_at,
          user_roles!inner (
            role
          )
        `,
          { count: 'exact' },
        );

      if (query.role) {
        if (!VALID_ROLES.includes(query.role as Role)) {
          return reply.code(400).send({
            success: false,
            message: 'INVALID_ROLE',
          });
        }

        dbQuery = dbQuery.eq(
          'user_roles.role',
          query.role,
        );
      }

      if (query.search) {
        const search = query.search.trim();

        if (search) {
          dbQuery = dbQuery.or(
            `full_name.ilike.%${search}%,phone.ilike.%${search}%`,
          );
        }
      }

      const {
        data,
        error,
        count,
      } = await dbQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return reply.code(500).send({
          success: false,
          message: error.message,
        });
      }

      const users = (data ?? []).map((user: any) => ({
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        updated_at: user.updated_at,
        role: user.user_roles?.[0]?.role ?? null,
      }));

      return reply.send({
        success: true,
        data: users,
        pagination: {
          limit,
          offset,
          total: count ?? 0,
        },
      });
    },
  );

  /**
   * GET /api/admin/users/:id
   * User detail
   */
  app.get(
    '/api/admin/users/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply);

      if (!admin) return;

      const { id } = request.params as {
        id: string;
      };

      const {
        data,
        error,
      } = await supabaseAdmin
        .from('profiles')
        .select(
          `
          id,
          full_name,
          phone,
          avatar_url,
          created_at,
          updated_at,
          user_roles (
            role,
            created_at
          )
        `,
        )
        .eq('id', id)
        .single();

      if (error || !data) {
        return reply.code(404).send({
          success: false,
          message: 'USER_NOT_FOUND',
        });
      }

      // Email nằm trong auth.users nên lấy qua Admin API
      const {
        data: authUser,
      } = await supabaseAdmin.auth.admin.getUserById(id);

      return reply.send({
        success: true,
        data: {
          id: data.id,
          email: authUser?.user?.email ?? null,
          full_name: data.full_name,
          phone: data.phone,
          avatar_url: data.avatar_url,
          role: data.user_roles?.[0]?.role ?? null,
          role_created_at:
            data.user_roles?.[0]?.created_at ?? null,
          created_at: data.created_at,
          updated_at: data.updated_at,
        },
      });
    },
  );

  /**
   * PATCH /api/admin/users/:id/role
   * Change user role
   */
  app.patch(
    '/api/admin/users/:id/role',
    { preHandler: authenticate },
    async (request, reply) => {
      const admin = await requireAdmin(request, reply);

      if (!admin) return;

      const { id } = request.params as {
        id: string;
      };

      const body = request.body as {
        role?: string;
      };

      const newRole = body?.role as Role;

      if (!VALID_ROLES.includes(newRole)) {
        return reply.code(400).send({
          success: false,
          message: 'INVALID_ROLE',
          valid_roles: VALID_ROLES,
        });
      }

      /**
       * Không cho admin tự đổi role của chính mình.
       * Tránh trường hợp admin tự hạ quyền rồi mất quyền quản trị.
       */
      if (id === admin.actorId) {
        return reply.code(400).send({
          success: false,
          message: 'CANNOT_CHANGE_OWN_ROLE',
        });
      }

      /**
       * Chỉ SUPER_ADMIN được cấp SUPER_ADMIN.
       */
      if (
        newRole === 'SUPER_ADMIN' &&
        admin.actorRole !== 'SUPER_ADMIN'
      ) {
        return reply.code(403).send({
          success: false,
          message: 'SUPER_ADMIN_REQUIRED',
        });
      }

      /**
       * Kiểm tra user tồn tại.
       */
      const {
        data: targetUser,
        error: targetUserError,
      } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', id)
        .single();

      if (targetUserError || !targetUser) {
        return reply.code(404).send({
          success: false,
          message: 'USER_NOT_FOUND',
        });
      }

      /**
       * Lấy role hiện tại để ghi audit.
       */
      const {
        data: currentRole,
      } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', id)
        .single();

      if (!currentRole) {
        return reply.code(404).send({
          success: false,
          message: 'USER_ROLE_NOT_FOUND',
        });
      }

      /**
       * Không cần update nếu role không thay đổi.
       */
      if (currentRole.role === newRole) {
        return reply.send({
          success: true,
          message: 'ROLE_ALREADY_SET',
          data: {
            user_id: id,
            role: newRole,
          },
        });
      }

      /**
       * Update role bằng service role.
       * Không phụ thuộc RLS client.
       */
      const {
        data: updatedRole,
        error: updateError,
      } = await supabaseAdmin
        .from('user_roles')
        .update({
          role: newRole,
        })
        .eq('user_id', id)
        .select('user_id, role, created_at')
        .single();

      if (updateError || !updatedRole) {
        return reply.code(500).send({
          success: false,
          message:
            updateError?.message ?? 'ROLE_UPDATE_FAILED',
        });
      }

      /**
       * Ghi audit log.
       */
      await supabaseAdmin
        .from('audit_logs')
        .insert({
          user_id: admin.actorId,
          action: 'UPDATE_USER_ROLE',
          entity_type: 'USER',
          entity_id: id,
          old_value: {
            role: currentRole.role,
          },
          new_value: {
            role: newRole,
          },
        });

      return reply.send({
        success: true,
        message: 'ROLE_UPDATED',
        data: {
          user_id: updatedRole.user_id,
          role: updatedRole.role,
        },
      });
    },
  );
}