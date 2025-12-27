import { NextRequest, NextResponse } from 'next/server';

// Netdata API proxy - allows frontend to fetch metrics without CORS issues
// When running on the VPS, this accesses Netdata locally

// Netdata URL - defaults to Coolify network gateway which can access host services
// Override with NETDATA_URL env var if needed
const NETDATA_URL = process.env.NETDATA_URL || 'http://10.0.1.1:19999';
const METRICS_PASSWORD = process.env.METRICS_PASSWORD || process.env.ADMIN_PASSWORD;

function verifyAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.replace('Bearer ', '');
  return token === METRICS_PASSWORD;
}

export async function GET(request: NextRequest) {
  // Verify authentication
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const endpoint = searchParams.get('endpoint') || 'info';
  const chart = searchParams.get('chart');
  const after = searchParams.get('after') || '-60';
  const points = searchParams.get('points') || '60';
  const group = searchParams.get('group') || 'average';

  try {
    let url: string;

    if (endpoint === 'info') {
      url = `${NETDATA_URL}/api/v1/info`;
    } else if (endpoint === 'charts') {
      url = `${NETDATA_URL}/api/v1/charts`;
    } else if (endpoint === 'data' && chart) {
      url = `${NETDATA_URL}/api/v1/data?chart=${encodeURIComponent(chart)}&after=${after}&points=${points}&group=${group}&format=json`;
    } else if (endpoint === 'alarms') {
      url = `${NETDATA_URL}/api/v1/alarms`;
    } else {
      return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 });
    }

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Disable caching for real-time data
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Netdata API error: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Netdata proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics from Netdata' },
      { status: 500 }
    );
  }
}

// Batch endpoint for fetching multiple charts at once
export async function POST(request: NextRequest) {
  // Verify authentication
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { charts, after = -60, points = 60, group = 'average' } = body;

    if (!Array.isArray(charts) || charts.length === 0) {
      return NextResponse.json({ error: 'Charts array required' }, { status: 400 });
    }

    // Fetch all charts in parallel
    const results = await Promise.all(
      charts.map(async (chart: string) => {
        try {
          const url = `${NETDATA_URL}/api/v1/data?chart=${encodeURIComponent(chart)}&after=${after}&points=${points}&group=${group}&format=json`;
          const response = await fetch(url, { cache: 'no-store' });
          if (!response.ok) return { chart, error: true, data: null };
          const data = await response.json();
          return { chart, error: false, data };
        } catch {
          return { chart, error: true, data: null };
        }
      })
    );

    return NextResponse.json({ results }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('Netdata batch proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
