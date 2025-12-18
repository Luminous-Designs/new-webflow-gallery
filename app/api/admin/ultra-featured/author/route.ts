import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const TEMPLATE_SELECT = `
  id,
  name,
  slug,
  author_id,
  author_name,
  screenshot_path,
  live_preview_url,
  storefront_url,
  updated_at
`;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const authorId = searchParams.get('author_id');

    if (!authorId) {
      return NextResponse.json({ error: 'author_id required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('templates')
      .select(TEMPLATE_SELECT)
      .eq('author_id', authorId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ templates: data || [] });
  } catch (error) {
    console.error('Ultra featured author templates error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
