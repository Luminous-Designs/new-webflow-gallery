import { NextRequest, NextResponse } from 'next/server';
import {
  supabase,
  supabaseAdmin,
  checkConnection,
  getConnectionStatus,
  getStats,
  getSupabaseConfig,
  getRecentActivityLogs,
  getActivityStats,
  logActivity,
} from '@/lib/supabase';

// Verify admin access
function verifyAdmin(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(request: NextRequest) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const db = supabaseAdmin;

  try {
    switch (action) {
      case 'status': {
        // Get connection status
        const status = await checkConnection();
        const config = getSupabaseConfig();
        return NextResponse.json({ ...status, config });
      }

      case 'stats': {
        // Get database statistics
        const stats = await getStats();

        // Get table row counts
        const [
          templateCount,
          subcategoryCount,
          styleCount,
          featureCount,
          authorCount,
          activityCount,
        ] = await Promise.all([
          db.from('templates').select('*', { count: 'exact', head: true }),
          db.from('subcategories').select('*', { count: 'exact', head: true }),
          db.from('styles').select('*', { count: 'exact', head: true }),
          db.from('features').select('*', { count: 'exact', head: true }),
          db.from('featured_authors').select('*', { count: 'exact', head: true }).eq('is_active', true),
          db.from('supabase_activity_log').select('*', { count: 'exact', head: true }),
        ]);

        return NextResponse.json({
          ...stats,
          tableCounts: {
            templates: templateCount.count || 0,
            subcategories: subcategoryCount.count || 0,
            styles: styleCount.count || 0,
            features: featureCount.count || 0,
            featuredAuthors: authorCount.count || 0,
            activityLogs: activityCount.count || 0,
          },
        });
      }

      case 'activity': {
        // Get recent activity logs
        const limit = parseInt(searchParams.get('limit') || '50', 10);
        const logs = await getRecentActivityLogs(limit);
        const activityStats = await getActivityStats();

        return NextResponse.json({
          logs,
          stats: activityStats,
        });
      }

      case 'search': {
        // Search templates in Supabase
        const query = searchParams.get('query') || '';
        const limit = parseInt(searchParams.get('limit') || '20', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        if (!query) {
          return NextResponse.json({ error: 'Query parameter required' }, { status: 400 });
        }

        const { data: templates, count, error } = await db
          .from('templates')
          .select('*', { count: 'exact' })
          .or(`name.ilike.%${query}%,slug.ilike.%${query}%,author_name.ilike.%${query}%`)
          .order('updated_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return NextResponse.json({
          templates: templates || [],
          total: count || 0,
          query,
        });
      }

      case 'table-data': {
        // Get data from a specific table
        const table = searchParams.get('table');
        const limit = parseInt(searchParams.get('limit') || '20', 10);
        const offset = parseInt(searchParams.get('offset') || '0', 10);

        const validTables = [
          'templates',
          'subcategories',
          'styles',
          'features',
          'featured_authors',
          'ultra_featured_templates',
          'template_subcategories',
          'template_styles',
          'template_features',
          'template_blacklist',
          'screenshot_exclusions',
          'fresh_scrape_state',
          'fresh_scrape_screenshots',
          'thumbnail_jobs',
          'scrape_jobs',
          'scrape_sessions',
          'scrape_batches',
          'batch_templates',
          'session_resume_points',
          'visitors',
          'purchases',
          'supabase_activity_log',
        ];

        if (!table || !validTables.includes(table)) {
          return NextResponse.json({
            error: 'Invalid table',
            validTables
          }, { status: 400 });
        }

        const { data, count, error } = await db
          .from(table)
          .select('*', { count: 'exact' })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        return NextResponse.json({
          data: data || [],
          total: count || 0,
          table,
        });
      }

      case 'recent-templates': {
        // Get recently added/updated templates
        const limit = parseInt(searchParams.get('limit') || '20', 10);

        const { data, error } = await db
          .from('templates')
          .select('id, name, slug, author_name, screenshot_thumbnail_path, created_at, updated_at')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        return NextResponse.json({ templates: data || [] });
      }

      default:
        // Default: return connection status and basic stats
        const status = await checkConnection();
        const stats = await getStats();
        return NextResponse.json({ status, stats });
    }
  } catch (error) {
    console.error('Supabase API error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = supabaseAdmin;
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'test-connection': {
        const status = await checkConnection();
        return NextResponse.json(status);
      }

      case 'clear-activity-logs': {
        // Clear old activity logs (keep last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const { error } = await db
          .from('supabase_activity_log')
          .delete()
          .lt('created_at', sevenDaysAgo);

        if (error) throw error;

        await logActivity('clear_logs', 'supabase_activity_log', 0, { olderThan: sevenDaysAgo });

        return NextResponse.json({ success: true });
      }

      case 'delete-all-data': {
        // This requires double confirmation
        const { confirmDelete, confirmSupabase } = body;

        if (confirmDelete !== 'DELETE' || confirmSupabase !== 'SUPABASE') {
          return NextResponse.json({
            error: 'Double confirmation required',
            instructions: 'Set confirmDelete to "DELETE" and confirmSupabase to "SUPABASE"',
          }, { status: 400 });
        }

        const startTime = Date.now();

        // Delete in order (junction tables first, then main tables)
        await db.from('fresh_scrape_screenshots').delete().neq('id', 0);
        await db.from('fresh_scrape_state').delete().neq('id', 0);
        await db.from('template_subcategories').delete().neq('template_id', 0);
        await db.from('template_styles').delete().neq('template_id', 0);
        await db.from('template_features').delete().neq('template_id', 0);
        await db.from('ultra_featured_templates').delete().neq('id', 0);
        await db.from('batch_templates').delete().neq('id', 0);
        await db.from('scrape_batches').delete().neq('id', 0);
        await db.from('session_resume_points').delete().neq('id', 0);
        await db.from('scrape_sessions').delete().neq('id', 0);
        await db.from('scrape_logs').delete().neq('id', 0);
        await db.from('scrape_jobs').delete().neq('id', 0);
        await db.from('thumbnail_jobs').delete().neq('id', 0);
        await db.from('templates').delete().neq('id', 0);

        const duration = Date.now() - startTime;

        await logActivity('delete_all', 'all_tables', 0, { duration }, true, undefined, duration);

        return NextResponse.json({
          success: true,
          message: 'All template data deleted from Supabase',
          duration: `${(duration / 1000).toFixed(2)}s`,
        });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Supabase POST error:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
