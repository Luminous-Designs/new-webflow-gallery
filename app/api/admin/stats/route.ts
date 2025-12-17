import { NextRequest, NextResponse } from 'next/server';
import { supabase, getStats } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get database stats
    const stats = await getStats();

    // Get recent scrape jobs
    const { data: recentJobs } = await supabase
      .from('scrape_jobs')
      .select('id, job_type, status, total_templates, processed_templates, successful_templates, failed_templates, error_message, started_at, completed_at, created_at')
      .order('started_at', { ascending: false })
      .limit(5);

    // Get featured authors with template counts
    const { data: featuredAuthors } = await supabase
      .from('templates')
      .select('author_name, author_avatar')
      .not('author_name', 'is', null);

    // Count templates per author
    const authorCounts = new Map<string, { author_name: string; author_avatar: string | null; template_count: number }>();
    (featuredAuthors || []).forEach(t => {
      if (t.author_name) {
        const existing = authorCounts.get(t.author_name);
        if (existing) {
          existing.template_count++;
        } else {
          authorCounts.set(t.author_name, {
            author_name: t.author_name,
            author_avatar: t.author_avatar,
            template_count: 1
          });
        }
      }
    });

    const topAuthors = Array.from(authorCounts.values())
      .sort((a, b) => b.template_count - a.template_count)
      .slice(0, 10);

    // Get active visitors (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: activeVisitors } = await supabase
      .from('visitors')
      .select('session_id, current_step, selected_template_id, last_activity')
      .gte('last_activity', fiveMinutesAgo)
      .order('last_activity', { ascending: false });

    // Get visitor stats by step (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentVisitors } = await supabase
      .from('visitors')
      .select('current_step')
      .gte('last_activity', twentyFourHoursAgo);

    // Count by step
    const stepCounts = new Map<string, number>();
    (recentVisitors || []).forEach(v => {
      const step = v.current_step || 'unknown';
      stepCounts.set(step, (stepCounts.get(step) || 0) + 1);
    });

    const stepOrder = ['gallery', 'details', 'contract', 'pricing', 'checkout'];
    const visitorStats = stepOrder
      .filter(step => stepCounts.has(step))
      .map(step => ({ current_step: step, count: stepCounts.get(step) || 0 }));

    // Add any other steps
    stepCounts.forEach((count, step) => {
      if (!stepOrder.includes(step)) {
        visitorStats.push({ current_step: step, count });
      }
    });

    // Get recent purchases
    const { data: purchases } = await supabase
      .from('purchases')
      .select('*, templates(name)')
      .order('created_at', { ascending: false })
      .limit(10);

    const recentPurchases = (purchases || []).map(p => ({
      ...p,
      template_name: (p.templates as { name: string })?.name
    }));

    return NextResponse.json({
      ...stats,
      activeVisitorsCount: stats.activeVisitors,
      recentJobs: recentJobs || [],
      featuredAuthors: topAuthors,
      activeVisitors: activeVisitors || [],
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
