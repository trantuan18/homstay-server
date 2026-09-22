import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from '../lib/supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: {
      id: string;
      email?: string;
    };
  }
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authorization = request.headers.authorization;

  if (!authorization?.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      message: 'Missing access token',
    });
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return reply.status(401).send({
      success: false,
      message: 'Invalid access token',
    });
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return reply.status(401).send({
      success: false,
      message: 'Invalid access token',
    });
  }

  request.user = {
    id: data.user.id,
    email: data.user.email,
  };
}