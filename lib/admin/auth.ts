import { type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import type { User } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'luminousthemes@gmail.com';

export type AdminAuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401; error: string };

function extractBearerToken(request?: NextRequest): string | null {
  if (!request) return null;
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function requireAdminUser(request?: NextRequest): Promise<AdminAuthResult> {
  const supabase = await createClient();
  let user: User | null = null;
  let error: unknown | null = null;

  // Prefer cookie-based auth (fast path).
  try {
    const res = await supabase.auth.getUser();
    user = res.data.user;
    error = res.error ?? null;
  } catch (e) {
    error = e;
  }

  // Fallback: accept a Supabase access token via Authorization header.
  // This keeps admin gallery tools working even if the browser session is stored client-side.
  if ((!user || error) && request) {
    const token = extractBearerToken(request);
    if (token) {
      try {
        const res = await supabase.auth.getUser(token);
        user = res.data.user;
        error = res.error ?? null;
      } catch (e) {
        error = e;
      }
    }
  }

  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  const email = (user.email || '').toLowerCase();
  if (email !== ADMIN_EMAIL) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true, user };
}
