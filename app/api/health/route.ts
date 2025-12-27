import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

function extractProjectRef(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname;
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    // Get basic stats
    const { count: templateCount, error: countError } = await supabaseAdmin
      .from('templates')
      .select('*', { count: 'exact', head: true });

    const databaseOk = !countError;

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: databaseOk ? 'connected' : 'disconnected',
      templates: templateCount || 0,
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      uptime: process.uptime(),
      env: {
        supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        anonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        projectRef: extractProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL),
      },
    });
  } catch (error) {
    console.error('Health check failed:', error);

    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 503 });
  }
}
