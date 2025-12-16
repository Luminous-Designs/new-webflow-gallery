import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';

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
    type: 'local' | 'vps';
    name: string;
    description: string;
    persistentVolume: boolean;
    storagePath: string;
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
    screenshots: number;
    thumbnails: number;
    database: number;
    total: number;
    screenshotCount: number;
    thumbnailCount: number;
  };
  recommendations: {
    maxConcurrency: number;
    suggestedBrowsers: number;
    suggestedPagesPerBrowser: number;
  };
}

let cachedResponse: { timestamp: number; payload: SystemStatsPayload } | null = null;

async function getDirectorySize(dirPath: string): Promise<number> {
  let size = 0;
  try {
    const dirHandle = await fs.opendir(dirPath);
    for await (const entry of dirHandle) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += await getDirectorySize(entryPath);
      } else if (entry.isFile()) {
        const stats = await fs.stat(entryPath);
        size += stats.size;
      }
    }
  } catch {
    // Directory may not exist
  }
  return size;
}

async function getFileCount(dirPath: string): Promise<number> {
  let count = 0;
  try {
    const dirHandle = await fs.opendir(dirPath);
    for await (const entry of dirHandle) {
      if (entry.isFile()) {
        count++;
      }
    }
  } catch {
    // Directory may not exist
  }
  return count;
}

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

    // Determine storage paths based on environment
    const usePersistentVolume = process.env.USE_PERSISTENT_VOLUME === 'true';
    const persistentVolumePath = process.env.PERSISTENT_VOLUME_PATH || '/templates-data/contents';

    // Get directory sizes - check persistent volume paths if enabled
    let screenshotDir: string;
    let thumbnailDir: string;
    let dataDir: string;

    if (usePersistentVolume) {
      // Production VPS paths
      screenshotDir = path.join(persistentVolumePath, 'screenshots');
      thumbnailDir = path.join(persistentVolumePath, 'thumbnails');
      dataDir = path.join(persistentVolumePath, 'data');
    } else {
      // Local development paths
      screenshotDir = './public/screenshots';
      thumbnailDir = './public/thumbnails';
      dataDir = './data';
    }

    const [screenshotSize, thumbnailSize, dataSize, screenshotCount, thumbnailCount] = await Promise.all([
      getDirectorySize(screenshotDir),
      getDirectorySize(thumbnailDir),
      getDirectorySize(dataDir),
      getFileCount(screenshotDir),
      getFileCount(thumbnailDir)
    ]);

    // Get scraper memory usage estimate
    const processMemory = process.memoryUsage();

    // Detect environment type
    const hostname = os.hostname();
    const isVPS = usePersistentVolume ||
                  hostname.includes('vps') ||
                  hostname.includes('server') ||
                  process.env.NODE_ENV === 'production' ||
                  !hostname.includes('.local');

    const environmentType: 'local' | 'vps' = isVPS ? 'vps' : 'local';
    const environmentName = isVPS ? 'Production Server (VPS)' : 'Local Development';
    const environmentDescription = isVPS
      ? `Running on ${hostname} with persistent storage`
      : `Running on ${hostname} - images stored locally`;

    const payload = {
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
        persistentVolume: usePersistentVolume,
        storagePath: usePersistentVolume ? persistentVolumePath : './public'
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
        screenshots: screenshotSize,
        thumbnails: thumbnailSize,
        database: dataSize,
        total: screenshotSize + thumbnailSize + dataSize,
        screenshotCount,
        thumbnailCount
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
