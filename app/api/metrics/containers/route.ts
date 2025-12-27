import { NextRequest, NextResponse } from 'next/server';

// Netdata URL - defaults to Coolify network gateway which can access host services
const NETDATA_URL = process.env.NETDATA_URL || 'http://10.0.1.1:19999';
const METRICS_PASSWORD = process.env.METRICS_PASSWORD || process.env.ADMIN_PASSWORD;

function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  return token === METRICS_PASSWORD;
}

interface ChartInfo {
  name: string;
  title: string;
  family: string;
  context: string;
}

interface ChartsResponse {
  charts: Record<string, ChartInfo>;
}

export interface ContainerInfo {
  id: string;
  name: string;
  cpuChart: string | null;
  memChart: string | null;
  netChart: string | null;
}

export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all charts to find container-related ones
    const chartsResponse = await fetch(`${NETDATA_URL}/api/v1/charts`, {
      cache: 'no-store',
    });

    if (!chartsResponse.ok) {
      throw new Error('Failed to fetch charts');
    }

    const chartsData: ChartsResponse = await chartsResponse.json();
    const charts = chartsData.charts;

    // Find all cgroup (container) charts
    const containerCharts = Object.entries(charts).filter(
      ([key]) => key.startsWith('cgroup_')
    );

    // Group charts by container ID
    const containersMap = new Map<string, ContainerInfo>();

    for (const [chartKey] of containerCharts) {
      // Extract container ID from chart key (e.g., cgroup_coolify.cpu -> coolify)
      const match = chartKey.match(/^cgroup_([^.]+)\.(.+)$/);
      if (!match) continue;

      const [, containerId, chartType] = match;

      if (!containersMap.has(containerId)) {
        // Try to extract a friendly name
        let friendlyName = containerId;

        // Common Coolify patterns
        if (containerId.startsWith('coolify')) {
          friendlyName = containerId;
        } else if (containerId.match(/^[a-z0-9]{20,}/i)) {
          // Long hash-like IDs - try to shorten
          friendlyName = containerId.substring(0, 12) + '...';
        }

        containersMap.set(containerId, {
          id: containerId,
          name: friendlyName,
          cpuChart: null,
          memChart: null,
          netChart: null,
        });
      }

      const container = containersMap.get(containerId)!;

      // Map chart types
      if (chartType === 'cpu') {
        container.cpuChart = chartKey;
      } else if (chartType === 'mem' || chartType === 'mem_usage') {
        if (!container.memChart || chartType === 'mem_usage') {
          container.memChart = chartKey;
        }
      } else if (chartType.startsWith('net_') && chartType.includes('eth0') && !chartType.includes('_')) {
        container.netChart = chartKey;
      }
    }

    // Fetch current CPU and memory values for each container
    const containers = Array.from(containersMap.values());

    const enrichedContainers = await Promise.all(
      containers.map(async (container) => {
        let cpuPercent = 0;
        let memMB = 0;

        if (container.cpuChart) {
          try {
            const cpuResponse = await fetch(
              `${NETDATA_URL}/api/v1/data?chart=${container.cpuChart}&after=-5&points=1&group=average&format=json`,
              { cache: 'no-store' }
            );
            if (cpuResponse.ok) {
              const cpuData = await cpuResponse.json();
              if (cpuData.data && cpuData.data[0]) {
                // Sum all CPU values (user, system, etc.)
                const values = cpuData.data[0].slice(1);
                cpuPercent = values.reduce((a: number, b: number) => a + (b || 0), 0);
              }
            }
          } catch {
            // Ignore errors for individual containers
          }
        }

        if (container.memChart) {
          try {
            const memResponse = await fetch(
              `${NETDATA_URL}/api/v1/data?chart=${container.memChart}&after=-5&points=1&group=average&format=json`,
              { cache: 'no-store' }
            );
            if (memResponse.ok) {
              const memData = await memResponse.json();
              if (memData.data && memData.data[0]) {
                // Memory is typically in bytes, convert to MB
                const values = memData.data[0].slice(1);
                const totalBytes = values.reduce((a: number, b: number) => a + (b || 0), 0);
                memMB = totalBytes; // Already in MB from Netdata
              }
            }
          } catch {
            // Ignore errors for individual containers
          }
        }

        return {
          ...container,
          cpuPercent: Math.max(0, cpuPercent),
          memMB: Math.max(0, memMB),
        };
      })
    );

    // Sort by memory usage descending
    enrichedContainers.sort((a, b) => b.memMB - a.memMB);

    return NextResponse.json({ containers: enrichedContainers }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Container metrics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch container metrics' },
      { status: 500 }
    );
  }
}
