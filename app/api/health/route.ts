import { NextResponse } from 'next/server';
import { supabase, checkConnection } from '@/lib/supabase';

export async function GET() {
  try {
    // Check database connection
    const isConnected = await checkConnection();

    // Get basic stats
    const { count: templateCount, error: countError } = await supabase
      .from('templates')
      .select('*', { count: 'exact', head: true });

    if (countError && !isConnected) {
      throw new Error('Database connection failed');
    }

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: isConnected ? 'connected' : 'disconnected',
      templates: templateCount || 0,
      version: process.env.npm_package_version || '1.0.0',
      node: process.version,
      uptime: process.uptime(),
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