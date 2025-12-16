import { db } from './db';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// Track API response times
export async function trackApiMetric(
  endpoint: string,
  method: string,
  responseTimeMs: number,
  statusCode: number,
  ipAddress?: string,
  userAgent?: string,
  errorMessage?: string,
  payloadSize?: number
) {
  try {
    await db.runAsync(
      `INSERT INTO api_metrics (
        endpoint, method, response_time_ms, status_code,
        ip_address, user_agent, error_message, payload_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [endpoint, method, responseTimeMs, statusCode, ipAddress, userAgent, errorMessage, payloadSize]
    );
  } catch (error) {
    console.error('Error tracking API metric:', error);
  }
}

// Track preview modal metrics
export async function trackPreviewMetric(
  templateId: number,
  sessionId: string,
  loadTimeMs: number,
  deviceType: 'desktop' | 'mobile',
  errorOccurred: boolean = false
) {
  try {
    await db.runAsync(
      `INSERT INTO preview_metrics (
        template_id, session_id, load_time_ms, device_type, error_occurred
      ) VALUES (?, ?, ?, ?, ?)`,
      [templateId, sessionId, loadTimeMs, deviceType, errorOccurred ? 1 : 0]
    );
  } catch (error) {
    console.error('Error tracking preview metric:', error);
  }
}

// Update preview navigation count
export async function updatePreviewNavigation(sessionId: string, templateId: number) {
  try {
    await db.runAsync(
      `UPDATE preview_metrics
       SET navigation_count = navigation_count + 1,
           total_duration_ms = (strftime('%s', 'now') - strftime('%s', created_at)) * 1000
       WHERE session_id = ? AND template_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [sessionId, templateId]
    );
  } catch (error) {
    console.error('Error updating preview navigation:', error);
  }
}

// Track page views
export async function trackPageView(
  pagePath: string,
  sessionId: string,
  ipAddress?: string,
  referrer?: string,
  userAgent?: string
) {
  try {
    await db.runAsync(
      `INSERT INTO page_views (
        page_path, session_id, ip_address, referrer, user_agent
      ) VALUES (?, ?, ?, ?, ?)`,
      [pagePath, sessionId, ipAddress, referrer, userAgent]
    );
  } catch (error) {
    console.error('Error tracking page view:', error);
  }
}

// Track system metrics
export async function trackSystemMetric(
  metricType: string,
  endpoint: string | null,
  responseTimeMs: number,
  statusCode?: number,
  errorMessage?: string,
  metadata?: unknown
) {
  try {
    await db.runAsync(
      `INSERT INTO system_metrics (
        metric_type, endpoint, response_time_ms, status_code, error_message, metadata
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [metricType, endpoint, responseTimeMs, statusCode, errorMessage, JSON.stringify(metadata)]
    );
  } catch (error) {
    console.error('Error tracking system metric:', error);
  }
}

// Capture system health snapshot
export async function captureSystemHealth() {
  try {
    // Get CPU usage
    const cpus = os.cpus();
    const cpuUsage = cpus.reduce((acc, cpu) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return acc + ((total - idle) / total) * 100;
    }, 0) / cpus.length;

    // Get memory usage
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercentage = (usedMemory / totalMemory) * 100;

    // Get disk usage (for the data directory)
    const dataPath = path.resolve('./data');
    const screenshotPath = path.resolve('./public/screenshots');

    let databaseSizeMb = 0;
    let screenshotSizeGb = 0;
    let screenshotCount = 0;

    try {
      // Get database size
      const dbStats = await fs.stat(path.join(dataPath, 'webflow.db'));
      databaseSizeMb = dbStats.size / (1024 * 1024);

      // Get screenshot directory size and count
      const screenshots = await fs.readdir(screenshotPath).catch(() => []);
      screenshotCount = screenshots.length;

      let totalSize = 0;
      for (const file of screenshots) {
        try {
          const stats = await fs.stat(path.join(screenshotPath, file));
          totalSize += stats.size;
        } catch {
          // Ignore errors for individual files
        }
      }
      screenshotSizeGb = totalSize / (1024 * 1024 * 1024);
    } catch (error) {
      console.error('Error getting storage stats:', error);
    }

    // Get uptime
    const uptimeSeconds = process.uptime();

    // Get active connections (approximate from database)
    const activeConnections = await db.getAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT session_id) as count
       FROM visitors
       WHERE datetime(last_activity) > datetime('now', '-5 minutes')`
    );

    await db.runAsync(
      `INSERT INTO system_health (
        cpu_usage, memory_usage_mb, memory_percentage,
        database_size_mb, screenshot_count, screenshot_size_gb,
        uptime_seconds, active_connections
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cpuUsage,
        Math.round(usedMemory / (1024 * 1024)),
        memoryPercentage,
        databaseSizeMb,
        screenshotCount,
        screenshotSizeGb,
        uptimeSeconds,
        activeConnections?.count || 0
      ]
    );
  } catch (error) {
    console.error('Error capturing system health:', error);
  }
}

// Get metrics for dashboard
export async function getMetrics(type: string, hours: number = 24) {
  try {
    const timeFilter = `datetime(created_at) > datetime('now', '-${hours} hours')`;

    switch (type) {
      case 'api':
        return await db.allAsync(
          `SELECT
            endpoint,
            AVG(response_time_ms) as avg_response_time,
            MIN(response_time_ms) as min_response_time,
            MAX(response_time_ms) as max_response_time,
            COUNT(*) as request_count,
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
           FROM api_metrics
           WHERE ${timeFilter}
           GROUP BY endpoint
           ORDER BY request_count DESC`
        );

      case 'preview':
        return await db.allAsync(
          `SELECT
            AVG(load_time_ms) as avg_load_time,
            MIN(load_time_ms) as min_load_time,
            MAX(load_time_ms) as max_load_time,
            AVG(navigation_count) as avg_navigation_count,
            COUNT(*) as preview_count,
            SUM(error_occurred) as error_count
           FROM preview_metrics
           WHERE ${timeFilter}`
        );

      case 'system':
        return await db.allAsync(
          `SELECT
            datetime(created_at, 'localtime') as time,
            cpu_usage,
            memory_percentage,
            database_size_mb,
            screenshot_size_gb,
            active_connections
           FROM system_health
           WHERE ${timeFilter}
           ORDER BY created_at DESC
           LIMIT 100`
        );

      case 'pageviews':
        return await db.allAsync(
          `SELECT
            page_path,
            COUNT(*) as view_count,
            COUNT(DISTINCT session_id) as unique_visitors,
            AVG(duration_ms) as avg_duration
           FROM page_views
           WHERE ${timeFilter}
           GROUP BY page_path
           ORDER BY view_count DESC
           LIMIT 20`
        );

      case 'hourly':
        return await db.allAsync(
          `SELECT
            strftime('%Y-%m-%d %H:00', created_at) as hour,
            COUNT(*) as requests,
            AVG(response_time_ms) as avg_response_time
           FROM api_metrics
           WHERE ${timeFilter}
           GROUP BY hour
           ORDER BY hour DESC
           LIMIT 24`
        );

      default:
        return [];
    }
  } catch (error) {
    console.error(`Error getting ${type} metrics:`, error);
    return [];
  }
}

// Get real-time metrics
export async function getRealTimeMetrics() {
  try {
    const [
      activeUsers,
      recentRequests,
      errorRate,
      avgResponseTime,
      systemHealth
    ] = await Promise.all([
      // Active users (last 5 minutes)
      db.getAsync<{ count: number }>(
        `SELECT COUNT(DISTINCT session_id) as count
         FROM visitors
         WHERE datetime(last_activity) > datetime('now', '-5 minutes')`
      ),

      // Recent requests (last minute)
      db.getAsync<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM api_metrics
         WHERE datetime(created_at) > datetime('now', '-1 minute')`
      ),

      // Error rate (last hour)
      db.getAsync<{ rate: number }>(
        `SELECT
          CAST(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS REAL) /
          CAST(COUNT(*) AS REAL) * 100 as rate
         FROM api_metrics
         WHERE datetime(created_at) > datetime('now', '-1 hour')`
      ),

      // Average response time (last 5 minutes)
      db.getAsync<{ avg_time: number }>(
        `SELECT AVG(response_time_ms) as avg_time
         FROM api_metrics
         WHERE datetime(created_at) > datetime('now', '-5 minutes')`
      ),

      // Latest system health
      db.getAsync(
        `SELECT * FROM system_health
         ORDER BY created_at DESC
         LIMIT 1`
      )
    ]);

    return {
      activeUsers: activeUsers?.count || 0,
      requestsPerMinute: recentRequests?.count || 0,
      errorRate: errorRate?.rate || 0,
      avgResponseTime: avgResponseTime?.avg_time || 0,
      systemHealth: systemHealth || null
    };
  } catch (error) {
    console.error('Error getting real-time metrics:', error);
    return null;
  }
}

// Cleanup old metrics (keep last 30 days)
export async function cleanupOldMetrics(daysToKeep: number = 30) {
  try {
    const tables = [
      'system_metrics',
      'preview_metrics',
      'api_metrics',
      'page_views',
      'system_health'
    ];

    for (const table of tables) {
      await db.runAsync(
        `DELETE FROM ${table}
         WHERE datetime(created_at) < datetime('now', '-${daysToKeep} days')`
      );
    }

    // Vacuum to reclaim space
    await db.runAsync('VACUUM');
  } catch (error) {
    console.error('Error cleaning up old metrics:', error);
  }
}

// Start background health monitoring
let healthInterval: NodeJS.Timeout | null = null;

export function startHealthMonitoring(intervalMinutes: number = 5) {
  if (healthInterval) {
    clearInterval(healthInterval);
  }

  // Capture initial snapshot
  captureSystemHealth();

  // Set up interval
  healthInterval = setInterval(() => {
    captureSystemHealth();
  }, intervalMinutes * 60 * 1000);

  // Also cleanup old metrics daily
  setInterval(() => {
    cleanupOldMetrics();
  }, 24 * 60 * 60 * 1000);
}

export function stopHealthMonitoring() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
