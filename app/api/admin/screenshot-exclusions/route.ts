import { NextRequest, NextResponse } from 'next/server';
import { supabase, type ScreenshotExclusion } from '@/lib/supabase';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  return token === ADMIN_PASSWORD;
}

// GET - List all screenshot exclusions
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: exclusions, error } = await supabase
      .from('screenshot_exclusions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ exclusions: exclusions || [] });
  } catch (error) {
    console.error('Failed to fetch screenshot exclusions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exclusions' },
      { status: 500 }
    );
  }
}

// POST - Add a new screenshot exclusion
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { selector, selector_type, description } = body;

    if (!selector || typeof selector !== 'string' || !selector.trim()) {
      return NextResponse.json(
        { error: 'Selector is required' },
        { status: 400 }
      );
    }

    const normalizedSelector = selector.trim();
    const normalizedType = ['class', 'id', 'selector'].includes(selector_type)
      ? selector_type
      : 'class';

    // Check for duplicate
    const { data: existing } = await supabase
      .from('screenshot_exclusions')
      .select('id')
      .eq('selector', normalizedSelector)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'This selector already exists' },
        { status: 409 }
      );
    }

    const { data: newExclusion, error: insertError } = await supabase
      .from('screenshot_exclusions')
      .insert({
        selector: normalizedSelector,
        selector_type: normalizedType,
        description: description || null,
        is_active: true
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ exclusion: newExclusion }, { status: 201 });
  } catch (error) {
    console.error('Failed to add screenshot exclusion:', error);
    return NextResponse.json(
      { error: 'Failed to add exclusion' },
      { status: 500 }
    );
  }
}

// PATCH - Update a screenshot exclusion (toggle active, update description)
export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, is_active, description, selector, selector_type } = body;

    if (!id || typeof id !== 'number') {
      return NextResponse.json(
        { error: 'Exclusion ID is required' },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    };

    if (typeof is_active === 'boolean') {
      updateData.is_active = is_active;
    }

    if (typeof description === 'string') {
      updateData.description = description || null;
    }

    if (typeof selector === 'string' && selector.trim()) {
      updateData.selector = selector.trim();
    }

    if (selector_type && ['class', 'id', 'selector'].includes(selector_type)) {
      updateData.selector_type = selector_type;
    }

    if (Object.keys(updateData).length === 1) {
      // Only updated_at, no actual changes
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from('screenshot_exclusions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    return NextResponse.json({ exclusion: updated });
  } catch (error) {
    console.error('Failed to update screenshot exclusion:', error);
    return NextResponse.json(
      { error: 'Failed to update exclusion' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a screenshot exclusion
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get('id');

    if (!idParam) {
      return NextResponse.json(
        { error: 'Exclusion ID is required' },
        { status: 400 }
      );
    }

    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: 'Invalid exclusion ID' },
        { status: 400 }
      );
    }

    const { error: deleteError, count } = await supabase
      .from('screenshot_exclusions')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (deleteError) throw deleteError;

    if (!count || count === 0) {
      return NextResponse.json(
        { error: 'Exclusion not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, deleted: id });
  } catch (error) {
    console.error('Failed to delete screenshot exclusion:', error);
    return NextResponse.json(
      { error: 'Failed to delete exclusion' },
      { status: 500 }
    );
  }
}
