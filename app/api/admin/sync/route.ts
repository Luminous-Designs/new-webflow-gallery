import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectPlatform,
  buildRsyncArgs,
  execSshCommand,
  checkSshKey,
  getSetupInstructions,
  clearPlatformCache,
  PlatformInfo
} from '@/lib/sync/platform';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// VPS Configuration defaults
const DEFAULT_VPS_CONFIG = {
  user: 'root',
  host: '178.156.177.252',
  remotePath: '/data/webflow-gallery',
  sshKeyPath: '~/.ssh/id_ed25519'
};

// Store active sync process
let activeSyncProcess: ChildProcess | null = null;
let syncSessionId: string | null = null;
let syncProgress: SyncProgress | null = null;
let pauseRequested = false;

interface SyncProgress {
  sessionId: string;
  status: 'running' | 'paused' | 'completed' | 'error' | 'cancelled';
  direction: 'push' | 'pull' | 'bidirectional';
  currentPhase: 'screenshots' | 'thumbnails' | 'complete';
  totalFiles: number;
  transferredFiles: number;
  totalBytes: number;
  transferredBytes: number;
  currentFile: string;
  startedAt: string;
  lastUpdate: string;
  logs: Array<{ timestamp: string; message: string }>;
  error?: string;
}

interface StorageStats {
  screenshots: { count: number; size: number; sizeFormatted: string };
  thumbnails: { count: number; size: number; sizeFormatted: string };
  total: { count: number; size: number; sizeFormatted: string };
}

interface Discrepancy {
  filename: string;
  type: 'screenshot' | 'thumbnail';
  location: 'local-only' | 'vps-only';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function getLocalStats(): Promise<StorageStats> {
  const screenshotsPath = path.join(process.cwd(), 'public', 'screenshots');
  const thumbnailsPath = path.join(process.cwd(), 'public', 'thumbnails');

  const getStats = async (dirPath: string) => {
    try {
      const files = await fs.promises.readdir(dirPath);
      let totalSize = 0;
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isFile()) totalSize += stat.size;
      }
      return { count: files.length, size: totalSize };
    } catch {
      return { count: 0, size: 0 };
    }
  };

  const screenshots = await getStats(screenshotsPath);
  const thumbnails = await getStats(thumbnailsPath);
  const total = {
    count: screenshots.count + thumbnails.count,
    size: screenshots.size + thumbnails.size
  };

  return {
    screenshots: { ...screenshots, sizeFormatted: formatBytes(screenshots.size) },
    thumbnails: { ...thumbnails, sizeFormatted: formatBytes(thumbnails.size) },
    total: { ...total, sizeFormatted: formatBytes(total.size) }
  };
}

async function getVpsStats(
  config: typeof DEFAULT_VPS_CONFIG,
  platform: PlatformInfo
): Promise<StorageStats | null> {
  try {
    // Get screenshot count and size
    const screenshotCmd = `ls ${config.remotePath}/screenshots/ 2>/dev/null | wc -l && du -sb ${config.remotePath}/screenshots/ 2>/dev/null | cut -f1 || echo 0`;
    const screenshotResult = await execSshCommand(config, screenshotCmd, platform, 30000);
    const screenshotLines = screenshotResult.stdout.trim().split('\n');
    const screenshotCount = parseInt(screenshotLines[0]) || 0;
    const screenshotSize = parseInt(screenshotLines[1]) || 0;

    // Get thumbnail count and size
    const thumbnailCmd = `ls ${config.remotePath}/thumbnails/ 2>/dev/null | wc -l && du -sb ${config.remotePath}/thumbnails/ 2>/dev/null | cut -f1 || echo 0`;
    const thumbnailResult = await execSshCommand(config, thumbnailCmd, platform, 30000);
    const thumbnailLines = thumbnailResult.stdout.trim().split('\n');
    const thumbnailCount = parseInt(thumbnailLines[0]) || 0;
    const thumbnailSize = parseInt(thumbnailLines[1]) || 0;

    const total = {
      count: screenshotCount + thumbnailCount,
      size: screenshotSize + thumbnailSize
    };

    return {
      screenshots: { count: screenshotCount, size: screenshotSize, sizeFormatted: formatBytes(screenshotSize) },
      thumbnails: { count: thumbnailCount, size: thumbnailSize, sizeFormatted: formatBytes(thumbnailSize) },
      total: { ...total, sizeFormatted: formatBytes(total.size) }
    };
  } catch (error) {
    console.error('Failed to get VPS stats:', error);
    return null;
  }
}

async function getLocalFiles(type: 'screenshots' | 'thumbnails'): Promise<Set<string>> {
  const dirPath = path.join(process.cwd(), 'public', type);
  try {
    const files = await fs.promises.readdir(dirPath);
    return new Set(files.filter(f => !f.startsWith('.')));
  } catch {
    return new Set();
  }
}

async function getVpsFiles(
  config: typeof DEFAULT_VPS_CONFIG,
  type: 'screenshots' | 'thumbnails',
  platform: PlatformInfo
): Promise<Set<string>> {
  try {
    const cmd = `ls -1 ${config.remotePath}/${type}/ 2>/dev/null`;
    const result = await execSshCommand(config, cmd, platform, 30000);
    const files = result.stdout.trim().split('\n').filter(f => f && !f.startsWith('.'));
    return new Set(files);
  } catch {
    return new Set();
  }
}

async function getDiscrepancies(
  config: typeof DEFAULT_VPS_CONFIG,
  platform: PlatformInfo
): Promise<{
  localOnly: Discrepancy[];
  vpsOnly: Discrepancy[];
  total: { localOnly: number; vpsOnly: number };
}> {
  const [localScreenshots, localThumbnails, vpsScreenshots, vpsThumbnails] = await Promise.all([
    getLocalFiles('screenshots'),
    getLocalFiles('thumbnails'),
    getVpsFiles(config, 'screenshots', platform),
    getVpsFiles(config, 'thumbnails', platform)
  ]);

  const localOnly: Discrepancy[] = [];
  const vpsOnly: Discrepancy[] = [];

  // Find screenshots only on local
  for (const file of localScreenshots) {
    if (!vpsScreenshots.has(file)) {
      localOnly.push({ filename: file, type: 'screenshot', location: 'local-only' });
    }
  }

  // Find screenshots only on VPS
  for (const file of vpsScreenshots) {
    if (!localScreenshots.has(file)) {
      vpsOnly.push({ filename: file, type: 'screenshot', location: 'vps-only' });
    }
  }

  // Find thumbnails only on local
  for (const file of localThumbnails) {
    if (!vpsThumbnails.has(file)) {
      localOnly.push({ filename: file, type: 'thumbnail', location: 'local-only' });
    }
  }

  // Find thumbnails only on VPS
  for (const file of vpsThumbnails) {
    if (!localThumbnails.has(file)) {
      vpsOnly.push({ filename: file, type: 'thumbnail', location: 'vps-only' });
    }
  }

  return {
    localOnly,
    vpsOnly,
    total: { localOnly: localOnly.length, vpsOnly: vpsOnly.length }
  };
}

async function testVpsConnection(
  config: typeof DEFAULT_VPS_CONFIG,
  platform: PlatformInfo
): Promise<{
  connected: boolean;
  error?: string;
  keyPath?: string;
  platform: PlatformInfo;
  setupInstructions?: { sshSetup: string[]; rsyncSetup: string[] };
}> {
  const keyCheck = await checkSshKey(config.sshKeyPath);

  // Check if SSH is available on this platform
  if (!platform.hasSsh) {
    return {
      connected: false,
      error: platform.isWindows
        ? 'SSH is not available. Please install OpenSSH for Windows (Settings > Apps > Optional Features > OpenSSH Client).'
        : 'SSH is not installed. Please install OpenSSH.',
      keyPath: keyCheck.path,
      platform,
      setupInstructions: getSetupInstructions(platform, config)
    };
  }

  // Check if the SSH key exists
  if (!keyCheck.exists) {
    return {
      connected: false,
      error: `SSH key not found at: ${keyCheck.path}. Please generate an SSH key.`,
      keyPath: keyCheck.path,
      platform,
      setupInstructions: getSetupInstructions(platform, config)
    };
  }

  if (!keyCheck.readable) {
    return {
      connected: false,
      error: `SSH key exists but is not readable at: ${keyCheck.path}. Please check file permissions.`,
      keyPath: keyCheck.path,
      platform,
      setupInstructions: getSetupInstructions(platform, config)
    };
  }

  try {
    await execSshCommand(config, 'echo connected', platform, 10000);
    return { connected: true, keyPath: keyCheck.path, platform };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Connection failed';

    // Provide more helpful error messages
    let userError = errorMsg;
    if (errorMsg.includes('Permission denied')) {
      userError = `SSH authentication failed. The key at ${keyCheck.path} may not be authorized on the VPS. You need to copy your public key to the server.`;
    } else if (errorMsg.includes('Connection refused') || errorMsg.includes('Connection timed out') || errorMsg.includes('ETIMEDOUT')) {
      userError = `Cannot reach VPS at ${config.host}. Check that the server is running and accessible.`;
    } else if (errorMsg.includes('Host key verification failed')) {
      userError = `Host key verification failed. The VPS host key may have changed. On Windows, you can fix this by running: ssh-keygen -R ${config.host}`;
    }

    return {
      connected: false,
      error: userError,
      keyPath: keyCheck.path,
      platform,
      setupInstructions: getSetupInstructions(platform, config)
    };
  }
}

function startRsyncProcess(
  config: typeof DEFAULT_VPS_CONFIG,
  direction: 'push' | 'pull' | 'bidirectional',
  sessionId: string,
  platform: PlatformInfo
): void {
  syncProgress = {
    sessionId,
    status: 'running',
    direction,
    currentPhase: 'screenshots',
    totalFiles: 0,
    transferredFiles: 0,
    totalBytes: 0,
    transferredBytes: 0,
    currentFile: '',
    startedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    logs: [
      { timestamp: new Date().toISOString(), message: `Starting ${direction} sync...` },
      { timestamp: new Date().toISOString(), message: `Platform: ${platform.os} | rsync: ${platform.rsyncPath || 'not found'}` }
    ]
  };
  pauseRequested = false;

  const runSync = async () => {
    const phases: Array<'screenshots' | 'thumbnails'> = ['screenshots', 'thumbnails'];

    for (const phase of phases) {
      if (pauseRequested || !syncProgress) break;

      syncProgress.currentPhase = phase;
      syncProgress.logs.push({
        timestamp: new Date().toISOString(),
        message: `Starting ${phase} sync...`
      });

      const localPath = path.join(process.cwd(), 'public', phase) + (platform.isWindows ? '\\' : '/');

      // Build rsync command based on direction
      const rsyncConfig = {
        ...config,
        remotePath: `${config.remotePath}/${phase}/`
      };

      // For bidirectional, pull first then push
      const directions: Array<'push' | 'pull'> = direction === 'bidirectional'
        ? ['pull', 'push']
        : [direction];

      for (const dir of directions) {
        if (pauseRequested || !syncProgress) break;

        const { command, args } = buildRsyncArgs(
          rsyncConfig,
          localPath,
          dir,
          platform,
          { update: direction === 'bidirectional' }
        );

        syncProgress.logs.push({
          timestamp: new Date().toISOString(),
          message: `Running: ${command} ${args.slice(0, 3).join(' ')} ...`
        });

        await new Promise<void>((resolve, reject) => {
          // On Windows, we may need to spawn differently
          const spawnOptions: { stdio: ['ignore', 'pipe', 'pipe']; shell?: boolean } = {
            stdio: ['ignore', 'pipe', 'pipe']
          };

          // If rsync is from Git Bash or MSYS, we might need shell
          if (platform.isWindows && command.includes('Git')) {
            spawnOptions.shell = true;
          }

          activeSyncProcess = spawn(command, args, spawnOptions);

          let outputBuffer = '';

          activeSyncProcess.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            outputBuffer += text;

            // Parse rsync progress output
            const lines = outputBuffer.split('\n');
            outputBuffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim()) {
                // Parse file transfer info
                const fileMatch = line.match(/^[<>]f[+.].+\s+(.+)$/);
                if (fileMatch) {
                  syncProgress!.currentFile = fileMatch[1];
                  syncProgress!.transferredFiles++;
                }

                // Parse progress percentage
                const progressMatch = line.match(/(\d+)%/);
                if (progressMatch && syncProgress) {
                  syncProgress.lastUpdate = new Date().toISOString();
                }

                // Parse bytes transferred
                const bytesMatch = line.match(/(\d+(?:,\d{3})*)\s+(\d+)%/);
                if (bytesMatch && syncProgress) {
                  syncProgress.transferredBytes = parseInt(bytesMatch[1].replace(/,/g, ''));
                }
              }
            }
          });

          activeSyncProcess.stderr?.on('data', (data: Buffer) => {
            const error = data.toString();
            syncProgress?.logs.push({
              timestamp: new Date().toISOString(),
              message: `Error: ${error.trim()}`
            });
          });

          activeSyncProcess.on('close', (code) => {
            if (code === 0) {
              syncProgress?.logs.push({
                timestamp: new Date().toISOString(),
                message: `${phase} ${dir} completed successfully`
              });
              resolve();
            } else if (code === null && pauseRequested) {
              resolve();
            } else {
              reject(new Error(`rsync exited with code ${code}`));
            }
          });

          activeSyncProcess.on('error', (error) => {
            reject(error);
          });
        });
      }
    }

    if (syncProgress) {
      if (pauseRequested) {
        syncProgress.status = 'paused';
        syncProgress.logs.push({
          timestamp: new Date().toISOString(),
          message: 'Sync paused'
        });
      } else {
        syncProgress.status = 'completed';
        syncProgress.currentPhase = 'complete';
        syncProgress.logs.push({
          timestamp: new Date().toISOString(),
          message: 'All sync operations completed!'
        });
      }
    }
    activeSyncProcess = null;
  };

  runSync().catch((error) => {
    if (syncProgress) {
      syncProgress.status = 'error';
      syncProgress.error = error instanceof Error ? error.message : 'Sync failed';
      syncProgress.logs.push({
        timestamp: new Date().toISOString(),
        message: `Error: ${syncProgress.error}`
      });
    }
    activeSyncProcess = null;
  });
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  // Get VPS config from query params or use defaults
  const config = {
    user: searchParams.get('vpsUser') || DEFAULT_VPS_CONFIG.user,
    host: searchParams.get('vpsHost') || DEFAULT_VPS_CONFIG.host,
    remotePath: searchParams.get('vpsPath') || DEFAULT_VPS_CONFIG.remotePath,
    sshKeyPath: searchParams.get('sshKey') || DEFAULT_VPS_CONFIG.sshKeyPath
  };

  // Detect platform
  const platform = await detectPlatform();

  try {
    switch (action) {
      case 'status': {
        // Get current sync status
        return NextResponse.json({
          isActive: activeSyncProcess !== null,
          progress: syncProgress,
          defaultConfig: DEFAULT_VPS_CONFIG,
          platform
        });
      }

      case 'test-connection': {
        const result = await testVpsConnection(config, platform);
        return NextResponse.json(result);
      }

      case 'local-stats': {
        const stats = await getLocalStats();
        return NextResponse.json({ stats, platform });
      }

      case 'vps-stats': {
        const stats = await getVpsStats(config, platform);
        if (!stats) {
          return NextResponse.json({ error: 'Failed to connect to VPS', platform }, { status: 500 });
        }
        return NextResponse.json({ stats, platform });
      }

      case 'compare': {
        const [localStats, vpsStats, discrepancies] = await Promise.all([
          getLocalStats(),
          getVpsStats(config, platform),
          getDiscrepancies(config, platform)
        ]);

        return NextResponse.json({
          local: localStats,
          vps: vpsStats,
          discrepancies,
          isInSync: discrepancies.total.localOnly === 0 && discrepancies.total.vpsOnly === 0,
          platform
        });
      }

      case 'discrepancies': {
        const discrepancies = await getDiscrepancies(config, platform);
        return NextResponse.json({ ...discrepancies, platform });
      }

      case 'platform': {
        // Force re-detect platform (useful after installing tools)
        clearPlatformCache();
        const freshPlatform = await detectPlatform();
        return NextResponse.json({
          platform: freshPlatform,
          setupInstructions: getSetupInstructions(freshPlatform, config)
        });
      }

      default:
        // Default: return full status and stats
        const [localStats, vpsStats] = await Promise.all([
          getLocalStats(),
          getVpsStats(config, platform)
        ]);

        return NextResponse.json({
          isActive: activeSyncProcess !== null,
          progress: syncProgress,
          local: localStats,
          vps: vpsStats,
          config: DEFAULT_VPS_CONFIG,
          platform
        });
    }
  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process request',
        platform
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Detect platform
  const platform = await detectPlatform();

  try {
    const body = await request.json();
    const { action, direction, config: customConfig } = body;

    const config = {
      ...DEFAULT_VPS_CONFIG,
      ...customConfig
    };

    switch (action) {
      case 'start': {
        if (activeSyncProcess) {
          return NextResponse.json(
            { error: 'A sync operation is already in progress' },
            { status: 400 }
          );
        }

        if (!['push', 'pull', 'bidirectional'].includes(direction)) {
          return NextResponse.json(
            { error: 'Invalid direction. Must be push, pull, or bidirectional' },
            { status: 400 }
          );
        }

        // Check if rsync is available
        if (!platform.hasRsync) {
          const instructions = getSetupInstructions(platform, config);
          return NextResponse.json(
            {
              error: platform.isWindows
                ? 'rsync is not installed on this Windows system. Please install Git for Windows (which includes rsync) or cwRsync.'
                : 'rsync is not installed. Please install it using your package manager.',
              platform,
              setupInstructions: instructions
            },
            { status: 400 }
          );
        }

        // Test connection first
        const connectionTest = await testVpsConnection(config, platform);
        if (!connectionTest.connected) {
          return NextResponse.json(
            {
              error: `Cannot connect to VPS: ${connectionTest.error}`,
              platform,
              setupInstructions: connectionTest.setupInstructions
            },
            { status: 400 }
          );
        }

        const sessionId = `sync_${Date.now()}`;
        syncSessionId = sessionId;
        startRsyncProcess(config, direction, sessionId, platform);

        return NextResponse.json({
          message: 'Sync started',
          sessionId,
          direction,
          platform
        });
      }

      case 'pause': {
        if (!activeSyncProcess) {
          return NextResponse.json(
            { error: 'No active sync operation' },
            { status: 400 }
          );
        }

        pauseRequested = true;
        // On Windows, SIGTERM might not work the same way
        if (platform.isWindows) {
          activeSyncProcess.kill();
        } else {
          activeSyncProcess.kill('SIGTERM');
        }

        return NextResponse.json({
          message: 'Pause requested',
          sessionId: syncSessionId
        });
      }

      case 'stop': {
        if (!activeSyncProcess) {
          return NextResponse.json(
            { error: 'No active sync operation' },
            { status: 400 }
          );
        }

        // On Windows, just kill; on Unix, use SIGKILL
        if (platform.isWindows) {
          activeSyncProcess.kill();
        } else {
          activeSyncProcess.kill('SIGKILL');
        }
        activeSyncProcess = null;

        if (syncProgress) {
          syncProgress.status = 'cancelled';
          syncProgress.logs.push({
            timestamp: new Date().toISOString(),
            message: 'Sync cancelled by user'
          });
        }

        return NextResponse.json({
          message: 'Sync stopped',
          sessionId: syncSessionId
        });
      }

      case 'clear': {
        // Clear sync progress/session
        syncProgress = null;
        syncSessionId = null;
        pauseRequested = false;

        return NextResponse.json({ message: 'Session cleared' });
      }

      case 'refresh-platform': {
        // Force refresh platform detection
        clearPlatformCache();
        const freshPlatform = await detectPlatform();
        return NextResponse.json({
          message: 'Platform detection refreshed',
          platform: freshPlatform
        });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process request',
        platform
      },
      { status: 500 }
    );
  }
}
