/**
 * Cross-platform utilities for VPS sync functionality
 * Supports both Windows and macOS/Linux
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface PlatformInfo {
  os: 'windows' | 'macos' | 'linux';
  isWindows: boolean;
  hasRsync: boolean;
  hasSsh: boolean;
  sshPath: string | null;
  rsyncPath: string | null;
  rsyncSshPath: string | null;  // SSH bundled with rsync (for cwRsync)
  isCwRsync: boolean;  // Whether rsync is cwRsync (needs special path handling)
  shell: string;
  homedir: string;
  pathSeparator: string;
}

// Cache platform info to avoid repeated detection
let cachedPlatformInfo: PlatformInfo | null = null;

/**
 * Detect the current platform and available tools
 */
export async function detectPlatform(): Promise<PlatformInfo> {
  if (cachedPlatformInfo) {
    return cachedPlatformInfo;
  }

  const platform = os.platform();
  const isWindows = platform === 'win32';
  const isMacOS = platform === 'darwin';

  let sshPath: string | null = null;
  let rsyncPath: string | null = null;
  let rsyncSshPath: string | null = null;
  let isCwRsync = false;
  let hasRsync = false;
  let hasSsh = false;

  if (isWindows) {
    // Check for SSH (Windows 10+ has built-in OpenSSH)
    sshPath = await findWindowsCommand('ssh');
    hasSsh = sshPath !== null;

    // Check for rsync - could be from Git Bash, WSL, cwRsync, etc.
    const rsyncInfo = await findWindowsRsync();
    if (rsyncInfo) {
      rsyncPath = rsyncInfo.path;
      rsyncSshPath = rsyncInfo.sshPath;
      isCwRsync = rsyncInfo.isCwRsync;
      hasRsync = true;
    }
  } else {
    // macOS/Linux - standard paths
    try {
      await execAsync('which ssh');
      sshPath = 'ssh';
      hasSsh = true;
    } catch {
      hasSsh = false;
    }

    try {
      await execAsync('which rsync');
      rsyncPath = 'rsync';
      hasRsync = true;
    } catch {
      hasRsync = false;
    }
  }

  cachedPlatformInfo = {
    os: isWindows ? 'windows' : isMacOS ? 'macos' : 'linux',
    isWindows,
    hasRsync,
    hasSsh,
    sshPath,
    rsyncPath,
    rsyncSshPath,
    isCwRsync,
    shell: isWindows ? 'cmd.exe' : '/bin/bash',
    homedir: os.homedir(),
    pathSeparator: path.sep
  };

  return cachedPlatformInfo;
}

/**
 * Find a command on Windows by checking common locations
 */
async function findWindowsCommand(cmd: string): Promise<string | null> {
  // First try the system path
  try {
    const result = await execAsync(`where ${cmd}`, { timeout: 5000 });
    const paths = result.stdout.trim().split('\n');
    if (paths.length > 0 && paths[0]) {
      return paths[0].trim();
    }
  } catch {
    // Command not found in PATH
  }

  // Check Windows built-in OpenSSH location
  const windowsSshPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', `${cmd}.exe`);
  if (fs.existsSync(windowsSshPath)) {
    return windowsSshPath;
  }

  return null;
}

interface RsyncInfo {
  path: string;
  sshPath: string | null;
  isCwRsync: boolean;
}

/**
 * Find rsync on Windows - check multiple possible locations
 */
async function findWindowsRsync(): Promise<RsyncInfo | null> {
  // Check system PATH first
  try {
    const result = await execAsync('where rsync', { timeout: 5000 });
    const paths = result.stdout.trim().split('\n');
    if (paths.length > 0 && paths[0]) {
      const rsyncPath = paths[0].trim();
      // Check if it's cwRsync by looking for bundled SSH
      const rsyncDir = path.dirname(rsyncPath);
      const bundledSsh = path.join(rsyncDir, 'ssh.exe');
      if (fs.existsSync(bundledSsh)) {
        return { path: rsyncPath, sshPath: bundledSsh, isCwRsync: true };
      }
      return { path: rsyncPath, sshPath: null, isCwRsync: false };
    }
  } catch {
    // Not in PATH
  }

  // Common rsync installation locations on Windows
  const homedir = os.homedir();
  const possiblePaths = [
    // Scoop cwRsync (preferred - has bundled SSH)
    {
      rsync: path.join(homedir, 'scoop', 'apps', 'cwrsync', 'current', 'bin', 'rsync.exe'),
      ssh: path.join(homedir, 'scoop', 'apps', 'cwrsync', 'current', 'bin', 'ssh.exe'),
      isCwRsync: true
    },
    // Scoop shim (just points to cwrsync)
    {
      rsync: path.join(homedir, 'scoop', 'shims', 'rsync.exe'),
      ssh: path.join(homedir, 'scoop', 'apps', 'cwrsync', 'current', 'bin', 'ssh.exe'),
      isCwRsync: true
    },
    // cwRsync (system install)
    {
      rsync: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cwRsync', 'bin', 'rsync.exe'),
      ssh: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cwRsync', 'bin', 'ssh.exe'),
      isCwRsync: true
    },
    // Git for Windows (Git Bash) - uses system SSH
    {
      rsync: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'rsync.exe'),
      ssh: null,
      isCwRsync: false
    },
    {
      rsync: path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'usr', 'bin', 'rsync.exe'),
      ssh: null,
      isCwRsync: false
    },
    // MSYS2
    {
      rsync: 'C:\\msys64\\usr\\bin\\rsync.exe',
      ssh: 'C:\\msys64\\usr\\bin\\ssh.exe',
      isCwRsync: false
    },
    // Cygwin
    {
      rsync: 'C:\\cygwin64\\bin\\rsync.exe',
      ssh: 'C:\\cygwin64\\bin\\ssh.exe',
      isCwRsync: false
    },
    {
      rsync: 'C:\\cygwin\\bin\\rsync.exe',
      ssh: 'C:\\cygwin\\bin\\ssh.exe',
      isCwRsync: false
    },
  ];

  for (const entry of possiblePaths) {
    if (fs.existsSync(entry.rsync)) {
      const sshPath = entry.ssh && fs.existsSync(entry.ssh) ? entry.ssh : null;
      return { path: entry.rsync, sshPath, isCwRsync: entry.isCwRsync };
    }
  }

  return null;
}

/**
 * Expand ~ to home directory (cross-platform)
 */
export function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Convert path for use with rsync on Windows (needs forward slashes)
 */
export function toRsyncPath(localPath: string, platform: PlatformInfo): string {
  if (!platform.isWindows) {
    return localPath;
  }

  // rsync on Windows needs forward slashes
  let rsyncPath = localPath.replace(/\\/g, '/');

  // Convert C:/ to appropriate format based on rsync type
  const driveMatch = rsyncPath.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    if (platform.isCwRsync) {
      // cwRsync uses /cygdrive/c/ style paths
      rsyncPath = `/cygdrive/${driveMatch[1].toLowerCase()}${rsyncPath.slice(2)}`;
    } else {
      // Git Bash/MSYS2 uses /c/ style paths
      rsyncPath = `/${driveMatch[1].toLowerCase()}${rsyncPath.slice(2)}`;
    }
  }

  return rsyncPath;
}

/**
 * Convert path for use with cwRsync's SSH (needs /cygdrive/c/ style)
 */
export function toCwRsyncSshPath(localPath: string): string {
  let rsyncPath = localPath.replace(/\\/g, '/');

  const driveMatch = rsyncPath.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    rsyncPath = `/cygdrive/${driveMatch[1].toLowerCase()}${rsyncPath.slice(2)}`;
  }

  return rsyncPath;
}

/**
 * Get the SSH command with proper options (cross-platform)
 */
export function buildSshCommand(
  config: { user: string; host: string; sshKeyPath: string },
  platform: PlatformInfo
): string {
  const keyPath = expandPath(config.sshKeyPath);
  const sshCmd = platform.sshPath || 'ssh';

  // Use proper quoting based on platform
  if (platform.isWindows) {
    // Windows needs different escaping
    return `"${sshCmd}" -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}"`;
  }

  return `${sshCmd} -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}"`;
}

/**
 * Build rsync command arguments (cross-platform)
 */
export function buildRsyncArgs(
  config: { user: string; host: string; sshKeyPath: string; remotePath: string },
  localPath: string,
  direction: 'push' | 'pull',
  platform: PlatformInfo,
  options: { update?: boolean } = {}
): { command: string; args: string[] } {
  const keyPath = expandPath(config.sshKeyPath);
  const remotePath = `${config.user}@${config.host}:${config.remotePath}`;

  // Convert local path for rsync on Windows
  const rsyncLocalPath = toRsyncPath(localPath, platform);
  const rsyncCmd = platform.rsyncPath || 'rsync';

  // Build SSH command for rsync to use
  let sshCmd: string;
  if (platform.isWindows && platform.isCwRsync && platform.rsyncSshPath) {
    // cwRsync needs its bundled SSH with /cygdrive/ style paths
    const cwRsyncKeyPath = toCwRsyncSshPath(keyPath);
    const cwRsyncSshPath = toCwRsyncSshPath(platform.rsyncSshPath);
    sshCmd = `${cwRsyncSshPath} -o StrictHostKeyChecking=no -o BatchMode=yes -i ${cwRsyncKeyPath}`;
  } else if (platform.isWindows) {
    // Non-cwRsync on Windows (Git Bash, etc.)
    sshCmd = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath.replace(/\\/g, '/')}"`;
  } else {
    // macOS/Linux
    sshCmd = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}"`;
  }

  const baseArgs = options.update
    ? ['-avzu', '-e', sshCmd, '--progress', '--itemize-changes']
    : ['-avz', '-e', sshCmd, '--progress', '--itemize-changes'];

  const source = direction === 'push' ? rsyncLocalPath : remotePath;
  const dest = direction === 'push' ? remotePath : rsyncLocalPath;

  return {
    command: rsyncCmd,
    args: [...baseArgs, source, dest]
  };
}

/**
 * Execute SSH command on the VPS (cross-platform)
 */
export async function execSshCommand(
  config: { user: string; host: string; sshKeyPath: string },
  remoteCommand: string,
  platform: PlatformInfo,
  timeout: number = 30000
): Promise<{ stdout: string; stderr: string }> {
  const keyPath = expandPath(config.sshKeyPath);
  const sshCmd = platform.sshPath || 'ssh';

  let fullCommand: string;

  if (platform.isWindows) {
    // On Windows, we need careful quoting
    // The remote command uses Unix commands, so we escape for Windows shell
    const escapedRemoteCmd = remoteCommand.replace(/"/g, '\\"');
    fullCommand = `"${sshCmd}" -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}" ${config.user}@${config.host} "${escapedRemoteCmd}"`;
  } else {
    fullCommand = `${sshCmd} -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o BatchMode=yes -i "${keyPath}" ${config.user}@${config.host} "${remoteCommand}"`;
  }

  return execAsync(fullCommand, {
    timeout,
    shell: platform.isWindows ? 'cmd.exe' : '/bin/bash'
  });
}

/**
 * Get Windows-specific SSH key path suggestions
 */
export function getWindowsSshKeyPaths(): string[] {
  const homedir = os.homedir();
  return [
    path.join(homedir, '.ssh', 'id_ed25519'),
    path.join(homedir, '.ssh', 'id_rsa'),
    path.join(homedir, '.ssh', 'id_ecdsa'),
  ];
}

/**
 * Check if SSH key exists and is readable
 */
export async function checkSshKey(keyPath: string): Promise<{ exists: boolean; readable: boolean; path: string }> {
  const expandedPath = expandPath(keyPath);

  try {
    await fs.promises.access(expandedPath, fs.constants.R_OK);
    return { exists: true, readable: true, path: expandedPath };
  } catch {
    try {
      await fs.promises.access(expandedPath, fs.constants.F_OK);
      return { exists: true, readable: false, path: expandedPath };
    } catch {
      return { exists: false, readable: false, path: expandedPath };
    }
  }
}

/**
 * Generate platform-specific setup instructions
 */
export function getSetupInstructions(platform: PlatformInfo, config: { user: string; host: string; sshKeyPath: string }): {
  sshSetup: string[];
  rsyncSetup: string[];
} {
  const keyPath = expandPath(config.sshKeyPath);

  if (platform.isWindows) {
    return {
      sshSetup: [
        '# 1. Open PowerShell as Administrator and run:',
        'Get-WindowsCapability -Online | Where-Object Name -like "OpenSSH*"',
        '',
        '# 2. If OpenSSH Client is not installed, install it:',
        'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0',
        '',
        '# 3. Generate SSH key (in regular PowerShell):',
        `ssh-keygen -t ed25519 -C "webflow-gallery" -f "${keyPath}"`,
        '',
        '# 4. Copy your public key to the VPS:',
        `type "${keyPath}.pub" | ssh ${config.user}@${config.host} "cat >> ~/.ssh/authorized_keys"`,
        '',
        '# 5. Test the connection:',
        `ssh -i "${keyPath}" ${config.user}@${config.host} "echo connected"`,
      ],
      rsyncSetup: platform.hasRsync ? [] : [
        '# rsync is not installed. You have several options:',
        '',
        '# Option 1: Install Git for Windows (Recommended)',
        '# Download from: https://git-scm.com/download/win',
        '# During install, select "Add rsync to PATH"',
        '',
        '# Option 2: Install cwRsync',
        '# Download from: https://www.itefix.net/cwrsync',
        '',
        '# Option 3: Use WSL (Windows Subsystem for Linux)',
        '# Install WSL, then run: sudo apt install rsync',
        '',
        '# After installing, restart this application.',
      ],
    };
  }

  return {
    sshSetup: [
      '# 1. Generate SSH key (if you don\'t have one)',
      `ssh-keygen -t ed25519 -C "webflow-gallery"`,
      '',
      '# 2. Copy your public key to the VPS',
      `ssh-copy-id -i ${keyPath}.pub ${config.user}@${config.host}`,
      '',
      '# 3. Test the connection',
      `ssh -i ${keyPath} ${config.user}@${config.host} "echo connected"`,
    ],
    rsyncSetup: platform.hasRsync ? [] : [
      '# Install rsync:',
      '# macOS: brew install rsync',
      '# Ubuntu/Debian: sudo apt install rsync',
      '# RHEL/CentOS: sudo yum install rsync',
    ],
  };
}

/**
 * Clear the cached platform info (useful for testing or after tool installation)
 */
export function clearPlatformCache(): void {
  cachedPlatformInfo = null;
}
