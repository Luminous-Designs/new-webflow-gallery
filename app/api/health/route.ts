import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    // Check database connection
    const dbCheck = await db.getAsync('SELECT 1 as ok');

    // Get basic stats
    const templateCount = await db.getAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM templates'
    );

    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      templates: templateCount?.count || 0,
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