import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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
    const query = searchParams.get('query');
    const limit = Number(searchParams.get('limit') || 10);

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results = await db.searchTemplates(query.trim(), limit);

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Ultra featured search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
