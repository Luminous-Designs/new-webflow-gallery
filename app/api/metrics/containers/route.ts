import { NextRequest, NextResponse } from 'next/server';

// Netdata URL - defaults to Coolify network gateway which can access host services
const NETDATA_URL = process.env.NETDATA_URL || 'http://10.0.1.1:19999';
// Container mapping service URL
const CONTAINER_MAPPING_URL = process.env.CONTAINER_MAPPING_URL || 'http://10.0.1.1:19998/container-mapping.json';
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
  fqdn: string | null;
  cpuChart: string | null;
  memChart: string | null;
  netChart: string | null;
}

// Fetch container name mapping from the host
async function fetchContainerMapping(): Promise<Record<string, string>> {
  try {
    const response = await fetch(CONTAINER_MAPPING_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.warn('Failed to fetch container mapping:', error);
  }
  return {};
}

// Extract a display name from the FQDN
function extractDisplayName(fqdn: string): string {
  // Remove common suffixes and extract meaningful part
  const cleaned = fqdn
    .replace(/\.178\.156\.177\.252\.sslip\.io$/i, '') // Remove sslip.io suffix
    .replace(/\.luminardigital\.com$/i, ''); // Remove main domain

  // If it's still a hash-like string, shorten it
  if (cleaned.match(/^[a-z0-9]{15,}$/i)) {
    return cleaned.substring(0, 8) + '...';
  }

  // Capitalize first letter for better display
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export async function GET(request: NextRequest) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch container mapping and charts in parallel
    const [containerMapping, chartsResponse] = await Promise.all([
      fetchContainerMapping(),
      fetch(`${NETDATA_URL}/api/v1/charts`, { cache: 'no-store' }),
    ]);

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
        // Look up friendly name from mapping
        // The mapping uses full container names which include deployment IDs
        // Container IDs in Netdata might be slightly different (no deployment suffix)
        let fqdn: string | null = null;
        let friendlyName = containerId;

        // Try to find a matching entry in the mapping
        for (const [fullName, mappedFqdn] of Object.entries(containerMapping)) {
          // Check if the container ID matches the start of any mapped container name
          if (fullName.startsWith(containerId) || containerId.startsWith(fullName.split('-')[0])) {
            fqdn = mappedFqdn;
            break;
          }
        }

        // Determine display name
        if (fqdn) {
          friendlyName = extractDisplayName(fqdn);
        } else if (containerId.startsWith('coolify')) {
          friendlyName = containerId;
        } else if (containerId.match(/^[a-z0-9]{15,}/i)) {
          friendlyName = containerId.substring(0, 8) + '...';
        }

        containersMap.set(containerId, {
          id: containerId,
          name: friendlyName,
          fqdn: fqdn,
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
