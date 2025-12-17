'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import {
  Cloud,
  HardDrive,
  ArrowUpToLine,
  ArrowDownToLine,
  RefreshCcw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Server,
  Laptop,
  ArrowRightLeft,
  Pause,
  Square,
  Play,
  Wifi,
  WifiOff,
  FolderSync,
  ImageIcon,
  Info,
  Settings2,
  Terminal,
  Monitor,
  Apple,
  Folder,
  ExternalLink,
  Trash2,
  Database,
  Search,
  FileX2
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface VpsConfig {
  user: string;
  host: string;
  remotePath: string;
  sshKeyPath: string;
}

interface PlatformInfo {
  os: 'windows' | 'macos' | 'linux';
  isWindows: boolean;
  hasRsync: boolean;
  hasSsh: boolean;
  sshPath: string | null;
  rsyncPath: string | null;
  shell: string;
  homedir: string;
  pathSeparator: string;
}

interface SetupInstructions {
  sshSetup: string[];
  rsyncSetup: string[];
}

interface ExcessFile {
  filename: string;
  type: 'screenshot' | 'thumbnail';
  path: string;
}

interface ExcessAnalysis {
  excessFiles: ExcessFile[];
  totalExcessCount: number;
  excessScreenshots: number;
  excessThumbnails: number;
  validInDb: { screenshots: number; thumbnails: number };
  totalOnVps: { screenshots: number; thumbnails: number };
  estimatedSizeBytes: number;
  message: string;
}

interface DeleteProgress {
  status: 'running' | 'completed' | 'error';
  totalFiles: number;
  deletedFiles: number;
  failedFiles: number;
  currentFile: string;
  logs: Array<{ timestamp: string; message: string; type: 'info' | 'success' | 'error' }>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

interface ExpandableAccordionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

function ExpandableAccordion({ title, icon, defaultOpen = false, children, badge }: ExpandableAccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <span className="font-medium">{title}</span>
          {badge}
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-gray-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-500" />
        )}
      </button>
      {isOpen && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}

function PlatformBadge({ platform }: { platform: PlatformInfo | null }) {
  if (!platform) return null;

  const getOsIcon = () => {
    switch (platform.os) {
      case 'windows':
        return <Monitor className="h-3 w-3" />;
      case 'macos':
        return <Apple className="h-3 w-3" />;
      default:
        return <Terminal className="h-3 w-3" />;
    }
  };

  const getOsLabel = () => {
    switch (platform.os) {
      case 'windows':
        return 'Windows';
      case 'macos':
        return 'macOS';
      default:
        return 'Linux';
    }
  };

  return (
    <Badge variant="outline" className="gap-1.5 text-xs">
      {getOsIcon()}
      {getOsLabel()}
    </Badge>
  );
}

function ToolStatusBadge({ available, name }: { available: boolean; name: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 text-xs",
        available ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"
      )}
    >
      {available ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {name}
    </Badge>
  );
}

function VpsDirectoryIndicator({ config }: { config: VpsConfig }) {
  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-green-100 rounded-lg">
          <Folder className="h-5 w-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-green-900 mb-1">VPS Target Directory</h4>
          <p className="text-sm text-green-700 mb-2">Images will sync to/from this location on the VPS:</p>
          <div className="space-y-1">
            <code className="block text-xs bg-white/80 text-green-800 px-3 py-2 rounded border border-green-200 font-mono">
              {config.user}@{config.host}:{config.remotePath}
            </code>
            <div className="flex gap-4 text-xs text-green-600 mt-2">
              <span className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                Screenshots: {config.remotePath}/screenshots/
              </span>
              <span className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                Thumbnails: {config.remotePath}/thumbnails/
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StorageComparisonDiagram({ local, vps, config }: { local: StorageStats | null; vps: StorageStats | null; config: VpsConfig }) {
  const maxCount = Math.max(
    local?.total.count || 0,
    vps?.total.count || 0,
    1
  );

  const localPercent = ((local?.total.count || 0) / maxCount) * 100;
  const vpsPercent = ((vps?.total.count || 0) / maxCount) * 100;

  return (
    <div className="space-y-6">
      {/* VPS Directory Indicator */}
      <VpsDirectoryIndicator config={config} />

      {/* Visual comparison */}
      <div className="grid grid-cols-2 gap-8">
        {/* Local */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 mb-3">
            <Laptop className="h-10 w-10 text-blue-600" />
          </div>
          <h4 className="font-semibold text-gray-900">Local Machine</h4>
          <p className="text-2xl font-bold text-blue-600">{local?.total.count || 0}</p>
          <p className="text-sm text-gray-500">files</p>
          <p className="text-xs text-gray-400 mt-1">{local?.total.sizeFormatted || '0 B'}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">public/screenshots/</p>
        </div>

        {/* VPS */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-3">
            <Server className="h-10 w-10 text-green-600" />
          </div>
          <h4 className="font-semibold text-gray-900">VPS Server</h4>
          <p className="text-2xl font-bold text-green-600">{vps?.total.count || 0}</p>
          <p className="text-sm text-gray-500">files</p>
          <p className="text-xs text-gray-400 mt-1">{vps?.total.sizeFormatted || '0 B'}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">{config.remotePath}/</p>
        </div>
      </div>

      {/* Bar comparison */}
      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Local</span>
            <span className="text-gray-500">{local?.total.count || 0} files</span>
          </div>
          <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-500"
              style={{ width: `${localPercent}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">VPS</span>
            <span className="text-gray-500">{vps?.total.count || 0} files</span>
          </div>
          <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-500"
              style={{ width: `${vpsPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="bg-gray-50 rounded-lg p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="text-left font-medium py-2">Type</th>
              <th className="text-right font-medium py-2">Local</th>
              <th className="text-right font-medium py-2">VPS</th>
              <th className="text-right font-medium py-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-gray-200">
              <td className="py-2 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-gray-400" />
                Screenshots
              </td>
              <td className="text-right py-2 text-blue-600">{local?.screenshots.count || 0}</td>
              <td className="text-right py-2 text-green-600">{vps?.screenshots.count || 0}</td>
              <td className="text-right py-2">
                <span className={cn(
                  "font-medium",
                  (local?.screenshots.count || 0) - (vps?.screenshots.count || 0) > 0
                    ? "text-amber-600"
                    : (local?.screenshots.count || 0) - (vps?.screenshots.count || 0) < 0
                      ? "text-red-600"
                      : "text-gray-400"
                )}>
                  {(local?.screenshots.count || 0) - (vps?.screenshots.count || 0)}
                </span>
              </td>
            </tr>
            <tr className="border-t border-gray-200">
              <td className="py-2 flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-gray-400" />
                Thumbnails
              </td>
              <td className="text-right py-2 text-blue-600">{local?.thumbnails.count || 0}</td>
              <td className="text-right py-2 text-green-600">{vps?.thumbnails.count || 0}</td>
              <td className="text-right py-2">
                <span className={cn(
                  "font-medium",
                  (local?.thumbnails.count || 0) - (vps?.thumbnails.count || 0) > 0
                    ? "text-amber-600"
                    : (local?.thumbnails.count || 0) - (vps?.thumbnails.count || 0) < 0
                      ? "text-red-600"
                      : "text-gray-400"
                )}>
                  {(local?.thumbnails.count || 0) - (vps?.thumbnails.count || 0)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SyncFlowDiagram({ direction, config }: { direction: 'push' | 'pull' | 'bidirectional'; config: VpsConfig }) {
  return (
    <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6">
      <div className="flex items-center justify-center gap-4">
        {/* Local */}
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-xl bg-blue-100 flex items-center justify-center mb-2 shadow-sm">
            <Laptop className="h-8 w-8 text-blue-600" />
          </div>
          <span className="text-sm font-medium text-gray-700">Local</span>
          <span className="text-xs text-gray-500">public/</span>
        </div>

        {/* Arrow */}
        <div className="flex flex-col items-center px-4">
          {direction === 'push' && (
            <>
              <ArrowUpToLine className="h-8 w-8 text-blue-500 animate-bounce" />
              <span className="text-xs text-blue-600 font-medium mt-1">Push</span>
            </>
          )}
          {direction === 'pull' && (
            <>
              <ArrowDownToLine className="h-8 w-8 text-green-500 animate-bounce" />
              <span className="text-xs text-green-600 font-medium mt-1">Pull</span>
            </>
          )}
          {direction === 'bidirectional' && (
            <>
              <ArrowRightLeft className="h-8 w-8 text-purple-500 animate-pulse" />
              <span className="text-xs text-purple-600 font-medium mt-1">Sync</span>
            </>
          )}
        </div>

        {/* VPS */}
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-xl bg-green-100 flex items-center justify-center mb-2 shadow-sm">
            <Cloud className="h-8 w-8 text-green-600" />
          </div>
          <span className="text-sm font-medium text-gray-700">VPS</span>
          <span className="text-xs text-gray-500 font-mono">{config.remotePath.split('/').pop()}/</span>
        </div>
      </div>

      <div className="mt-4 text-center text-sm text-gray-600">
        {direction === 'push' && 'Uploads local images to VPS server'}
        {direction === 'pull' && 'Downloads VPS images to local machine'}
        {direction === 'bidirectional' && 'Syncs both directions - newest files win'}
      </div>

      {/* Target path indicator */}
      <div className="mt-4 text-center">
        <code className="text-xs bg-white px-3 py-1.5 rounded border text-gray-600">
          {config.user}@{config.host}:{config.remotePath}
        </code>
      </div>
    </div>
  );
}

function WindowsSetupGuide({ platform, setupInstructions }: {
  platform: PlatformInfo;
  setupInstructions: SetupInstructions | null;
}) {
  if (!platform.isWindows) return null;

  return (
    <div className="space-y-4">
      {/* Platform Tools Status */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-medium text-blue-900 mb-3 flex items-center gap-2">
          <Monitor className="h-4 w-4" />
          Windows System Status
        </h4>
        <div className="flex flex-wrap gap-2 mb-3">
          <ToolStatusBadge available={platform.hasSsh} name="SSH" />
          <ToolStatusBadge available={platform.hasRsync} name="rsync" />
        </div>
        {platform.sshPath && (
          <p className="text-xs text-blue-700 mb-1">
            SSH path: <code className="bg-blue-100 px-1 rounded">{platform.sshPath}</code>
          </p>
        )}
        {platform.rsyncPath && (
          <p className="text-xs text-blue-700">
            rsync path: <code className="bg-blue-100 px-1 rounded">{platform.rsyncPath}</code>
          </p>
        )}
      </div>

      {/* rsync Installation Guide (if missing) */}
      {!platform.hasRsync && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h4 className="font-medium text-amber-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            rsync Not Found - Installation Required
          </h4>
          <div className="space-y-3 text-sm text-amber-800">
            <p>rsync is required for syncing images. Choose one of these options:</p>

            <div className="bg-white rounded-lg p-3 border border-amber-200">
              <h5 className="font-medium mb-2">Option 1: Install Git for Windows (Recommended)</h5>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Download from <a href="https://git-scm.com/download/win" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">git-scm.com <ExternalLink className="h-3 w-3" /></a></li>
                <li>During installation, ensure &quot;Git Bash&quot; is selected</li>
                <li>Restart this application after installation</li>
              </ol>
            </div>

            <div className="bg-white rounded-lg p-3 border border-amber-200">
              <h5 className="font-medium mb-2">Option 2: Install cwRsync</h5>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li>Download from <a href="https://www.itefix.net/cwrsync" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">itefix.net/cwrsync <ExternalLink className="h-3 w-3" /></a></li>
                <li>Install and add to system PATH</li>
                <li>Restart this application</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* SSH Setup Guide */}
      {setupInstructions && setupInstructions.sshSetup.length > 0 && (
        <div className="bg-white rounded-lg p-4 border">
          <h5 className="font-medium text-gray-800 mb-3">Windows SSH Setup Guide</h5>
          <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs overflow-x-auto">
            {setupInstructions.sshSetup.map((line, i) => (
              <div key={i} className={cn(
                line.startsWith('#') ? 'text-gray-400' : 'text-green-400',
                !line && 'h-2'
              )}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MacLinuxSetupGuide({ platform, config }: {
  platform: PlatformInfo;
  config: VpsConfig;
}) {
  if (platform.isWindows) return null;

  return (
    <div className="bg-white rounded-lg p-4 border">
      <h5 className="font-medium text-gray-800 mb-3">SSH Setup Guide ({platform.os === 'macos' ? 'macOS' : 'Linux'})</h5>
      <div className="space-y-3 text-sm">
        <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs">
          <div className="text-gray-400"># 1. Generate SSH key (if you don&apos;t have one)</div>
          <div className="text-green-400">ssh-keygen -t ed25519 -C &quot;webflow-gallery&quot;</div>
          <div className="text-gray-500 mt-2"># Press Enter to accept default location (~/.ssh/id_ed25519)</div>
        </div>
        <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs">
          <div className="text-gray-400"># 2. Copy your public key to the VPS</div>
          <div className="text-green-400">ssh-copy-id -i ~/.ssh/id_ed25519.pub {config.user}@{config.host}</div>
          <div className="text-gray-500 mt-2"># Enter VPS password when prompted</div>
        </div>
        <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs">
          <div className="text-gray-400"># 3. Test the connection</div>
          <div className="text-green-400">ssh -i ~/.ssh/id_ed25519 {config.user}@{config.host} &quot;echo connected&quot;</div>
        </div>
      </div>
    </div>
  );
}

export function SyncSection() {
  const { resolveAuthToken } = useAdmin();

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [localStats, setLocalStats] = useState<StorageStats | null>(null);
  const [vpsStats, setVpsStats] = useState<StorageStats | null>(null);
  const [discrepancies, setDiscrepancies] = useState<{
    localOnly: Discrepancy[];
    vpsOnly: Discrepancy[];
    total: { localOnly: number; vpsOnly: number };
  } | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [selectedDirection, setSelectedDirection] = useState<'push' | 'pull' | 'bidirectional'>('push');
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [setupInstructions, setSetupInstructions] = useState<SetupInstructions | null>(null);

  // Excess files state
  const [excessAnalysis, setExcessAnalysis] = useState<ExcessAnalysis | null>(null);
  const [isAnalyzingExcess, setIsAnalyzingExcess] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);

  // VPS Config
  const [vpsConfig, setVpsConfig] = useState<VpsConfig>({
    user: 'root',
    host: '178.156.177.252',
    remotePath: '/data/webflow-gallery',
    sshKeyPath: '~/.ssh/id_ed25519'
  });
  const [showConfig, setShowConfig] = useState(false);

  // Polling ref
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const authHeaders = useCallback(() => ({
    'Authorization': `Bearer ${resolveAuthToken()}`,
    'Content-Type': 'application/json'
  }), [resolveAuthToken]);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        action: 'compare',
        vpsUser: vpsConfig.user,
        vpsHost: vpsConfig.host,
        vpsPath: vpsConfig.remotePath,
        sshKey: vpsConfig.sshKeyPath
      });

      const response = await fetch(`/api/admin/sync?${params}`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) throw new Error('Failed to load sync data');

      const data = await response.json();
      setLocalStats(data.local);
      setVpsStats(data.vps);
      setDiscrepancies(data.discrepancies);
      setConnectionStatus(data.vps ? 'connected' : 'disconnected');
      if (data.platform) {
        setPlatform(data.platform);
      }
    } catch (error) {
      console.error('Failed to load sync data:', error);
      setConnectionStatus('disconnected');
    } finally {
      setIsLoading(false);
    }
  }, [resolveAuthToken, vpsConfig]);

  // Test VPS connection
  const testConnection = useCallback(async () => {
    setConnectionStatus('unknown');
    setConnectionError(null);
    try {
      const params = new URLSearchParams({
        action: 'test-connection',
        vpsUser: vpsConfig.user,
        vpsHost: vpsConfig.host,
        vpsPath: vpsConfig.remotePath,
        sshKey: vpsConfig.sshKeyPath
      });

      const response = await fetch(`/api/admin/sync?${params}`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      const data = await response.json();
      setConnectionStatus(data.connected ? 'connected' : 'disconnected');
      setConnectionError(data.error || null);
      if (data.platform) {
        setPlatform(data.platform);
      }
      if (data.setupInstructions) {
        setSetupInstructions(data.setupInstructions);
      }

      if (data.connected) {
        toast.success('VPS connection successful');
        loadData();
      } else {
        toast.error(`VPS connection failed`);
      }
    } catch (error) {
      setConnectionStatus('disconnected');
      setConnectionError('Failed to test connection');
      toast.error('Failed to test connection');
    }
  }, [resolveAuthToken, vpsConfig, loadData]);

  // Refresh platform detection
  const refreshPlatform = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'refresh-platform' })
      });

      const data = await response.json();
      if (data.platform) {
        setPlatform(data.platform);
        toast.success('Platform detection refreshed');
      }
    } catch (error) {
      toast.error('Failed to refresh platform detection');
    }
  }, [authHeaders]);

  // Check sync status
  const checkSyncStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync?action=status', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) return;

      const data = await response.json();
      setSyncProgress(data.progress);
      if (data.platform) {
        setPlatform(data.platform);
      }

      // Stop polling if sync is complete
      if (data.progress && ['completed', 'error', 'cancelled'].includes(data.progress.status)) {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        // Reload stats after sync completes
        loadData();
      }
    } catch (error) {
      console.error('Failed to check sync status:', error);
    }
  }, [resolveAuthToken, loadData]);

  // Start sync
  const startSync = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'start',
          direction: selectedDirection,
          config: vpsConfig
        })
      });

      if (!response.ok) {
        const data = await response.json();
        if (data.setupInstructions) {
          setSetupInstructions(data.setupInstructions);
        }
        throw new Error(data.error || 'Failed to start sync');
      }

      const data = await response.json();
      toast.success(`Sync started: ${selectedDirection}`);

      // Start polling for progress
      pollIntervalRef.current = setInterval(checkSyncStatus, 1000);
      checkSyncStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start sync');
    }
  }, [authHeaders, selectedDirection, vpsConfig, checkSyncStatus]);

  // Pause sync
  const pauseSync = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'pause' })
      });

      if (!response.ok) throw new Error('Failed to pause sync');

      toast.info('Sync pause requested');
    } catch (error) {
      toast.error('Failed to pause sync');
    }
  }, [authHeaders]);

  // Stop sync
  const stopSync = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'stop' })
      });

      if (!response.ok) throw new Error('Failed to stop sync');

      toast.info('Sync stopped');
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    } catch (error) {
      toast.error('Failed to stop sync');
    }
  }, [authHeaders]);

  // Clear session
  const clearSession = useCallback(async () => {
    try {
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'clear' })
      });
      setSyncProgress(null);
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }, [authHeaders]);

  // Polling ref for delete progress
  const deletePollingRef = useRef<NodeJS.Timeout | null>(null);

  // Analyze excess files on VPS
  const analyzeExcessFiles = useCallback(async () => {
    setIsAnalyzingExcess(true);
    setExcessAnalysis(null);
    try {
      const params = new URLSearchParams({
        action: 'analyze-excess',
        vpsUser: vpsConfig.user,
        vpsHost: vpsConfig.host,
        vpsPath: vpsConfig.remotePath,
        sshKey: vpsConfig.sshKeyPath
      });

      const response = await fetch(`/api/admin/sync?${params}`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) throw new Error('Failed to analyze excess files');

      const data = await response.json();
      setExcessAnalysis(data);

      if (data.totalExcessCount > 0) {
        toast.warning(`Found ${data.totalExcessCount} excess files on VPS`);
      } else {
        toast.success('No excess files found - VPS is clean!');
      }
    } catch (error) {
      toast.error('Failed to analyze excess files');
      console.error('Failed to analyze excess files:', error);
    } finally {
      setIsAnalyzingExcess(false);
    }
  }, [resolveAuthToken, vpsConfig]);

  // Check delete progress
  const checkDeleteProgress = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        action: 'delete-excess-status',
        vpsUser: vpsConfig.user,
        vpsHost: vpsConfig.host,
        vpsPath: vpsConfig.remotePath,
        sshKey: vpsConfig.sshKeyPath
      });

      const response = await fetch(`/api/admin/sync?${params}`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) return;

      const data = await response.json();
      setDeleteProgress(data.progress);

      // Stop polling if delete is complete
      if (data.progress && ['completed', 'error'].includes(data.progress.status)) {
        if (deletePollingRef.current) {
          clearInterval(deletePollingRef.current);
          deletePollingRef.current = null;
        }
        // Reload stats and analysis after deletion
        loadData();
        analyzeExcessFiles();
      }
    } catch (error) {
      console.error('Failed to check delete progress:', error);
    }
  }, [resolveAuthToken, vpsConfig, loadData, analyzeExcessFiles]);

  // Start deletion of excess files
  const startDeleteExcess = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'delete-excess',
          config: vpsConfig
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start deletion');
      }

      toast.success(`Started deletion of ${data.totalFiles} excess files`);

      // Start polling for progress
      deletePollingRef.current = setInterval(checkDeleteProgress, 1000);
      checkDeleteProgress();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to start deletion');
    }
  }, [authHeaders, vpsConfig, checkDeleteProgress]);

  // Clear delete progress
  const clearDeleteProgress = useCallback(async () => {
    try {
      await fetch('/api/admin/sync', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'clear-delete-progress' })
      });
      setDeleteProgress(null);
      setExcessAnalysis(null);
    } catch (error) {
      console.error('Failed to clear delete progress:', error);
    }
  }, [authHeaders]);

  // Initial load
  useEffect(() => {
    loadData();
    checkSyncStatus();

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (deletePollingRef.current) {
        clearInterval(deletePollingRef.current);
      }
    };
  }, [loadData, checkSyncStatus]);

  const isInSync = discrepancies?.total.localOnly === 0 && discrepancies?.total.vpsOnly === 0;
  const hasDiscrepancies = (discrepancies?.total.localOnly || 0) + (discrepancies?.total.vpsOnly || 0) > 0;
  const isSyncing = syncProgress?.status === 'running';
  const canSync = platform?.hasRsync && platform?.hasSsh && connectionStatus === 'connected';

  return (
    <div className="space-y-6">
      {/* Header with Connection Status */}
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl">
              <FolderSync className="h-7 w-7 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">VPS Image Sync</h2>
              <p className="text-sm text-gray-500">Manage image synchronization between local and VPS</p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Platform Badge */}
            <PlatformBadge platform={platform} />

            {/* Tool Status Badges */}
            {platform && (
              <>
                <ToolStatusBadge available={platform.hasSsh} name="SSH" />
                <ToolStatusBadge available={platform.hasRsync} name="rsync" />
              </>
            )}

            {/* Connection Status */}
            <div className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
              connectionStatus === 'connected' && "bg-green-100 text-green-700",
              connectionStatus === 'disconnected' && "bg-red-100 text-red-700",
              connectionStatus === 'unknown' && "bg-gray-100 text-gray-600"
            )}>
              {connectionStatus === 'connected' && <Wifi className="h-4 w-4" />}
              {connectionStatus === 'disconnected' && <WifiOff className="h-4 w-4" />}
              {connectionStatus === 'unknown' && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>
                {connectionStatus === 'connected' && 'Connected'}
                {connectionStatus === 'disconnected' && 'Disconnected'}
                {connectionStatus === 'unknown' && 'Checking...'}
              </span>
            </div>

            {/* Sync Status Badge */}
            {isInSync && (
              <Badge className="bg-green-100 text-green-700 gap-1">
                <CheckCircle2 className="h-3 w-3" />
                In Sync
              </Badge>
            )}
            {hasDiscrepancies && !isSyncing && (
              <Badge className="bg-amber-100 text-amber-700 gap-1">
                <AlertTriangle className="h-3 w-3" />
                {(discrepancies?.total.localOnly || 0) + (discrepancies?.total.vpsOnly || 0)} differences
              </Badge>
            )}

            <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
              <RefreshCcw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
              Refresh
            </Button>

            <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)}>
              <Settings2 className="h-4 w-4 mr-2" />
              Config
            </Button>
          </div>
        </div>

        {/* VPS Configuration */}
        {showConfig && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg border">
            <h4 className="font-medium mb-4 flex items-center gap-2">
              <Server className="h-4 w-4" />
              VPS Configuration
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="vps-user">SSH User</Label>
                <Input
                  id="vps-user"
                  value={vpsConfig.user}
                  onChange={(e) => setVpsConfig(c => ({ ...c, user: e.target.value }))}
                  placeholder="root"
                />
              </div>
              <div>
                <Label htmlFor="vps-host">VPS Host / IP</Label>
                <Input
                  id="vps-host"
                  value={vpsConfig.host}
                  onChange={(e) => setVpsConfig(c => ({ ...c, host: e.target.value }))}
                  placeholder="178.156.177.252"
                />
              </div>
              <div>
                <Label htmlFor="vps-path">Remote Path</Label>
                <Input
                  id="vps-path"
                  value={vpsConfig.remotePath}
                  onChange={(e) => setVpsConfig(c => ({ ...c, remotePath: e.target.value }))}
                  placeholder="/data/webflow-gallery"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Screenshots: {vpsConfig.remotePath}/screenshots/<br />
                  Thumbnails: {vpsConfig.remotePath}/thumbnails/
                </p>
              </div>
              <div>
                <Label htmlFor="ssh-key">SSH Key Path</Label>
                <Input
                  id="ssh-key"
                  value={vpsConfig.sshKeyPath}
                  onChange={(e) => setVpsConfig(c => ({ ...c, sshKeyPath: e.target.value }))}
                  placeholder={platform?.isWindows ? 'C:\\Users\\....\\.ssh\\id_ed25519' : '~/.ssh/id_ed25519'}
                />
                {platform?.isWindows && (
                  <p className="text-xs text-gray-500 mt-1">
                    Windows: Use full path like C:\Users\YourName\.ssh\id_ed25519 or ~\.ssh\id_ed25519
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-between items-center mt-4">
              <Button variant="ghost" size="sm" onClick={refreshPlatform}>
                <RefreshCcw className="h-4 w-4 mr-2" />
                Re-detect Platform
              </Button>
              <Button onClick={testConnection} variant="outline" size="sm">
                Test Connection
              </Button>
            </div>
          </div>
        )}

        {/* Connection Error & Setup Guide */}
        {connectionStatus === 'disconnected' && connectionError && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <h4 className="font-medium text-red-800 mb-2 flex items-center gap-2">
              <WifiOff className="h-4 w-4" />
              Connection Failed
            </h4>
            <p className="text-sm text-red-700 mb-4">{connectionError}</p>

            {/* Platform-specific setup guide */}
            {platform?.isWindows ? (
              <WindowsSetupGuide platform={platform} setupInstructions={setupInstructions} />
            ) : platform ? (
              <MacLinuxSetupGuide platform={platform} config={vpsConfig} />
            ) : null}
          </div>
        )}

        {/* rsync missing warning when connected but no rsync */}
        {connectionStatus === 'connected' && platform && !platform.hasRsync && (
          <div className="mt-6">
            <WindowsSetupGuide platform={platform} setupInstructions={setupInstructions} />
          </div>
        )}
      </Card>

      {/* Storage Comparison */}
      <Card className="p-6">
        <ExpandableAccordion
          title="Storage Comparison"
          icon={<HardDrive className="h-5 w-5 text-blue-500" />}
          defaultOpen={true}
          badge={
            <Badge variant="outline" className="ml-2">
              {localStats?.total.count || 0} local / {vpsStats?.total.count || 0} VPS
            </Badge>
          }
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          ) : (
            <StorageComparisonDiagram local={localStats} vps={vpsStats} config={vpsConfig} />
          )}
        </ExpandableAccordion>
      </Card>

      {/* Discrepancies */}
      <Card className="p-6">
        <ExpandableAccordion
          title="File Discrepancies"
          icon={<AlertTriangle className={cn("h-5 w-5", hasDiscrepancies ? "text-amber-500" : "text-green-500")} />}
          defaultOpen={hasDiscrepancies}
          badge={
            hasDiscrepancies ? (
              <Badge className="bg-amber-100 text-amber-700 ml-2">
                {(discrepancies?.total.localOnly || 0) + (discrepancies?.total.vpsOnly || 0)} files
              </Badge>
            ) : (
              <Badge className="bg-green-100 text-green-700 ml-2">
                All synced
              </Badge>
            )
          }
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !hasDiscrepancies ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="text-gray-600">All files are in sync!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Local Only */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <h4 className="font-medium">Local Only</h4>
                  <Badge variant="secondary">{discrepancies?.total.localOnly || 0}</Badge>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  Files on your local machine that need to be pushed to VPS
                </p>
                {discrepancies && discrepancies.localOnly.length > 0 ? (
                  <ScrollArea className="h-40 border rounded-lg p-2">
                    {discrepancies.localOnly.slice(0, 50).map((d, i) => (
                      <div key={i} className="text-xs py-1 px-2 hover:bg-gray-50 rounded flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1">
                          {d.type === 'screenshot' ? 'SS' : 'TH'}
                        </Badge>
                        <span className="truncate">{d.filename}</span>
                      </div>
                    ))}
                    {discrepancies.localOnly.length > 50 && (
                      <div className="text-xs text-gray-400 text-center py-2">
                        +{discrepancies.localOnly.length - 50} more files
                      </div>
                    )}
                  </ScrollArea>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-sm border rounded-lg">
                    No local-only files
                  </div>
                )}
              </div>

              {/* VPS Only */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <h4 className="font-medium">VPS Only</h4>
                  <Badge variant="secondary">{discrepancies?.total.vpsOnly || 0}</Badge>
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  Files on VPS that need to be pulled to your local machine
                </p>
                {discrepancies && discrepancies.vpsOnly.length > 0 ? (
                  <ScrollArea className="h-40 border rounded-lg p-2">
                    {discrepancies.vpsOnly.slice(0, 50).map((d, i) => (
                      <div key={i} className="text-xs py-1 px-2 hover:bg-gray-50 rounded flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1">
                          {d.type === 'screenshot' ? 'SS' : 'TH'}
                        </Badge>
                        <span className="truncate">{d.filename}</span>
                      </div>
                    ))}
                    {discrepancies.vpsOnly.length > 50 && (
                      <div className="text-xs text-gray-400 text-center py-2">
                        +{discrepancies.vpsOnly.length - 50} more files
                      </div>
                    )}
                  </ScrollArea>
                ) : (
                  <div className="text-center py-4 text-gray-400 text-sm border rounded-lg">
                    No VPS-only files
                  </div>
                )}
              </div>
            </div>
          )}
        </ExpandableAccordion>
      </Card>

      {/* Sync Controls */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-purple-100 rounded-lg">
            <ArrowRightLeft className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Sync Operations</h3>
            <p className="text-sm text-gray-500">Start, pause, or stop image synchronization</p>
          </div>
        </div>

        {/* Missing Tools Warning */}
        {platform && (!platform.hasRsync || !platform.hasSsh) && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
              <AlertTriangle className="h-4 w-4" />
              Missing Required Tools
            </div>
            <p className="text-sm text-amber-700">
              {!platform.hasSsh && 'SSH is not installed. '}
              {!platform.hasRsync && 'rsync is not installed. '}
              Please install the missing tools to enable sync operations.
            </p>
          </div>
        )}

        {/* Direction Selection */}
        {!isSyncing && !syncProgress && (
          <div className="mb-6">
            <Label className="mb-3 block">Sync Direction</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => setSelectedDirection('push')}
                className={cn(
                  "p-4 rounded-xl border-2 transition-all text-left",
                  selectedDirection === 'push'
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <ArrowUpToLine className={cn(
                  "h-8 w-8 mb-2",
                  selectedDirection === 'push' ? "text-blue-500" : "text-gray-400"
                )} />
                <h4 className="font-medium">Push to VPS</h4>
                <p className="text-sm text-gray-500">Upload local images</p>
              </button>

              <button
                onClick={() => setSelectedDirection('pull')}
                className={cn(
                  "p-4 rounded-xl border-2 transition-all text-left",
                  selectedDirection === 'pull'
                    ? "border-green-500 bg-green-50"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <ArrowDownToLine className={cn(
                  "h-8 w-8 mb-2",
                  selectedDirection === 'pull' ? "text-green-500" : "text-gray-400"
                )} />
                <h4 className="font-medium">Pull from VPS</h4>
                <p className="text-sm text-gray-500">Download VPS images</p>
              </button>

              <button
                onClick={() => setSelectedDirection('bidirectional')}
                className={cn(
                  "p-4 rounded-xl border-2 transition-all text-left",
                  selectedDirection === 'bidirectional'
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 hover:border-gray-300"
                )}
              >
                <RefreshCcw className={cn(
                  "h-8 w-8 mb-2",
                  selectedDirection === 'bidirectional' ? "text-purple-500" : "text-gray-400"
                )} />
                <h4 className="font-medium">Bidirectional</h4>
                <p className="text-sm text-gray-500">Sync both ways</p>
              </button>
            </div>

            {/* Flow Diagram */}
            <div className="mt-6">
              <SyncFlowDiagram direction={selectedDirection} config={vpsConfig} />
            </div>

            {/* Start Button */}
            <div className="mt-6 flex justify-center">
              <Button
                size="lg"
                onClick={startSync}
                disabled={!canSync}
                className="gap-2 px-8"
              >
                <Play className="h-5 w-5" />
                Start {selectedDirection === 'push' ? 'Push' : selectedDirection === 'pull' ? 'Pull' : 'Sync'}
              </Button>
            </div>
            {!canSync && (
              <p className="text-center text-sm text-gray-500 mt-2">
                {connectionStatus !== 'connected' && 'Connect to VPS first. '}
                {platform && !platform.hasRsync && 'Install rsync. '}
                {platform && !platform.hasSsh && 'Install SSH. '}
              </p>
            )}
          </div>
        )}

        {/* Active Sync Progress */}
        {syncProgress && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {syncProgress.status === 'running' && (
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                )}
                {syncProgress.status === 'paused' && (
                  <Pause className="h-5 w-5 text-amber-500" />
                )}
                {syncProgress.status === 'completed' && (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {syncProgress.status === 'error' && (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                {syncProgress.status === 'cancelled' && (
                  <Square className="h-5 w-5 text-gray-500" />
                )}
                <span className="font-medium capitalize">
                  {syncProgress.status === 'running' ? `Syncing ${syncProgress.currentPhase}...` : syncProgress.status}
                </span>
              </div>

              <Badge variant="outline">
                {syncProgress.direction}
              </Badge>
            </div>

            {/* Flow Diagram for Active Sync */}
            <SyncFlowDiagram direction={syncProgress.direction} config={vpsConfig} />

            {/* Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Files transferred: {syncProgress.transferredFiles}</span>
                <span>{syncProgress.currentFile && `Current: ${syncProgress.currentFile.slice(0, 30)}...`}</span>
              </div>
              <Progress
                value={syncProgress.totalFiles > 0
                  ? (syncProgress.transferredFiles / syncProgress.totalFiles) * 100
                  : 0}
                className="h-3"
              />
            </div>

            {/* Control Buttons */}
            {syncProgress.status === 'running' && (
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={pauseSync}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
                <Button variant="destructive" onClick={stopSync}>
                  <Square className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>
            )}

            {/* Completed/Error Actions */}
            {['completed', 'error', 'cancelled', 'paused'].includes(syncProgress.status) && (
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={clearSession}>
                  Clear
                </Button>
                {syncProgress.status !== 'completed' && (
                  <Button onClick={startSync} disabled={!canSync}>
                    <Play className="h-4 w-4 mr-2" />
                    Restart
                  </Button>
                )}
              </div>
            )}

            {/* Error Message */}
            {syncProgress.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {syncProgress.error}
              </div>
            )}

            {/* Logs */}
            {syncProgress.logs.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium mb-2">Sync Log</h4>
                <ScrollArea className="h-32 bg-gray-900 rounded-lg p-3 font-mono text-xs">
                  {syncProgress.logs.map((log, i) => (
                    <div key={i} className="text-gray-300">
                      <span className="text-gray-500">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>{' '}
                      {log.message}
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Delete Excess Files */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-red-100 rounded-lg">
            <Trash2 className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Delete Excess Files</h3>
            <p className="text-sm text-gray-500">Remove orphaned images from VPS not linked to any template</p>
          </div>
        </div>

        {/* How It Works Explanation */}
        <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg shrink-0">
              <Database className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h4 className="font-medium text-blue-900 mb-2">How This Works</h4>
              <div className="text-sm text-blue-800 space-y-2">
                <p>
                  <strong>The SQLite database is the source of truth.</strong> This feature compares
                  files on the VPS against templates in the database and identifies &quot;orphaned&quot; images -
                  files that exist on the VPS but have no corresponding template record.
                </p>
                <p>
                  This typically happens when templates are deleted from the database but their
                  screenshots remain on the VPS, or during failed scraping operations that leave
                  behind partial data.
                </p>
                <div className="bg-white/60 rounded p-3 mt-3">
                  <p className="font-medium text-blue-900 mb-1">Process:</p>
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Click <strong>Analyze</strong> to scan VPS and compare against database</li>
                    <li>Review the list of excess files found</li>
                    <li>Click <strong>Delete Excess</strong> to remove orphaned files</li>
                    <li>Files are deleted in batches via SSH for safety</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Connection Warning */}
        {connectionStatus !== 'connected' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-medium">Connect to VPS first to analyze excess files</span>
            </div>
          </div>
        )}

        {/* Analysis Section */}
        {connectionStatus === 'connected' && !deleteProgress && (
          <div className="space-y-6">
            {/* Analyze Button */}
            <div className="flex justify-center">
              <Button
                onClick={analyzeExcessFiles}
                disabled={isAnalyzingExcess}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                {isAnalyzingExcess ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Analyzing VPS...
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5" />
                    Analyze Excess Files
                  </>
                )}
              </Button>
            </div>

            {/* Analysis Results */}
            {excessAnalysis && (
              <div className="space-y-4">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Database className="h-6 w-6 text-blue-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-gray-900">{excessAnalysis.validInDb.screenshots}</p>
                    <p className="text-xs text-gray-500">Templates in DB</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Server className="h-6 w-6 text-green-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-gray-900">{excessAnalysis.totalOnVps.screenshots}</p>
                    <p className="text-xs text-gray-500">Screenshots on VPS</p>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg text-center">
                    <Server className="h-6 w-6 text-green-500 mx-auto mb-2" />
                    <p className="text-2xl font-bold text-gray-900">{excessAnalysis.totalOnVps.thumbnails}</p>
                    <p className="text-xs text-gray-500">Thumbnails on VPS</p>
                  </div>
                  <div className={cn(
                    "p-4 rounded-lg text-center",
                    excessAnalysis.totalExcessCount > 0 ? "bg-red-50" : "bg-green-50"
                  )}>
                    <FileX2 className={cn(
                      "h-6 w-6 mx-auto mb-2",
                      excessAnalysis.totalExcessCount > 0 ? "text-red-500" : "text-green-500"
                    )} />
                    <p className={cn(
                      "text-2xl font-bold",
                      excessAnalysis.totalExcessCount > 0 ? "text-red-600" : "text-green-600"
                    )}>{excessAnalysis.totalExcessCount}</p>
                    <p className="text-xs text-gray-500">Excess Files</p>
                  </div>
                </div>

                {excessAnalysis.totalExcessCount > 0 ? (
                  <>
                    {/* Excess Breakdown */}
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        <h4 className="font-medium text-red-900">Excess Files Found</h4>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-red-700">Excess Screenshots:</span>
                          <span className="ml-2 font-bold text-red-900">{excessAnalysis.excessScreenshots}</span>
                        </div>
                        <div>
                          <span className="text-red-700">Excess Thumbnails:</span>
                          <span className="ml-2 font-bold text-red-900">{excessAnalysis.excessThumbnails}</span>
                        </div>
                      </div>
                      <p className="text-xs text-red-600 mt-2">
                        Estimated space to reclaim: ~{(excessAnalysis.estimatedSizeBytes / (1024 * 1024)).toFixed(1)} MB
                      </p>
                    </div>

                    {/* File List Preview */}
                    <div>
                      <h4 className="text-sm font-medium mb-2">Files to Delete (preview)</h4>
                      <ScrollArea className="h-32 border rounded-lg p-2 bg-gray-50">
                        {excessAnalysis.excessFiles.slice(0, 100).map((file, i) => (
                          <div key={i} className="text-xs py-1 px-2 hover:bg-white rounded flex items-center gap-2">
                            <Badge variant="outline" className={cn(
                              "text-[10px] px-1",
                              file.type === 'screenshot' ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                            )}>
                              {file.type === 'screenshot' ? 'SS' : 'TH'}
                            </Badge>
                            <span className="truncate text-gray-600">{file.filename}</span>
                          </div>
                        ))}
                        {excessAnalysis.excessFiles.length > 100 && (
                          <div className="text-xs text-gray-400 text-center py-2">
                            +{excessAnalysis.excessFiles.length - 100} more files
                          </div>
                        )}
                      </ScrollArea>
                    </div>

                    {/* Delete Button */}
                    <div className="flex justify-center gap-3">
                      <Button variant="outline" onClick={() => setExcessAnalysis(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={startDeleteExcess}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete {excessAnalysis.totalExcessCount} Excess Files
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                    <p className="text-gray-600 font-medium">VPS is clean!</p>
                    <p className="text-sm text-gray-500">
                      All files on VPS are linked to templates in the database.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Delete Progress */}
        {deleteProgress && (
          <div className="space-y-4">
            {/* Status Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {deleteProgress.status === 'running' && (
                  <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                )}
                {deleteProgress.status === 'completed' && (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                {deleteProgress.status === 'error' && (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <span className="font-medium capitalize">
                  {deleteProgress.status === 'running' ? 'Deleting excess files...' : deleteProgress.status}
                </span>
              </div>
              <Badge variant="outline">
                {deleteProgress.deletedFiles} / {deleteProgress.totalFiles}
              </Badge>
            </div>

            {/* Progress Bar */}
            <div className="space-y-2">
              <Progress
                value={deleteProgress.totalFiles > 0
                  ? (deleteProgress.deletedFiles / deleteProgress.totalFiles) * 100
                  : 0}
                className="h-3"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>Deleted: {deleteProgress.deletedFiles}</span>
                {deleteProgress.failedFiles > 0 && (
                  <span className="text-red-600">Failed: {deleteProgress.failedFiles}</span>
                )}
                <span>Total: {deleteProgress.totalFiles}</span>
              </div>
            </div>

            {/* Logs */}
            <div>
              <h4 className="text-sm font-medium mb-2">Delete Log</h4>
              <ScrollArea className="h-32 bg-gray-900 rounded-lg p-3 font-mono text-xs">
                {deleteProgress.logs.map((log, i) => (
                  <div key={i} className={cn(
                    log.type === 'error' && 'text-red-400',
                    log.type === 'success' && 'text-green-400',
                    log.type === 'info' && 'text-gray-300'
                  )}>
                    <span className="text-gray-500">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>{' '}
                    {log.message}
                  </div>
                ))}
              </ScrollArea>
            </div>

            {/* Completed Actions */}
            {['completed', 'error'].includes(deleteProgress.status) && (
              <div className="flex justify-center">
                <Button variant="outline" onClick={clearDeleteProgress}>
                  Clear & Refresh
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* How It Works */}
      <Card className="p-6">
        <ExpandableAccordion
          title="How Image Sync Works"
          icon={<Info className="h-5 w-5 text-blue-500" />}
          defaultOpen={false}
        >
          <div className="space-y-6">
            <div className="prose prose-sm max-w-none text-gray-600">
              <p>
                The image sync system uses <code>rsync</code> to efficiently transfer images between
                your local development machine and the VPS production server. This ensures your
                template screenshots and thumbnails are always available where needed.
              </p>
              {platform?.isWindows && (
                <p className="text-amber-700 bg-amber-50 p-2 rounded">
                  <strong>Windows Users:</strong> rsync is typically installed via Git for Windows.
                  Make sure you have Git Bash installed to use sync features.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <ArrowUpToLine className="h-6 w-6 text-blue-600 mb-2" />
                <h4 className="font-medium text-blue-900">Push</h4>
                <p className="text-sm text-blue-700">
                  Uploads new screenshots from your local machine to the VPS. Use after scraping new templates.
                </p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg">
                <ArrowDownToLine className="h-6 w-6 text-green-600 mb-2" />
                <h4 className="font-medium text-green-900">Pull</h4>
                <p className="text-sm text-green-700">
                  Downloads images from VPS to your local machine. Use when setting up a new dev environment.
                </p>
              </div>

              <div className="p-4 bg-purple-50 rounded-lg">
                <RefreshCcw className="h-6 w-6 text-purple-600 mb-2" />
                <h4 className="font-medium text-purple-900">Bidirectional</h4>
                <p className="text-sm text-purple-700">
                  Syncs both directions - newest files win. Use to keep both environments fully up to date.
                </p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium mb-2">File Locations</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Local Screenshots:</span>
                  <code className="block mt-1 text-xs bg-white p-2 rounded border">public/screenshots/</code>
                </div>
                <div>
                  <span className="text-gray-500">VPS Screenshots:</span>
                  <code className="block mt-1 text-xs bg-white p-2 rounded border">{vpsConfig.remotePath}/screenshots/</code>
                </div>
                <div>
                  <span className="text-gray-500">Local Thumbnails:</span>
                  <code className="block mt-1 text-xs bg-white p-2 rounded border">public/thumbnails/</code>
                </div>
                <div>
                  <span className="text-gray-500">VPS Thumbnails:</span>
                  <code className="block mt-1 text-xs bg-white p-2 rounded border">{vpsConfig.remotePath}/thumbnails/</code>
                </div>
              </div>
            </div>
          </div>
        </ExpandableAccordion>
      </Card>
    </div>
  );
}
