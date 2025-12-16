import { NextRequest, NextResponse } from 'next/server';
import { trackPreviewMetric, updatePreviewNavigation } from '@/lib/metrics';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId, sessionId, loadTimeMs, deviceType, errorOccurred, isNavigation } = body;

    if (isNavigation) {
      // Update navigation count for existing preview session
      await updatePreviewNavigation(sessionId, templateId);
    } else {
      // Track new preview session
      await trackPreviewMetric(
        templateId,
        sessionId,
        loadTimeMs,
        deviceType,
        errorOccurred
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error tracking preview metric:', error);
    return NextResponse.json(
      { error: 'Failed to track metric' },
      { status: 500 }
    );
  }
}