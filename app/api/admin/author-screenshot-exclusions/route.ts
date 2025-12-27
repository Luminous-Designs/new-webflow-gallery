import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === ADMIN_PASSWORD;
}

function json(body: unknown, init?: number | ResponseInit) {
  return NextResponse.json(body, typeof init === 'number' ? { status: init } : init);
}

// GET - List all author screenshot exclusions
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('author_screenshot_exclusions')
      .select('*')
      .order('author_name', { ascending: true, nullsFirst: true })
      .order('author_id', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw error;
    return json({ exclusions: data || [] });
  } catch (error) {
    console.error('Failed to fetch author screenshot exclusions:', error);
    return json({ error: 'Failed to fetch exclusions' }, 500);
  }
}

// POST - Add or upsert an author screenshot exclusion
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const obj = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const authorId = typeof obj.author_id === 'string' ? obj.author_id.trim() : '';
  const authorName = typeof obj.author_name === 'string' ? obj.author_name.trim() : '';
  const selector = typeof obj.selector === 'string' ? obj.selector.trim() : '';
  const selectorType = typeof obj.selector_type === 'string' ? obj.selector_type : 'selector';
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';

  if (!authorId) return json({ error: 'author_id is required' }, 400);
  if (!selector) return json({ error: 'selector is required' }, 400);

  const normalizedType = ['class', 'id', 'selector'].includes(selectorType) ? selectorType : 'selector';

  const { data, error } = await supabaseAdmin
    .from('author_screenshot_exclusions')
    .upsert({
      author_id: authorId,
      author_name: authorName || null,
      selector,
      selector_type: normalizedType,
      description: description || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'author_id,selector' })
    .select()
    .single();

  if (error) {
    console.error('Failed to upsert author screenshot exclusion:', error);
    return json({ error: error.message }, 500);
  }

  return json({ exclusion: data }, 201);
}

// PATCH - Update an author screenshot exclusion
export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const obj = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const id = typeof obj.id === 'number' ? obj.id : Number(obj.id);
  if (!Number.isFinite(id)) return json({ error: 'id is required' }, 400);

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof obj.is_active === 'boolean') updateData.is_active = obj.is_active;
  if (typeof obj.description === 'string') updateData.description = obj.description.trim() || null;
  if (typeof obj.author_name === 'string') updateData.author_name = obj.author_name.trim() || null;

  const { data, error } = await supabaseAdmin
    .from('author_screenshot_exclusions')
    .update(updateData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Failed to update author screenshot exclusion:', error);
    return json({ error: error.message }, 500);
  }

  return json({ exclusion: data });
}

// DELETE - Remove an author screenshot exclusion
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get('id');
  const id = idParam ? Number(idParam) : NaN;
  if (!Number.isFinite(id)) {
    return json({ error: 'Valid id is required' }, 400);
  }

  const { error, count } = await supabaseAdmin
    .from('author_screenshot_exclusions')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) {
    console.error('Failed to delete author screenshot exclusion:', error);
    return json({ error: error.message }, 500);
  }

  if (!count) return json({ error: 'Exclusion not found' }, 404);
  return json({ success: true, deleted: id });
}

