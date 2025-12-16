import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { thumbnailQueue } from '@/lib/screenshot/thumbnail-queue';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const templateId = Number(id);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }

    const body = await request.json();
    const { targetUrl } = body ?? {};

    if (!targetUrl) {
      return NextResponse.json({ error: 'targetUrl is required' }, { status: 400 });
    }

    const template = await db.getAsync<{
      id: number;
      slug: string;
      live_preview_url: string;
      name: string;
    }>(
      'SELECT id, slug, live_preview_url, name FROM templates WHERE id = ?',
      [templateId]
    );

    if (!template || !template.live_preview_url) {
      return NextResponse.json({ error: 'Template not found or missing preview URL' }, { status: 404 });
    }

    let target: URL;
    let base: URL;
    try {
      base = new URL(template.live_preview_url);
      target = new URL(targetUrl, template.live_preview_url);
    } catch {
      return NextResponse.json({ error: 'Invalid target URL' }, { status: 400 });
    }

    if (target.origin !== base.origin) {
      return NextResponse.json({ error: 'Target URL must be on the same domain as the template preview' }, { status: 400 });
    }

    const job = await thumbnailQueue.enqueue({
      templateId: template.id,
      targetUrl: target.href,
      requestedBy: 'admin'
    });

    return NextResponse.json(
      {
        message: 'Thumbnail screenshot queued',
        job
      },
      { status: 202 }
    );
  } catch (error) {
    console.error('Thumbnail update queue error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
