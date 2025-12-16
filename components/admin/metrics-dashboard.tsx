'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import {
  Activity, Clock, Users, AlertTriangle, HardDrive,
  Cpu, Server, RefreshCw, Database
} from 'lucide-react';

interface MetricsDashboardProps {
  adminPassword: string;
}

interface SystemHealthSnapshot {
  cpu_usage: number;
  memory_usage_mb: number;
  database_size_mb: number;
  screenshot_count: number;
  screenshot_size_gb?: number;
}

interface RealtimeMetrics {
  activeUsers: number;
  requestsPerMinute: number;
  errorRate: number;
  avgResponseTime: number;
  systemHealth?: SystemHealthSnapshot | null;
}

interface SystemMetricEntry {
  time: string;
  cpu_usage: number;
  memory_percentage: number;
  database_size_mb: number;
  screenshot_size_gb: number;
  active_connections?: number;
}

interface ApiMetricEntry {
  endpoint: string;
  avg_response_time: number;
  request_count: number;
  error_count: number;
}

interface PreviewMetricSummary {
  avg_load_time: number;
  preview_count: number;
  avg_navigation_count: number;
  error_count: number;
  fast_count?: number;
  avg_count?: number;
  slow_count?: number;
}

interface PageViewMetric {
  page_path: string;
  view_count: number;
  unique_visitors: number;
  avg_duration?: number;
}

interface HourlyMetric {
  hour: string;
  requests: number;
  avg_response_time: number;
}

export default function MetricsDashboard({ adminPassword }: MetricsDashboardProps) {
  const [realtimeMetrics, setRealtimeMetrics] = useState<RealtimeMetrics | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetricEntry[]>([]);
  const [apiMetrics, setApiMetrics] = useState<ApiMetricEntry[]>([]);
  const [previewMetrics, setPreviewMetrics] = useState<PreviewMetricSummary | null>(null);
  const [pageViewMetrics, setPageViewMetrics] = useState<PageViewMetric[]>([]);
  const [hourlyMetrics, setHourlyMetrics] = useState<HourlyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [timeRange, setTimeRange] = useState(24);

  // Fetch metrics data
  const fetchMetrics = useCallback(async () => {
    try {
      const headers = {
        'Authorization': `Bearer ${adminPassword}`
      };

      // Fetch all metrics in parallel
      const [
        realtimeRes,
        systemRes,
        apiRes,
        previewRes,
        pageviewRes,
        hourlyRes
      ] = await Promise.all([
        fetch('/api/admin/metrics?type=realtime', { headers }),
        fetch(`/api/admin/metrics?type=system&hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics?type=api&hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics?type=preview&hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics?type=pageviews&hours=${timeRange}`, { headers }),
        fetch(`/api/admin/metrics?type=hourly&hours=${timeRange}`, { headers })
      ]);

      const [realtime, system, api, preview, pageviews, hourly] = await Promise.all([
        realtimeRes.json(),
        systemRes.json(),
        apiRes.json(),
        previewRes.json(),
        pageviewRes.json(),
        hourlyRes.json()
      ]);

      setRealtimeMetrics((realtime ?? null) as RealtimeMetrics | null);
      setSystemMetrics(Array.isArray(system) ? (system as SystemMetricEntry[]) : []);
      setApiMetrics(Array.isArray(api) ? (api as ApiMetricEntry[]) : []);
      const previewSummary = Array.isArray(preview) ? (preview[0] as PreviewMetricSummary | undefined) : undefined;
      setPreviewMetrics(previewSummary ?? null);
      setPageViewMetrics(Array.isArray(pageviews) ? (pageviews as PageViewMetric[]) : []);
      setHourlyMetrics(Array.isArray(hourly) ? (hourly as HourlyMetric[]) : []);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  }, [adminPassword, timeRange]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchMetrics();

    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(fetchMetrics, 30000); // Refresh every 30 seconds
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, fetchMetrics]);

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
  };

  const percentage = (count?: number, total?: number) => {
    if (!total || total === 0) {
      return 0;
    }
    return ((count ?? 0) / total) * 100;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p>Loading metrics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant={timeRange === 1 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange(1)}
          >
            1H
          </Button>
          <Button
            variant={timeRange === 6 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange(6)}
          >
            6H
          </Button>
          <Button
            variant={timeRange === 24 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange(24)}
          >
            24H
          </Button>
          <Button
            variant={timeRange === 168 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange(168)}
          >
            7D
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${autoRefresh ? 'animate-spin' : ''}`} />
            Auto Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchMetrics}
          >
            Refresh Now
          </Button>
        </div>
      </div>

      {/* Real-time Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {realtimeMetrics?.activeUsers || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Last 5 minutes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {realtimeMetrics?.avgResponseTime?.toFixed(0) || 0}ms
            </div>
            <p className="text-xs text-muted-foreground">
              Last 5 minutes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Requests/Min</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {realtimeMetrics?.requestsPerMinute || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Current rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Error Rate</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {realtimeMetrics?.errorRate?.toFixed(1) || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              Last hour
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="system">System Health</TabsTrigger>
          <TabsTrigger value="preview">Preview Analytics</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>API Response Times</CardTitle>
              <CardDescription>Average response times per hour</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={hourlyMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={(value) => format(new Date(value), 'HH:mm')}
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, HH:mm')}
                    formatter={(value: number) => `${value.toFixed(0)}ms`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="avg_response_time"
                    stroke="#6366f1"
                    name="Avg Response Time"
                    strokeWidth={2}
                  />
                  <Line
                    type="monotone"
                    dataKey="requests"
                    stroke="#8b5cf6"
                    name="Request Count"
                    yAxisId="right"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>API Endpoints</CardTitle>
                <CardDescription>Performance by endpoint</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {apiMetrics.slice(0, 5).map((endpoint, index) => (
                    <div key={`${endpoint.endpoint}-${index}`} className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium truncate">{endpoint.endpoint}</p>
                        <div className="flex items-center gap-4 mt-1">
                          <span className="text-xs text-muted-foreground">
                            Avg: {endpoint.avg_response_time?.toFixed(0)}ms
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Calls: {endpoint.request_count}
                          </span>
                          {endpoint.error_count > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {endpoint.error_count} errors
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Preview Performance</CardTitle>
                <CardDescription>Template preview statistics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Avg Load Time</span>
                    <span className="text-xl font-bold">
                      {previewMetrics?.avg_load_time?.toFixed(0) || 0}ms
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Previews</span>
                    <span className="text-xl font-bold">
                      {previewMetrics?.preview_count || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Avg Navigation</span>
                    <span className="text-xl font-bold">
                      {previewMetrics?.avg_navigation_count?.toFixed(1) || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Error Rate</span>
                    <span className="text-xl font-bold">
                      {percentage(previewMetrics?.error_count, previewMetrics?.preview_count).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* System Health Tab */}
        <TabsContent value="system" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>CPU & Memory Usage</CardTitle>
                <CardDescription>System resource utilization over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={systemMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(value) => format(new Date(value), 'HH:mm')}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) => format(new Date(value), 'MMM dd, HH:mm')}
                      formatter={(value: number) => `${value.toFixed(1)}%`}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="cpu_usage"
                      stroke="#6366f1"
                      fill="#6366f1"
                      fillOpacity={0.6}
                      name="CPU Usage %"
                    />
                    <Area
                      type="monotone"
                      dataKey="memory_percentage"
                      stroke="#8b5cf6"
                      fill="#8b5cf6"
                      fillOpacity={0.6}
                      name="Memory %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Storage Usage</CardTitle>
                <CardDescription>Database and screenshot storage</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={systemMetrics}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(value) => format(new Date(value), 'HH:mm')}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) => format(new Date(value), 'MMM dd, HH:mm')}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="database_size_mb"
                      stroke="#ec4899"
                      name="Database (MB)"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="screenshot_size_gb"
                      stroke="#f43f5e"
                      name="Screenshots (GB)"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* System Health Summary */}
          {realtimeMetrics?.systemHealth && (
            <Card>
              <CardHeader>
                <CardTitle>Current System Status</CardTitle>
                <CardDescription>Latest system health snapshot</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">CPU Usage</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {realtimeMetrics.systemHealth.cpu_usage?.toFixed(1)}%
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Memory</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatBytes(realtimeMetrics.systemHealth.memory_usage_mb * 1024 * 1024)}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Database</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {realtimeMetrics.systemHealth.database_size_mb?.toFixed(1)} MB
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Screenshots</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {realtimeMetrics.systemHealth.screenshot_count} files
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Preview Analytics Tab */}
        <TabsContent value="preview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Preview Load Times Distribution</CardTitle>
              <CardDescription>Performance distribution of template previews</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-muted-foreground">Fast (&lt;1s)</p>
                    <p className="text-2xl font-bold text-green-600">
                      {percentage(previewMetrics?.fast_count, previewMetrics?.preview_count).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Average (1-3s)</p>
                    <p className="text-2xl font-bold text-yellow-600">
                      {percentage(previewMetrics?.avg_count, previewMetrics?.preview_count).toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Slow (&gt;3s)</p>
                    <p className="text-2xl font-bold text-red-600">
                      {percentage(previewMetrics?.slow_count, previewMetrics?.preview_count).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Traffic Tab */}
        <TabsContent value="traffic" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top Pages</CardTitle>
              <CardDescription>Most visited pages in the last {timeRange} hours</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={pageViewMetrics.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="page_path"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                  />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="view_count" fill="#6366f1" name="Page Views" />
                  <Bar dataKey="unique_visitors" fill="#8b5cf6" name="Unique Visitors" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
