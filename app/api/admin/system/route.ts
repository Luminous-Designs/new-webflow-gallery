import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import { getR2Config } from '@/lib/r2';

const CACHE_TTL_MS = 30_000;

interface SystemStatsPayload {
  system: {
    platform: string;
    architecture: string;
    hostname: string;
    uptime: number;
    nodeVersion: string;
  };
  environment: {
    type: 'local' | 'production';
    name: string;
    description: string;
    storageMode: 'r2';
    r2PublicUrl: string | null;
  };
  cpu: {
    cores: number;
    model: string;
    usage: Array<{ core: number; model: string; speed: string; usage: string }>;
    loadAverage: {
      '1min': string;
      '5min': string;
      '15min': string;
    };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
    process: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
    };
  };
  storage: {
    mode: 'r2';
    r2Configured: boolean;
    r2BucketName: string | null;
    r2PublicUrl: string | null;
  };
  recommendations: {
    maxConcurrency: number;
    suggestedBrowsers: number;
    suggestedPagesPerBrowser: number;
  };
}

let cachedResponse: { timestamp: number; payload: SystemStatsPayload } | null = null;

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = Date.now();
    if (cachedResponse && now - cachedResponse.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedResponse.payload);
    }

    // Get system resources
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const loadAverage = os.loadavg();

    // Calculate CPU usage percentage
    const cpuUsage = cpus.map((cpu, index) => {
      const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
      const idle = cpu.times.idle;
      const usage = 100 - Math.round((idle / total) * 100);
      return {
        core: index,
        model: cpu.model,
        speed: `${cpu.speed} MHz`,
        usage: `${usage}%`
      };
    });

    // Get R2 config for storage info
    const r2Config = getR2Config();

    // Get scraper memory usage estimate
    const processMemory = process.memoryUsage();

    // Detect environment type
    const hostname = os.hostname();
    const isProduction = process.env.NODE_ENV === 'production';

    const environmentType: 'local' | 'production' = isProduction ? 'production' : 'local';
    const environmentName = isProduction ? 'Production' : 'Local Development';
    const environmentDescription = `Running on ${hostname}`;

    const payload: SystemStatsPayload = {
      system: {
        platform: os.platform(),
        architecture: os.arch(),
        hostname: os.hostname(),
        uptime: Math.floor(os.uptime() / 60), // in minutes
        nodeVersion: process.version
      },
      environment: {
        type: environmentType,
        name: environmentName,
        description: environmentDescription,
        storageMode: 'r2',
        r2PublicUrl: r2Config.publicUrl
      },
      cpu: {
        cores: cpus.length,
        model: cpus[0]?.model || 'Unknown',
        usage: cpuUsage,
        loadAverage: {
          '1min': loadAverage[0].toFixed(2),
          '5min': loadAverage[1].toFixed(2),
          '15min': loadAverage[2].toFixed(2)
        }
      },
      memory: {
        total: totalMemory,
        used: usedMemory,
        free: freeMemory,
        percentage: Math.round((usedMemory / totalMemory) * 100),
        process: {
          rss: processMemory.rss,
          heapTotal: processMemory.heapTotal,
          heapUsed: processMemory.heapUsed,
          external: processMemory.external
        }
      },
      storage: {
        mode: 'r2',
        r2Configured: r2Config.configured,
        r2BucketName: r2Config.bucketName,
        r2PublicUrl: r2Config.publicUrl
      },
      recommendations: {
        maxConcurrency: Math.min(cpus.length * 10, 100),
        suggestedBrowsers: Math.min(cpus.length * 2, 20),
        suggestedPagesPerBrowser: Math.min(Math.floor(freeMemory / (500 * 1024 * 1024)), 50) // 500MB per page estimate
      }
    };

    cachedResponse = { timestamp: now, payload };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('System stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system stats' },
      { status: 500 }
    );
  }
}
