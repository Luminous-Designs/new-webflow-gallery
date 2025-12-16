import { NextRequest, NextResponse } from 'next/server';
import { getMetrics, getRealTimeMetrics, captureSystemHealth } from '@/lib/metrics';

export async function GET(request: NextRequest) {
  try {
    // Check admin authorization
    const authHeader = request.headers.get('authorization');
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'realtime';
    const hours = parseInt(searchParams.get('hours') || '24');

    if (type === 'realtime') {
      const metrics = await getRealTimeMetrics();
      return NextResponse.json(metrics);
    } else if (type === 'capture-health') {
      await captureSystemHealth();
      return NextResponse.json({ success: true });
    } else {
      const metrics = await getMetrics(type, hours);
      return NextResponse.json(metrics);
    }
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}