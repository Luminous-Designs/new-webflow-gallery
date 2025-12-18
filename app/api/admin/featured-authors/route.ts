import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all featured authors
    const { data: authors, error } = await supabaseAdmin
      .from('featured_authors')
      .select('*')
      .eq('is_active', true)
      .order('featured_at', { ascending: false });

    if (error) throw error;

    // Get all unique authors from templates for suggestions
    const { data: templates, error: templatesError } = await supabaseAdmin
      .from('templates')
      .select('author_id, author_name, author_avatar')
      .not('author_id', 'is', null);
    if (templatesError) throw templatesError;

    // Count templates per author
    const authorMap = new Map<string, { author_id: string; author_name: string; author_avatar: string | null; template_count: number }>();
    const templateRows = (templates || []) as Array<{ author_id: string | null; author_name: string | null; author_avatar: string | null }>;
    templateRows.forEach(t => {
      if (t.author_id) {
        const existing = authorMap.get(t.author_id);
        if (existing) {
          existing.template_count++;
        } else {
          authorMap.set(t.author_id, {
            author_id: t.author_id,
            author_name: t.author_name || 'Unknown',
            author_avatar: t.author_avatar,
            template_count: 1
          });
        }
      }
    });

    const allAuthors = Array.from(authorMap.values())
      .sort((a, b) => b.template_count - a.template_count);

    return NextResponse.json({
      featured: authors || [],
      available: allAuthors
    });

  } catch (error) {
    console.error('Featured authors API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { author_id, author_name } = body;

    if (!author_id || !author_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Add featured author
    const payload = {
      author_id,
      author_name,
      is_active: true,
      featured_at: new Date().toISOString()
    } as unknown as never;

    const { error } = await supabaseAdmin
      .from('featured_authors')
      .upsert(payload, { onConflict: 'author_id' });

    if (error) throw error;

    return NextResponse.json({ message: 'Author featured successfully' });

  } catch (error) {
    console.error('Featured author API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const author_id = searchParams.get('id');

    if (!author_id) {
      return NextResponse.json({ error: 'Author ID required' }, { status: 400 });
    }

    // Remove featured author
    const updatePayload = { is_active: false } as unknown as never;
    const { error } = await supabaseAdmin
      .from('featured_authors')
      .update(updatePayload)
      .eq('author_id', author_id);

    if (error) throw error;

    return NextResponse.json({ message: 'Author unfeatured successfully' });

  } catch (error) {
    console.error('Featured author API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
