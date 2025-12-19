import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length);
  return token === process.env.ADMIN_PASSWORD;
}

function sanitizeSlug(value: string): string | null {
  const slug = value.trim();
  if (!slug) return null;
  // Keep strict to prevent path traversal.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  return slug.toLowerCase();
}

function screenshotDir(): string {
  return path.join(process.cwd(), 'public', 'screenshots');
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  if (action === 'preflight') {
    const dir = screenshotDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      const testFile = path.join(dir, `.preflight-${Date.now()}.tmp`);
      const payload = `preflight:${new Date().toISOString()}`;
      await fs.writeFile(testFile, payload, 'utf8');
      const readBack = await fs.readFile(testFile, 'utf8');
      await fs.unlink(testFile);
      if (readBack !== payload) throw new Error('Read/write mismatch');
      return NextResponse.json({ ok: true, dir, writable: true });
    } catch (error) {
      return NextResponse.json(
        { ok: false, dir, writable: false, error: error instanceof Error ? error.message : 'Preflight failed' },
        { status: 500 }
      );
    }
  }

  if (action === 'exists') {
    const slugRaw = searchParams.get('slug') || '';
    const slug = sanitizeSlug(slugRaw);
    if (!slug) {
      return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });
    }
    const filePath = path.join(screenshotDir(), `${slug}.webp`);
    try {
      await fs.stat(filePath);
      return NextResponse.json({ ok: true, exists: true, path: `/screenshots/${slug}.webp` });
    } catch {
      return NextResponse.json({ ok: true, exists: false, path: `/screenshots/${slug}.webp` });
    }
  }

  return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slugRaw = searchParams.get('slug') || '';
  const slug = sanitizeSlug(slugRaw);
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'Invalid slug' }, { status: 400 });
  }

  const dir = screenshotDir();
  await fs.mkdir(dir, { recursive: true });

  const arrayBuffer = await request.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Guardrail: 10MB max per screenshot upload.
  if (buffer.length === 0) {
    return NextResponse.json({ ok: false, error: 'Empty body' }, { status: 400 });
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'File too large' }, { status: 413 });
  }

  const finalPath = path.join(dir, `${slug}.webp`);
  const tempPath = path.join(dir, `${slug}.webp.tmp-${Date.now()}`);

  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Write failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    slug,
    bytes: buffer.length,
    path: `/screenshots/${slug}.webp`,
    filePath: finalPath,
  });
}

