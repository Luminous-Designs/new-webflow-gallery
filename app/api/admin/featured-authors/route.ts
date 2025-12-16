import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all featured authors
    const authors = await db.allAsync(
      `SELECT * FROM featured_authors
       WHERE is_active = 1
       ORDER BY featured_at DESC`
    );

    // Get all unique authors from templates for suggestions
    const allAuthors = await db.allAsync(
      `SELECT DISTINCT author_id, author_name, author_avatar, COUNT(*) as template_count
       FROM templates
       WHERE author_id IS NOT NULL
       GROUP BY author_id
       ORDER BY template_count DESC`
    );

    return NextResponse.json({
      featured: authors,
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
    await db.runAsync(
      `INSERT OR REPLACE INTO featured_authors (author_id, author_name, featured_at, is_active)
       VALUES (?, ?, datetime('now'), 1)`,
      [author_id, author_name]
    );

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
    await db.runAsync(
      `UPDATE featured_authors SET is_active = 0 WHERE author_id = ?`,
      [author_id]
    );

    return NextResponse.json({ message: 'Author unfeatured successfully' });

  } catch (error) {
    console.error('Featured author API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}