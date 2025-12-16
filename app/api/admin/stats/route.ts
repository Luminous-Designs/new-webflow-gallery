import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get database stats
    const stats = await db.getStats();

    // Get recent scrape jobs
    const recentJobs = await db.allAsync(
      `SELECT id, job_type, status, total_templates, processed_templates,
              successful_templates, failed_templates, error_message,
              started_at, completed_at, created_at
       FROM scrape_jobs
       ORDER BY started_at DESC
       LIMIT 5`
    );

    // Get featured authors
    const featuredAuthors = await db.allAsync(
      `SELECT DISTINCT author_name, author_avatar, COUNT(*) as template_count
       FROM templates
       WHERE author_name IS NOT NULL
       GROUP BY author_name, author_avatar
       ORDER BY template_count DESC
       LIMIT 10`
    );

    // Get active visitors
    const activeVisitors = await db.allAsync(
      `SELECT session_id, current_step, selected_template_id, last_activity
       FROM visitors
       WHERE datetime(last_activity) > datetime("now", "-5 minutes")
       ORDER BY last_activity DESC`
    );

    // Get visitor stats by step
    const visitorStats = await db.allAsync(
      `SELECT current_step, COUNT(*) as count
       FROM visitors
       WHERE datetime(last_activity) > datetime("now", "-24 hours")
       GROUP BY current_step
       ORDER BY
         CASE current_step
           WHEN 'gallery' THEN 1
           WHEN 'details' THEN 2
           WHEN 'contract' THEN 3
           WHEN 'pricing' THEN 4
           WHEN 'checkout' THEN 5
           ELSE 6
         END`
    );

    // Get recent purchases
    const recentPurchases = await db.allAsync(
      `SELECT p.*, t.name as template_name
       FROM purchases p
       LEFT JOIN templates t ON t.id = p.template_id
       ORDER BY p.created_at DESC
       LIMIT 10`
    );

    return NextResponse.json({
      ...stats,
      activeVisitorsCount: stats.activeVisitors,
      recentJobs,
      featuredAuthors,
      activeVisitors,
      visitorStats,
      recentPurchases
    });

  } catch (error) {
    console.error('Stats API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
