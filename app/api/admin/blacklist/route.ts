import { NextRequest, NextResponse } from 'next/server';
import {
  getBlacklistedTemplates,
  blacklistTemplate,
  unblacklistTemplate,
  extractDomainSlug,
  BlacklistReason
} from '@/lib/db';

export async function GET(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const blacklist = await getBlacklistedTemplates();
    return NextResponse.json({ blacklist, count: blacklist.length });
  } catch (error) {
    console.error('Blacklist GET error:', error);
    return NextResponse.json(
      { error: 'Failed to get blacklist' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { livePreviewUrl, storefrontUrl, reason = 'admin_blocked' } = body;

    if (!livePreviewUrl) {
      return NextResponse.json(
        { error: 'livePreviewUrl is required' },
        { status: 400 }
      );
    }

    const domainSlug = extractDomainSlug(livePreviewUrl);
    if (!domainSlug) {
      return NextResponse.json(
        { error: 'Could not extract domain slug from URL' },
        { status: 400 }
      );
    }

    const id = await blacklistTemplate(livePreviewUrl, storefrontUrl, reason as BlacklistReason);

    if (!id) {
      return NextResponse.json(
        { error: 'Failed to blacklist template' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Template blacklisted',
      id,
      domainSlug
    });
  } catch (error) {
    console.error('Blacklist POST error:', error);
    return NextResponse.json(
      { error: 'Failed to blacklist template' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const domainSlug = searchParams.get('domainSlug');

    if (!domainSlug) {
      return NextResponse.json(
        { error: 'domainSlug query parameter is required' },
        { status: 400 }
      );
    }

    const success = await unblacklistTemplate(domainSlug);

    if (!success) {
      return NextResponse.json(
        { error: 'Template not found in blacklist' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Template removed from blacklist',
      domainSlug
    });
  } catch (error) {
    console.error('Blacklist DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to remove from blacklist' },
      { status: 500 }
    );
  }
}
