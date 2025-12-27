import { createClient } from '@/utils/supabase/server';
import type { User } from '@supabase/supabase-js';

const ADMIN_EMAIL = 'luminousthemes@gmail.com';

export type AdminAuthResult =
  | { ok: true; user: User }
  | { ok: false; status: 401; error: string };

export async function requireAdminUser(): Promise<AdminAuthResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;

  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const email = (user.email || '').toLowerCase();
  if (email !== ADMIN_EMAIL) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  return { ok: true, user };
}

