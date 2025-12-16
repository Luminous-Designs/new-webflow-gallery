import { NextRequest, NextResponse } from 'next/server';
import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Expand ~ to home directory
function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// Build SSH options string with key
function buildSshOptions(config: { sshKeyPath: string }): string {
  const keyPath = expandPath(config.sshKeyPath);
  return `-o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}"`;
}

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

async function getVpsStats(config: typeof DEFAULT_VPS_CONFIG): Promise<StorageStats | null> {
  const sshOpts = buildSshOptions(config);
  const sshPrefix = `ssh ${sshOpts} ${config.user}@${config.host}`;

  try {
    // Get screenshot count and size
    const screenshotCmd = `${sshPrefix} "ls ${config.remotePath}/screenshots/ 2>/dev/null | wc -l && du -sb ${config.remotePath}/screenshots/ 2>/dev/null | cut -f1 || echo 0"`;
    const screenshotResult = await execAsync(screenshotCmd, { timeout: 30000 });
    const screenshotLines = screenshotResult.stdout.trim().split('\n');
    const screenshotCount = parseInt(screenshotLines[0]) || 0;
    const screenshotSize = parseInt(screenshotLines[1]) || 0;

    // Get thumbnail count and size
    const thumbnailCmd = `${sshPrefix} "ls ${config.remotePath}/thumbnails/ 2>/dev/null | wc -l && du -sb ${config.remotePath}/thumbnails/ 2>/dev/null | cut -f1 || echo 0"`;
    const thumbnailResult = await execAsync(thumbnailCmd, { timeout: 30000 });
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

async function getVpsFiles(config: typeof DEFAULT_VPS_CONFIG, type: 'screenshots' | 'thumbnails'): Promise<Set<string>> {
  const sshOpts = buildSshOptions(config);
  const sshPrefix = `ssh ${sshOpts} ${config.user}@${config.host}`;
  try {
    const cmd = `${sshPrefix} "ls -1 ${config.remotePath}/${type}/ 2>/dev/null"`;
    const result = await execAsync(cmd, { timeout: 30000 });
    const files = result.stdout.trim().split('\n').filter(f => f && !f.startsWith('.'));
    return new Set(files);
  } catch {
    return new Set();
  }
}

async function getDiscrepancies(config: typeof DEFAULT_VPS_CONFIG): Promise<{
  localOnly: Discrepancy[];
  vpsOnly: Discrepancy[];
  total: { localOnly: number; vpsOnly: number };
}> {
  const [localScreenshots, localThumbnails, vpsScreenshots, vpsThumbnails] = await Promise.all([
    getLocalFiles('screenshots'),
    getLocalFiles('thumbnails'),
    getVpsFiles(config, 'screenshots'),
    getVpsFiles(config, 'thumbnails')
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

async function testVpsConnection(config: typeof DEFAULT_VPS_CONFIG): Promise<{ connected: boolean; error?: string; keyPath?: string }> {
  const keyPath = expandPath(config.sshKeyPath);

  // First check if the SSH key exists
  try {
    await fs.promises.access(keyPath, fs.constants.R_OK);
  } catch {
    return {
      connected: false,
      error: `SSH key not found or not readable at: ${keyPath}. Please ensure the key exists and has proper permissions.`,
      keyPath
    };
  }

  const sshOpts = buildSshOptions(config);
  const sshPrefix = `ssh ${sshOpts} ${config.user}@${config.host}`;
  try {
    await execAsync(`${sshPrefix} "echo connected"`, { timeout: 10000 });
    return { connected: true, keyPath };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Connection failed';
    // Provide more helpful error messages
    if (errorMsg.includes('Permission denied')) {
      return {
        connected: false,
        error: `SSH authentication failed. The key at ${keyPath} may not be authorized on the VPS. Run: ssh-copy-id -i ${keyPath} ${config.user}@${config.host}`,
        keyPath
      };
    }
    if (errorMsg.includes('Connection refused') || errorMsg.includes('Connection timed out')) {
      return {
        connected: false,
        error: `Cannot reach VPS at ${config.host}. Check that the server is running and accessible.`,
        keyPath
      };
    }
    return { connected: false, error: errorMsg, keyPath };
  }
}

function startRsyncProcess(
  config: typeof DEFAULT_VPS_CONFIG,
  direction: 'push' | 'pull' | 'bidirectional',
  sessionId: string
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
    logs: [{ timestamp: new Date().toISOString(), message: `Starting ${direction} sync...` }]
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

      const localPath = path.join(process.cwd(), 'public', phase) + '/';
      const remotePath = `${config.user}@${config.host}:${config.remotePath}/${phase}/`;
      const keyPath = expandPath(config.sshKeyPath);
      const sshCmd = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}"`;

      let rsyncArgs: string[];
      if (direction === 'push') {
        rsyncArgs = ['-avz', '-e', sshCmd, '--progress', '--itemize-changes', localPath, remotePath];
      } else if (direction === 'pull') {
        rsyncArgs = ['-avz', '-e', sshCmd, '--progress', '--itemize-changes', remotePath, localPath];
      } else {
        // Bidirectional: pull first, then push
        rsyncArgs = ['-avzu', '-e', sshCmd, '--progress', '--itemize-changes', remotePath, localPath];
      }

      await new Promise<void>((resolve, reject) => {
        activeSyncProcess = spawn('rsync', rsyncArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

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
              message: `${phase} sync completed successfully`
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

      // For bidirectional, also push after pull
      if (direction === 'bidirectional' && !pauseRequested) {
        const pushArgs = ['-avzu', '-e', sshCmd, '--progress', '--itemize-changes', localPath, remotePath];
        await new Promise<void>((resolve, reject) => {
          activeSyncProcess = spawn('rsync', pushArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

          activeSyncProcess.stdout?.on('data', (data: Buffer) => {
            const text = data.toString();
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.trim()) {
                const fileMatch = line.match(/^[<>]f[+.].+\s+(.+)$/);
                if (fileMatch && syncProgress) {
                  syncProgress.currentFile = fileMatch[1];
                  syncProgress.transferredFiles++;
                }
              }
            }
          });

          activeSyncProcess.on('close', (code) => {
            if (code === 0 || (code === null && pauseRequested)) {
              resolve();
            } else {
              reject(new Error(`rsync push exited with code ${code}`));
            }
          });

          activeSyncProcess.on('error', reject);
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

  try {
    switch (action) {
      case 'status': {
        // Get current sync status
        return NextResponse.json({
          isActive: activeSyncProcess !== null,
          progress: syncProgress,
          defaultConfig: DEFAULT_VPS_CONFIG
        });
      }

      case 'test-connection': {
        const result = await testVpsConnection(config);
        return NextResponse.json(result);
      }

      case 'local-stats': {
        const stats = await getLocalStats();
        return NextResponse.json({ stats });
      }

      case 'vps-stats': {
        const stats = await getVpsStats(config);
        if (!stats) {
          return NextResponse.json({ error: 'Failed to connect to VPS' }, { status: 500 });
        }
        return NextResponse.json({ stats });
      }

      case 'compare': {
        const [localStats, vpsStats, discrepancies] = await Promise.all([
          getLocalStats(),
          getVpsStats(config),
          getDiscrepancies(config)
        ]);

        return NextResponse.json({
          local: localStats,
          vps: vpsStats,
          discrepancies,
          isInSync: discrepancies.total.localOnly === 0 && discrepancies.total.vpsOnly === 0
        });
      }

      case 'discrepancies': {
        const discrepancies = await getDiscrepancies(config);
        return NextResponse.json(discrepancies);
      }

      default:
        // Default: return full status and stats
        const [localStats, vpsStats] = await Promise.all([
          getLocalStats(),
          getVpsStats(config)
        ]);

        return NextResponse.json({
          isActive: activeSyncProcess !== null,
          progress: syncProgress,
          local: localStats,
          vps: vpsStats,
          config: DEFAULT_VPS_CONFIG
        });
    }
  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

        // Test connection first
        const connectionTest = await testVpsConnection(config);
        if (!connectionTest.connected) {
          return NextResponse.json(
            { error: `Cannot connect to VPS: ${connectionTest.error}` },
            { status: 400 }
          );
        }

        const sessionId = `sync_${Date.now()}`;
        syncSessionId = sessionId;
        startRsyncProcess(config, direction, sessionId);

        return NextResponse.json({
          message: 'Sync started',
          sessionId,
          direction
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
        activeSyncProcess.kill('SIGTERM');

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

        activeSyncProcess.kill('SIGKILL');
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

      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Sync API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process request' },
      { status: 500 }
    );
  }
}
