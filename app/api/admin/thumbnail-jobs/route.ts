import { NextRequest, NextResponse } from 'next/server';
import { thumbnailQueue } from '@/lib/screenshot/thumbnail-queue';

type SummaryResponse = Awaited<ReturnType<typeof thumbnailQueue.getSummary>>;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = request.nextUrl.searchParams.get('limit');
  const limit = limitParam ? Number(limitParam) : 25;

  const summary: SummaryResponse = await thumbnailQueue.getSummary(Number.isFinite(limit) ? limit : 25);

  return NextResponse.json(summary);
}
