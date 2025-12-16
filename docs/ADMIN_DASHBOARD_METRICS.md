# Admin Dashboard Metrics

## Overview

The admin dashboard includes comprehensive metrics tracking for monitoring application health, performance, and user behavior. This system provides real-time insights and historical data to help maintain optimal performance and understand usage patterns.

## Architecture

### Database Schema

The metrics system uses dedicated SQLite tables for different metric types:

```sql
- api_metrics          # API endpoint performance
- preview_metrics      # Template preview interactions
- system_metrics       # General system events
- system_health       # Server resource snapshots
- page_views          # Page visit tracking
- visitors            # Unique visitor sessions
```

### Data Collection Flow

```
User Action → API Endpoint → Metric Capture → SQLite Storage
                    ↓
            Background Jobs → System Health Snapshots
                    ↓
            Admin Dashboard → Real-time Visualization
```

## Key Components

### 1. Metrics Library (`/lib/metrics.ts`)

Core utility functions for metric tracking:

- **trackApiMetric()** - Records API response times and status codes
- **trackPreviewMetric()** - Captures template preview load times
- **trackPageView()** - Logs page visits with session tracking
- **captureSystemHealth()** - Takes system resource snapshots
- **getRealTimeMetrics()** - Fetches current performance stats
- **cleanupOldMetrics()** - Maintains 30-day data retention

### 2. API Endpoints

#### `/api/admin/metrics`
- Protected endpoint requiring admin authentication
- Query parameters:
  - `type`: realtime | api | preview | system | pageviews | hourly
  - `hours`: Time range for historical data (default: 24)

#### `/api/metrics/preview`
- Public endpoint for preview tracking
- Records load times and navigation patterns
- No authentication required (client-side tracking)

### 3. Dashboard Component (`/components/admin/metrics-dashboard.tsx`)

Interactive dashboard with four main sections:

1. **Performance Tab**
   - API response times by endpoint
   - Error rates and status codes
   - Request volume trends

2. **System Health Tab**
   - CPU utilization graphs
   - Memory usage monitoring
   - Storage capacity tracking
   - Active connections

3. **Preview Analytics Tab**
   - Average load times
   - Device type breakdown
   - Navigation patterns
   - Error tracking

4. **Traffic Tab**
   - Page view statistics
   - Unique visitor counts
   - Popular pages ranking
   - Session duration metrics

## Implementation Guide

### Adding New Metrics

1. **Define the metric type** in database schema:
```sql
ALTER TABLE your_metrics_table ADD COLUMN new_metric_field TYPE;
```

2. **Create tracking function** in `/lib/metrics.ts`:
```typescript
export async function trackNewMetric(
  field1: string,
  field2: number,
  metadata?: any
) {
  await db.runAsync(
    `INSERT INTO your_metrics_table (field1, field2, metadata)
     VALUES (?, ?, ?)`,
    [field1, field2, JSON.stringify(metadata)]
  );
}
```

3. **Call tracker** from relevant endpoints:
```typescript
// In API route
const startTime = Date.now();
// ... perform operation ...
await trackNewMetric('operation', Date.now() - startTime);
```

4. **Add visualization** to dashboard:
```typescript
// In metrics-dashboard.tsx
const newMetrics = await fetch('/api/admin/metrics?type=new');
// Add chart component with data
```

### Performance Considerations

#### Database Optimization
- Indexes on `created_at` for time-based queries
- Automatic cleanup of data older than 30 days
- VACUUM operations to reclaim space

#### Query Efficiency
```sql
-- Use time filters to limit data
WHERE datetime(created_at) > datetime('now', '-24 hours')

-- Aggregate at database level
SELECT AVG(response_time_ms), COUNT(*)
GROUP BY endpoint
```

#### Caching Strategy
- Dashboard auto-refreshes every 30 seconds
- Consider Redis for high-traffic deployments
- Use request deduplication for concurrent users

### System Health Monitoring

The health monitoring system captures snapshots every 5 minutes:

```javascript
// Automatic startup in production
startHealthMonitoring(5); // 5-minute intervals

// Manual capture
await captureSystemHealth();
```

Monitored resources:
- **CPU**: Average usage across all cores
- **Memory**: Used/total RAM and percentage
- **Storage**: Database size and screenshot directory
- **Uptime**: Process runtime in seconds
- **Connections**: Active user sessions

### Security Considerations

1. **Admin Authentication**
   - All metrics endpoints require Bearer token
   - Token must match `ADMIN_PASSWORD` env variable
   - No metrics exposed to public users

2. **Data Privacy**
   - IP addresses hashed for privacy
   - No personal data in metrics
   - Session IDs are anonymized

3. **Rate Limiting**
   - Consider implementing rate limits for metric endpoints
   - Prevent metric bombing attacks

## Troubleshooting

### Common Issues

#### High Memory Usage
```bash
# Check screenshot directory size
du -sh public/screenshots/

# Clean old screenshots
rm public/screenshots/*.webp
```

#### Database Growth
```sql
-- Check table sizes
SELECT name, COUNT(*) FROM sqlite_master
WHERE type='table'
GROUP BY name;

-- Force cleanup
DELETE FROM api_metrics
WHERE datetime(created_at) < datetime('now', '-7 days');
VACUUM;
```

#### Missing Metrics
```javascript
// Verify background job is running
console.log('Health monitoring active:', healthInterval !== null);

// Manual health capture
await captureSystemHealth();
```

## Environment Variables

Required for metrics system:
```env
ADMIN_PASSWORD=<secure-password>     # Admin authentication
DATABASE_PATH=./data/webflow.db      # SQLite location
NODE_ENV=production                  # Enables health monitoring
```

## Best Practices

### 1. Metric Naming
- Use descriptive, consistent names
- Include units in field names (e.g., `_ms`, `_mb`)
- Group related metrics with prefixes

### 2. Data Retention
- Keep detailed data for 30 days
- Consider aggregating older data
- Export critical metrics before cleanup

### 3. Performance Impact
- Use async tracking to avoid blocking
- Batch metric writes when possible
- Monitor metrics overhead itself

### 4. Visualization
- Show trends, not just current values
- Use appropriate chart types
- Provide context with averages/baselines

## Future Enhancements

### Planned Features
1. **Alert System**
   - Threshold-based notifications
   - Email/SMS alerts for critical issues
   - Anomaly detection

2. **Export Capabilities**
   - CSV/JSON data export
   - Scheduled reports
   - API for external monitoring tools

3. **Advanced Analytics**
   - User journey tracking
   - Conversion funnel analysis
   - A/B testing metrics

4. **Integration Options**
   - Grafana dashboard support
   - Prometheus metrics endpoint
   - CloudWatch/DataDog connectors

### Scalability Roadmap

For high-traffic deployments:
1. Move metrics to dedicated database
2. Implement time-series database (InfluxDB)
3. Add caching layer (Redis)
4. Use queue for metric writes
5. Deploy metrics service separately

## API Reference

### GET /api/admin/metrics

Fetch metrics data for dashboard.

**Headers:**
```
Authorization: Bearer <ADMIN_PASSWORD>
```

**Query Parameters:**
- `type` (string): Metric type to fetch
- `hours` (number): Time range in hours

**Response:**
```json
{
  "data": [...],
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### POST /api/metrics/preview

Track preview interactions.

**Body:**
```json
{
  "templateId": 123,
  "sessionId": "abc-123",
  "loadTimeMs": 1500,
  "deviceType": "desktop",
  "errorOccurred": false
}
```

## Development Tips

### Local Testing
```bash
# Monitor metrics in real-time
sqlite3 data/webflow.db "SELECT * FROM api_metrics ORDER BY created_at DESC LIMIT 10;"

# Simulate load
for i in {1..100}; do curl http://localhost:3000/api/templates; done

# Check system health
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:3000/api/admin/metrics?type=system
```

### Debug Mode
```javascript
// Enable verbose logging in metrics.ts
const DEBUG = process.env.NODE_ENV === 'development';
if (DEBUG) console.log('Tracking metric:', metricData);
```

### Performance Testing
```javascript
// Measure metric overhead
const start = performance.now();
await trackApiMetric(...);
console.log(`Metric tracking took ${performance.now() - start}ms`);
```

## Support

For issues or questions about the metrics system:
1. Check error logs in console
2. Verify database schema is up-to-date
3. Ensure environment variables are set
4. Review this documentation

The metrics system is designed to be self-maintaining with automatic cleanup and efficient storage. Regular monitoring of the admin dashboard will help identify trends and potential issues before they impact users.