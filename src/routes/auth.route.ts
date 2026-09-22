import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase, createUserSupabaseClient } from '../lib/supabase.js';
import { authenticate } from '../middleware/auth.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const updateProfileSchema = z.object({
  full_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional(),
  avatar_url: z.string().url().optional(),
});

export async function authRoute(app: FastifyInstance) {
  // =========================================================
  // REGISTER
  // =========================================================
  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        message: 'Invalid request',
        errors: parsed.error.flatten(),
      });
    }

    const { email, password, full_name } = parsed.data;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name,
        },
      },
    });

    if (error) {
      return reply.code(400).send({
        success: false,
        message: error.message,
      });
    }

    return reply.code(201).send({
      success: true,
      message: data.session
        ? 'Registration successful'
        : 'Registration successful. Please confirm your email.',
      user: data.user,
      session: data.session,
      email_confirmation_required: !data.session,
    });
  });

  // =========================================================
  // LOGIN
  // =========================================================
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        message: 'Invalid request',
        errors: parsed.error.flatten(),
      });
    }

    const { email, password } = parsed.data;

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return reply.code(401).send({
        success: false,
        message: error.message,
      });
    }

    return reply.send({
      success: true,
      message: 'Login successful',
      user: data.user,
      session: data.session,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  });

  // =========================================================
  // REFRESH TOKEN
  // =========================================================
  app.post('/api/auth/refresh', async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        success: false,
        message: 'Refresh token is required',
      });
    }

    const { refresh_token } = parsed.data;

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return reply.code(401).send({
        success: false,
        message: error?.message ?? 'Invalid refresh token',
      });
    }

    return reply.send({
      success: true,
      message: 'Token refreshed successfully',
      user: data.user,
      session: data.session,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  });

  // =========================================================
  // LOGOUT
  // =========================================================
  app.post(
    '/api/auth/logout',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.code(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const userClient = createUserSupabaseClient(token);

      const { error } = await userClient.auth.signOut();

      if (error) {
        return reply.code(400).send({
          success: false,
          message: error.message,
        });
      }

      return reply.send({
        success: true,
        message: 'Logout successful',
      });
    },
  );

  // =========================================================
  // GET CURRENT USER
  // =========================================================
  app.get(
    '/api/auth/me',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.code(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const userClient = createUserSupabaseClient(token);

      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user) {
        return reply.code(401).send({
          success: false,
          message: userError?.message ?? 'Unauthorized',
        });
      }

      const { data: profile, error: profileError } = await userClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError) {
        return reply.code(500).send({
          success: false,
          message: profileError.message,
        });
      }

      const { data: role, error: roleError } = await userClient
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (roleError) {
        return reply.code(500).send({
          success: false,
          message: roleError.message,
        });
      }

      return reply.send({
        success: true,
        user,
        profile,
        role: role?.role ?? 'CUSTOMER',
      });
    },
  );

  // =========================================================
  // UPDATE CURRENT PROFILE
  // =========================================================
  app.patch(
    '/api/auth/me',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const parsed = updateProfileSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          success: false,
          message: 'Invalid request',
          errors: parsed.error.flatten(),
        });
      }

      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply.code(401).send({
          success: false,
          message: 'Missing access token',
        });
      }

      const userClient = createUserSupabaseClient(token);

      const {
        data: { user },
        error: userError,
      } = await userClient.auth.getUser();

      if (userError || !user) {
        return reply.code(401).send({
          success: false,
          message: 'Unauthorized',
        });
      }

      const updateData = {
        ...parsed.data,
        updated_at: new Date().toISOString(),
      };

      const { data: profile, error: profileError } = await userClient
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select()
        .single();

      if (profileError) {
        return reply.code(400).send({
          success: false,
          message: profileError.message,
        });
      }

      // Đồng bộ full_name vào Supabase Auth metadata
      if (parsed.data.full_name !== undefined) {
        await userClient.auth.updateUser({
          data: {
            full_name: parsed.data.full_name,
          },
        });
      }

      return reply.send({
        success: true,
        message: 'Profile updated successfully',
        user,
        profile,
      });
    },
  );
}