import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/admin/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, init?: number | ResponseInit) {
  const res = NextResponse.json(body, typeof init === 'number' ? { status: init } : init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function getExisting(authorId: string): Promise<{ is_active: boolean } | null> {
  const { data, error } = await supabaseAdmin
    .from('featured_authors')
    .select('is_active')
    .eq('author_id', authorId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return { is_active: Boolean(data.is_active) };
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const obj = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const authorId = typeof obj.authorId === 'string' ? obj.authorId.trim() : '';
  const authorName = typeof obj.authorName === 'string' ? obj.authorName.trim() : '';
  if (!authorId) return json({ error: 'authorId is required' }, 400);

  const existing = await getExisting(authorId);
  const desired: boolean =
    typeof obj.set === 'boolean' ? obj.set : !(existing?.is_active ?? false);

  if (!desired) {
    await supabaseAdmin.from('featured_authors').update({ is_active: false }).eq('author_id', authorId);
    return json({ isFeaturedAuthor: false });
  }

  if (!authorName) {
    return json({ error: 'authorName is required to feature an author' }, 400);
  }

  const { error } = await supabaseAdmin
    .from('featured_authors')
    .upsert({ author_id: authorId, author_name: authorName, is_active: true }, { onConflict: 'author_id' });
  if (error) return json({ error: error.message }, 500);

  return json({ isFeaturedAuthor: true });
}
