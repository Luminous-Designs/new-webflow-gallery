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

async function getExisting(templateId: number): Promise<{ position: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('ultra_featured_templates')
    .select('position')
    .eq('template_id', templateId)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return { position: data.position as number };
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  const { searchParams } = new URL(request.url);
  const templateId = Number(searchParams.get('templateId'));
  if (!Number.isFinite(templateId) || templateId <= 0) return json({ error: 'templateId is required' }, 400);

  const existing = await getExisting(templateId);
  return json({ isUltraFeatured: !!existing, position: existing?.position ?? null });
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

  const templateId = Number(obj.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) return json({ error: 'templateId is required' }, 400);

  const existing = await getExisting(templateId);
  const desired: boolean =
    typeof obj.set === 'boolean' ? obj.set : !existing;

  if (!desired) {
    await supabaseAdmin.from('ultra_featured_templates').delete().eq('template_id', templateId);
    return json({ isUltraFeatured: false, position: null });
  }

  if (existing) {
    return json({ isUltraFeatured: true, position: existing.position });
  }

  const { data: maxRow } = await supabaseAdmin
    .from('ultra_featured_templates')
    .select('position')
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = ((maxRow?.position as number | null) || 0) + 1;

  const { data: inserted, error } = await supabaseAdmin
    .from('ultra_featured_templates')
    .insert({ template_id: templateId, position: nextPosition })
    .select('position')
    .single();

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ isUltraFeatured: true, position: inserted.position as number });
}
