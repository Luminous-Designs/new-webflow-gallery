import { NextRequest, NextResponse } from 'next/server';
import { getSessionProgress, db, BatchTemplate } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { sessionId: sessionIdStr } = await params;
    const sessionId = parseInt(sessionIdStr);

    if (isNaN(sessionId)) {
      return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
    }

    const progress = await getSessionProgress(sessionId);

    // Calculate elapsed time for current phase of each template
    const templatesWithElapsed = progress.batchTemplates.map(template => {
      let phaseElapsedSeconds = 0;
      if (template.phase_started_at && !['completed', 'failed', 'skipped'].includes(template.status)) {
        const phaseStart = new Date(template.phase_started_at).getTime();
        phaseElapsedSeconds = Math.floor((Date.now() - phaseStart) / 1000);
      }
      return {
        ...template,
        phaseElapsedSeconds
      };
    });

    // Get recent logs from scrape_logs for this session
    const recentLogs = await db.allAsync<{
      template_url: string;
      status: string;
      message: string;
      created_at: string;
    }>(
      `SELECT bt.template_url, bt.status, bt.error_message as message, bt.completed_at as created_at
       FROM batch_templates bt
       WHERE bt.session_id = ? AND bt.completed_at IS NOT NULL
       ORDER BY bt.completed_at DESC LIMIT 20`,
      [sessionId]
    );

    return NextResponse.json({
      session: progress.session,
      currentBatch: progress.currentBatch,
      batchTemplates: templatesWithElapsed,
      allBatches: progress.allBatches,
      recentLogs
    });
  } catch (error) {
    console.error('Progress API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get progress' },
      { status: 500 }
    );
  }
}
