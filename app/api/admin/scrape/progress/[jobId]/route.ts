import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type ScrapeJobRow = {
  id: string;
  status: string;
  processed_templates?: number | null;
  successful_templates?: number | null;
  failed_templates?: number | null;
  total_templates?: number | null;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await context.params;
    const jobId = resolvedParams?.jobId;

    if (!jobId) {
      return NextResponse.json({ error: 'Job id missing' }, { status: 400 });
    }

    // Get job status
    const job = await db.getAsync<ScrapeJobRow>(
      `SELECT * FROM scrape_jobs WHERE id = ?`,
      [jobId]
    );

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Get recent logs for this job
    const logs = await db.allAsync(
      `SELECT * FROM scrape_logs
       WHERE job_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [jobId]
    );

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      processed: job.processed_templates || 0,
      successful: job.successful_templates || 0,
      failed: job.failed_templates || 0,
      total: job.total_templates || 0,
      logs: logs
    });

  } catch (error) {
    console.error('Progress API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
