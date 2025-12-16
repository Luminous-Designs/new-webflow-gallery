import { NextRequest, NextResponse } from 'next/server';
import { db, ScreenshotExclusion } from '@/lib/db';

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
    const exclusions = await db.allAsync<ScreenshotExclusion>(
      `SELECT * FROM screenshot_exclusions ORDER BY created_at DESC`
    );

    return NextResponse.json({ exclusions });
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
    const existing = await db.getAsync<ScreenshotExclusion>(
      'SELECT id FROM screenshot_exclusions WHERE selector = ?',
      [normalizedSelector]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'This selector already exists' },
        { status: 409 }
      );
    }

    const { lastID } = await db.runAsync(
      `INSERT INTO screenshot_exclusions (selector, selector_type, description, is_active)
       VALUES (?, ?, ?, 1)`,
      [normalizedSelector, normalizedType, description || null]
    );

    const newExclusion = await db.getAsync<ScreenshotExclusion>(
      'SELECT * FROM screenshot_exclusions WHERE id = ?',
      [lastID]
    );

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

    const updates: string[] = [];
    const params: unknown[] = [];

    if (typeof is_active === 'boolean') {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    if (typeof description === 'string') {
      updates.push('description = ?');
      params.push(description || null);
    }

    if (typeof selector === 'string' && selector.trim()) {
      updates.push('selector = ?');
      params.push(selector.trim());
    }

    if (selector_type && ['class', 'id', 'selector'].includes(selector_type)) {
      updates.push('selector_type = ?');
      params.push(selector_type);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updates.push('updated_at = datetime("now")');
    params.push(id);

    await db.runAsync(
      `UPDATE screenshot_exclusions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const updated = await db.getAsync<ScreenshotExclusion>(
      'SELECT * FROM screenshot_exclusions WHERE id = ?',
      [id]
    );

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

    const { changes } = await db.runAsync(
      'DELETE FROM screenshot_exclusions WHERE id = ?',
      [id]
    );

    if (changes === 0) {
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
