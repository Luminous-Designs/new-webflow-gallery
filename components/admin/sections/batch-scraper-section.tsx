/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import {
  Download,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Radar,
  Play,
  Pause,
  SkipForward,
  FileSearch,
  Database,
  Globe,
  ExternalLink,
  Sparkles,
  Clock,
  Camera,
  Save,
  AlertCircle,
  RefreshCw,
  Ban,
  Layers,
  ChevronRight,
  Settings,
  Zap,
  ArrowRight,
  RotateCcw
} from 'lucide-react';

// Types
interface BatchTemplate {
  id: number;
  batch_id: number;
  session_id: number;
  template_url: string;
  template_slug?: string;
  template_name?: string;
  live_preview_url?: string;
  status: string;
  phase_started_at?: string;
  phase_duration_seconds: number;
  phaseElapsedSeconds?: number;
  retry_count: number;
  error_message?: string;
}

interface ScrapeBatch {
  id: number;
  session_id: number;
  batch_number: number;
  status: string;
  total_templates: number;
  processed_templates: number;
  successful_templates: number;
  failed_templates: number;
  skipped_templates: number;
}

interface ScrapeSession {
  id: number;
  session_type: string;
  status: string;
  total_templates: number;
  processed_templates: number;
  successful_templates: number;
  failed_templates: number;
  skipped_templates: number;
  batch_size: number;
  total_batches: number;
  current_batch_number: number;
}

interface DiscoveryState {
  phase: 'idle' | 'discovering' | 'discovered' | 'scraping';
  message: string;
  sitemapCount: number;
  existingCount: number;
  blacklistedCount: number;
  newTemplates: Array<{ url: string; slug: string; displayName: string }>;
  error: string | null;
}

interface BatchProgressState {
  session: ScrapeSession | null;
  currentBatch: ScrapeBatch | null;
  batchTemplates: BatchTemplate[];
  allBatches: ScrapeBatch[];
}

interface PerformanceConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
}

interface ConfigState {
  currentConfig: PerformanceConfig | null;
  pendingConfig: PerformanceConfig | null;
  currentBatch: number;
}

// Helper to format phase name
function formatPhase(phase: string): string {
  const phases: Record<string, string> = {
    pending: 'Pending',
    scraping_details: 'Scraping Details',
    taking_screenshot: 'Taking Screenshot',
    processing_thumbnail: 'Processing',
    saving: 'Saving',
    completed: 'Completed',
    failed: 'Failed',
    skipped: 'Skipped'
  };
  return phases[phase] || phase;
}

// Helper to get phase icon
function PhaseIcon({ phase }: { phase: string }) {
  switch (phase) {
    case 'pending':
      return <Clock className="h-4 w-4 text-gray-400" />;
    case 'scraping_details':
      return <FileSearch className="h-4 w-4 text-blue-500 animate-pulse" />;
    case 'taking_screenshot':
      return <Camera className="h-4 w-4 text-purple-500 animate-pulse" />;
    case 'processing_thumbnail':
      return <Loader2 className="h-4 w-4 text-orange-500 animate-spin" />;
    case 'saving':
      return <Save className="h-4 w-4 text-green-500 animate-pulse" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />;
    case 'skipped':
      return <SkipForward className="h-4 w-4 text-yellow-600" />;
    default:
      return <Clock className="h-4 w-4 text-gray-400" />;
  }
}

// Template Card Component
function TemplateCard({
  template,
  onSkip,
  isActive
}: {
  template: BatchTemplate;
  onSkip: (id: number) => void;
  isActive: boolean;
}) {
  const isProcessing = !['completed', 'failed', 'skipped', 'pending'].includes(template.status);
  const elapsed = template.phaseElapsedSeconds || 0;

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        isProcessing
          ? 'border-blue-200 bg-blue-50/50'
          : template.status === 'completed'
          ? 'border-green-200 bg-green-50/30'
          : template.status === 'failed'
          ? 'border-red-200 bg-red-50/30'
          : template.status === 'skipped'
          ? 'border-yellow-200 bg-yellow-50/30'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <PhaseIcon phase={template.status} />
            <span className="text-sm font-medium text-gray-700 truncate">
              {template.template_name || template.template_slug || 'Loading...'}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Badge
              variant="outline"
              className={`text-xs ${
                isProcessing
                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : template.status === 'completed'
                  ? 'bg-green-100 text-green-700 border-green-200'
                  : template.status === 'failed'
                  ? 'bg-red-100 text-red-700 border-red-200'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {formatPhase(template.status)}
            </Badge>

            {isProcessing && elapsed > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {elapsed}s
              </span>
            )}
          </div>

          {template.error_message && (
            <p className="text-xs text-red-600 mt-1 truncate">
              {template.error_message}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {template.live_preview_url && (
            <a
              href={template.live_preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="Open live preview"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}

          {isActive && !['completed', 'failed', 'skipped'].includes(template.status) && (
            <button
              onClick={() => onSkip(template.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Skip and blacklist"
            >
              <Ban className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Batch Progress Component
function BatchProgress({
  progress,
  onSkip,
  isPaused
}: {
  progress: BatchProgressState;
  onSkip: (id: number) => void;
  isPaused: boolean;
}) {
  const { session, currentBatch, batchTemplates, allBatches } = progress;

  if (!session) return null;

  const overallPercent = session.total_templates > 0
    ? Math.round((session.processed_templates / session.total_templates) * 100)
    : 0;

  const batchPercent = currentBatch && currentBatch.total_templates > 0
    ? Math.round((currentBatch.processed_templates / currentBatch.total_templates) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-gray-700">Session Progress</span>
            {isPaused && (
              <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-200">
                Paused
              </Badge>
            )}
          </div>
          <span className="text-sm text-gray-500">
            Batch {session.current_batch_number} of {session.total_batches}
          </span>
        </div>

        <Progress value={overallPercent} className="h-3 mb-2" />

        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          <div className="p-2 bg-white rounded border">
            <div className="font-bold text-gray-700">{session.total_templates}</div>
            <div className="text-gray-500">Total</div>
          </div>
          <div className="p-2 bg-white rounded border">
            <div className="font-bold text-blue-600">{session.processed_templates}</div>
            <div className="text-gray-500">Processed</div>
          </div>
          <div className="p-2 bg-green-50 rounded border border-green-100">
            <div className="font-bold text-green-600">{session.successful_templates}</div>
            <div className="text-green-600">Success</div>
          </div>
          <div className="p-2 bg-red-50 rounded border border-red-100">
            <div className="font-bold text-red-600">{session.failed_templates}</div>
            <div className="text-red-600">Failed</div>
          </div>
          <div className="p-2 bg-yellow-50 rounded border border-yellow-100">
            <div className="font-bold text-yellow-600">{session.skipped_templates}</div>
            <div className="text-yellow-600">Skipped</div>
          </div>
        </div>
      </div>

      {/* Current Batch */}
      {currentBatch && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-700 flex items-center gap-2">
              <ChevronRight className="h-4 w-4" />
              Current Batch #{currentBatch.batch_number}
            </h4>
            <span className="text-sm text-gray-500">
              {currentBatch.processed_templates}/{currentBatch.total_templates} templates
            </span>
          </div>

          <Progress value={batchPercent} className="h-2 mb-4" />

          {/* Template Cards */}
          <ScrollArea className="h-[300px] pr-2">
            <div className="space-y-2">
              {batchTemplates.map(template => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onSkip={onSkip}
                  isActive={!isPaused && session.status === 'running'}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Batch Overview */}
      <div>
        <h4 className="font-medium text-gray-700 mb-2">All Batches</h4>
        <div className="flex gap-1 flex-wrap">
          {allBatches.map(batch => (
            <div
              key={batch.id}
              className={`w-8 h-8 rounded flex items-center justify-center text-xs font-medium ${
                batch.status === 'completed'
                  ? 'bg-green-100 text-green-700'
                  : batch.status === 'running'
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-400'
                  : batch.status === 'failed'
                  ? 'bg-red-100 text-red-700'
                  : batch.status === 'paused'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-gray-100 text-gray-500'
              }`}
              title={`Batch ${batch.batch_number}: ${batch.status}`}
            >
              {batch.batch_number}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Live Performance Controls Component
function LivePerformanceControls({
  config,
  onUpdateConfig,
  onCancelConfig
}: {
  config: ConfigState;
  onUpdateConfig: (updates: Partial<PerformanceConfig>) => void;
  onCancelConfig: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [localConfig, setLocalConfig] = useState<Partial<PerformanceConfig>>({});
  const hasChanges = Object.keys(localConfig).length > 0;
  const hasPending = config.pendingConfig !== null;

  const handleApply = () => {
    if (hasChanges) {
      onUpdateConfig(localConfig);
      setLocalConfig({});
    }
  };

  const handleReset = () => {
    setLocalConfig({});
  };

  if (!config.currentConfig) return null;

  const current = config.currentConfig;
  const pending = config.pendingConfig;

  return (
    <div className="mt-4 p-4 bg-white/80 rounded-lg border border-gray-200">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-gray-500" />
          <span className="font-medium text-gray-700">Performance Controls</span>
          {hasPending && (
            <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200 text-xs">
              <Clock className="h-3 w-3 mr-1" />
              Changes Pending
            </Badge>
          )}
        </div>
        <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Current Config Display */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className={`p-2 rounded border ${hasPending ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="font-medium text-gray-600">Concurrency</div>
              <div className={`text-lg font-bold ${hasPending ? 'text-gray-500' : 'text-blue-600'}`}>
                {current.concurrency}
              </div>
              {pending && pending.concurrency !== current.concurrency && (
                <div className="flex items-center justify-center gap-1 text-amber-600">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-bold">{pending.concurrency}</span>
                </div>
              )}
            </div>
            <div className={`p-2 rounded border ${hasPending ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="font-medium text-gray-600">Browsers</div>
              <div className={`text-lg font-bold ${hasPending ? 'text-gray-500' : 'text-blue-600'}`}>
                {current.browserInstances}
              </div>
              {pending && pending.browserInstances !== current.browserInstances && (
                <div className="flex items-center justify-center gap-1 text-amber-600">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-bold">{pending.browserInstances}</span>
                </div>
              )}
            </div>
            <div className={`p-2 rounded border ${hasPending ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="font-medium text-gray-600">Pages/Browser</div>
              <div className={`text-lg font-bold ${hasPending ? 'text-gray-500' : 'text-blue-600'}`}>
                {current.pagesPerBrowser}
              </div>
              {pending && pending.pagesPerBrowser !== current.pagesPerBrowser && (
                <div className="flex items-center justify-center gap-1 text-amber-600">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-bold">{pending.pagesPerBrowser}</span>
                </div>
              )}
            </div>
            <div className={`p-2 rounded border ${hasPending ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="font-medium text-gray-600">Batch Size</div>
              <div className={`text-lg font-bold ${hasPending ? 'text-gray-500' : 'text-blue-600'}`}>
                {current.batchSize}
              </div>
              {pending && pending.batchSize !== current.batchSize && (
                <div className="flex items-center justify-center gap-1 text-amber-600">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-bold">{pending.batchSize}</span>
                </div>
              )}
            </div>
            <div className={`p-2 rounded border ${hasPending ? 'bg-gray-50 border-gray-200' : 'bg-blue-50 border-blue-200'}`}>
              <div className="font-medium text-gray-600">Timeout</div>
              <div className={`text-lg font-bold ${hasPending ? 'text-gray-500' : 'text-blue-600'}`}>
                {current.timeout / 1000}s
              </div>
              {pending && pending.timeout !== current.timeout && (
                <div className="flex items-center justify-center gap-1 text-amber-600">
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-bold">{pending.timeout / 1000}s</span>
                </div>
              )}
            </div>
          </div>

          {/* Pending Changes Notice */}
          {hasPending && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-700 text-sm">
                <Zap className="h-4 w-4" />
                <span>Changes will apply at the start of the next batch</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onCancelConfig}
                className="text-amber-700 border-amber-300 hover:bg-amber-100"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            </div>
          )}

          {/* Adjust Controls */}
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">Adjust for Next Batch</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Concurrency</label>
                <Select
                  value={String(localConfig.concurrency ?? current.concurrency)}
                  onValueChange={(v) => setLocalConfig(prev => ({ ...prev, concurrency: parseInt(v) }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 3, 5, 10, 15, 20, 25, 30].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Browsers</label>
                <Select
                  value={String(localConfig.browserInstances ?? current.browserInstances)}
                  onValueChange={(v) => setLocalConfig(prev => ({ ...prev, browserInstances: parseInt(v) }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Pages/Browser</label>
                <Select
                  value={String(localConfig.pagesPerBrowser ?? current.pagesPerBrowser)}
                  onValueChange={(v) => setLocalConfig(prev => ({ ...prev, pagesPerBrowser: parseInt(v) }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[3, 5, 10, 15, 20].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Batch Size</label>
                <Select
                  value={String(localConfig.batchSize ?? current.batchSize)}
                  onValueChange={(v) => setLocalConfig(prev => ({ ...prev, batchSize: parseInt(v) }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 15, 20, 25, 50].map(n => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={!hasChanges}
                className="flex-1"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={handleApply}
                disabled={!hasChanges}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Zap className="h-3 w-3 mr-1" />
                Schedule for Next Batch
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main Component
export function BatchScraperSection() {
  const { stats, loadStats, resolveAuthToken } = useAdmin();

  const [isScrapingActive, setIsScrapingActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [progress, setProgress] = useState<BatchProgressState>({
    session: null,
    currentBatch: null,
    batchTemplates: [],
    allBatches: []
  });

  const [batchSize, setBatchSize] = useState('10');
  const [concurrency, setConcurrency] = useState('5');
  const [browserInstances, setBrowserInstances] = useState('2');
  const [pagesPerBrowser, setPagesPerBrowser] = useState('5');
  const [advancedMode, setAdvancedMode] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);

  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({
    phase: 'idle',
    message: '',
    sitemapCount: 0,
    existingCount: 0,
    blacklistedCount: 0,
    newTemplates: [],
    error: null
  });

  const [interruptedSession, setInterruptedSession] = useState<ScrapeSession | null>(null);
  const [configState, setConfigState] = useState<ConfigState>({
    currentConfig: null,
    pendingConfig: null,
    currentBatch: 0
  });
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  }, []);

  // Check for active/interrupted sessions on mount
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/admin/batch', {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.isActive && data.currentSessionId) {
            setIsScrapingActive(true);
            setCurrentSessionId(data.currentSessionId);
            // Also set config state if available
            if (data.config) {
              setConfigState({
                currentConfig: data.config.currentConfig,
                pendingConfig: data.config.pendingConfig,
                currentBatch: data.config.currentBatch
              });
            }
          } else if (data.hasInterruptedSession) {
            setInterruptedSession(data.interruptedSession);
          }
        }
      } catch (error) {
        console.error('Failed to check status:', error);
      }
    };
    checkStatus();
  }, [resolveAuthToken]);

  // Poll for progress when active
  useEffect(() => {
    if (isScrapingActive && currentSessionId) {
      const poll = async () => {
        try {
          // Fetch progress
          const progressResponse = await fetch(`/api/admin/batch/progress/${currentSessionId}`, {
            headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
          });
          if (progressResponse.ok) {
            const data = await progressResponse.json();
            setProgress(data);
            setIsPaused(data.session?.status === 'paused');

            if (data.session?.status === 'completed' || data.session?.status === 'failed') {
              setIsScrapingActive(false);
              setCurrentSessionId(null);
              setConfigState({ currentConfig: null, pendingConfig: null, currentBatch: 0 });
              loadStats();
              toast.success(
                data.session.status === 'completed'
                  ? 'Batch scrape completed!'
                  : 'Batch scrape failed'
              );
            }
          }

          // Also fetch config state
          const statusResponse = await fetch('/api/admin/batch', {
            headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
          });
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.config) {
              setConfigState({
                currentConfig: statusData.config.currentConfig,
                pendingConfig: statusData.config.pendingConfig,
                currentBatch: statusData.config.currentBatch
              });
            }
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      };

      poll();
      pollingRef.current = setInterval(poll, 2000);

      return () => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
        }
      };
    }
  }, [isScrapingActive, currentSessionId, resolveAuthToken, loadStats]);

  // Discover new templates
  const discoverNewTemplates = async () => {
    setDiscoveryState({
      phase: 'discovering',
      message: 'Fetching Webflow sitemap...',
      sitemapCount: 0,
      existingCount: 0,
      blacklistedCount: 0,
      newTemplates: [],
      error: null
    });
    addLog('Starting template discovery...');

    try {
      const response = await fetch('/api/admin/batch/discover', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Discovery failed');
      }

      const data = await response.json();
      const { discovery } = data;

      setDiscoveryState({
        phase: 'discovered',
        message: discovery.newCount > 0
          ? `Found ${discovery.newCount} new templates!`
          : 'No new templates found.',
        sitemapCount: discovery.totalInSitemap,
        existingCount: discovery.existingInDb,
        blacklistedCount: discovery.blacklisted,
        newTemplates: discovery.newTemplates,
        error: null
      });

      addLog(`Discovery complete: ${discovery.newCount} new, ${discovery.blacklisted} blacklisted`);

      if (discovery.newCount > 0) {
        toast.success(`Found ${discovery.newCount} new templates!`);
      } else {
        toast.info('No new templates found');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setDiscoveryState(prev => ({ ...prev, phase: 'idle', error: message }));
      addLog(`Discovery failed: ${message}`);
      toast.error(`Discovery failed: ${message}`);
    }
  };

  // Start batch scrape
  const startBatchScrape = async (urls: string[]) => {
    if (urls.length === 0) {
      toast.error('No URLs to scrape');
      return;
    }

    setDiscoveryState(prev => ({ ...prev, phase: 'scraping', message: 'Starting batch scrape...' }));
    addLog(`Starting batch scrape of ${urls.length} templates...`);

    try {
      const body = {
        action: 'start',
        urls,
        sessionType: 'update',
        batchSize: parseInt(batchSize),
        concurrency: advancedMode
          ? parseInt(browserInstances) * parseInt(pagesPerBrowser)
          : parseInt(concurrency),
        browserInstances: advancedMode ? parseInt(browserInstances) : 1,
        pagesPerBrowser: advancedMode ? parseInt(pagesPerBrowser) : parseInt(concurrency)
      };

      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setIsScrapingActive(true);
        setCurrentSessionId(data.sessionId);
        toast.success(`Batch scrape started: ${data.totalBatches} batches`);
        addLog(`Session ${data.sessionId} started: ${data.totalTemplates} templates in ${data.totalBatches} batches`);
      } else {
        throw new Error(data.error || 'Failed to start');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setDiscoveryState(prev => ({ ...prev, phase: 'discovered' }));
      toast.error(message);
      addLog(`Failed to start: ${message}`);
    }
  };

  // Pause/resume session
  const togglePause = async () => {
    try {
      const action = isPaused ? 'resume' : 'pause';
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action })
      });

      if (response.ok) {
        setIsPaused(!isPaused);
        toast.success(isPaused ? 'Session resumed' : 'Session paused');
        addLog(isPaused ? 'Session resumed' : 'Session paused');
      }
    } catch (error) {
      toast.error('Failed to toggle pause');
    }
  };

  // Stop session
  const stopSession = async () => {
    if (!window.confirm('Are you sure you want to stop the scrape? Progress will be saved.')) {
      return;
    }

    try {
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'stop' })
      });

      if (response.ok) {
        setIsScrapingActive(false);
        setCurrentSessionId(null);
        setDiscoveryState(prev => ({ ...prev, phase: 'idle' }));
        toast.success('Session stopped');
        addLog('Session stopped by user');
        loadStats();
      }
    } catch (error) {
      toast.error('Failed to stop session');
    }
  };

  // Skip template
  const skipTemplate = async (templateId: number) => {
    try {
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'skip', templateId })
      });

      if (response.ok) {
        toast.success('Template will be skipped and blacklisted');
        addLog(`Skip requested for template ${templateId}`);
      }
    } catch (error) {
      toast.error('Failed to skip template');
    }
  };

  // Resume interrupted session
  const resumeInterrupted = async () => {
    try {
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'resume',
          concurrency: parseInt(concurrency),
          browserInstances: parseInt(browserInstances),
          pagesPerBrowser: parseInt(pagesPerBrowser),
          batchSize: parseInt(batchSize)
        })
      });

      if (response.ok) {
        const data = await response.json();
        setIsScrapingActive(true);
        setCurrentSessionId(data.sessionId);
        setInterruptedSession(null);
        toast.success('Session resumed');
        addLog('Resumed interrupted session');
      }
    } catch (error) {
      toast.error('Failed to resume session');
    }
  };

  // Reset discovery
  const resetDiscovery = () => {
    setDiscoveryState({
      phase: 'idle',
      message: '',
      sitemapCount: 0,
      existingCount: 0,
      blacklistedCount: 0,
      newTemplates: [],
      error: null
    });
  };

  // Update performance config for next batch
  const updateConfig = async (updates: Partial<PerformanceConfig>) => {
    try {
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'update_config',
          config: updates
        })
      });

      if (response.ok) {
        const data = await response.json();
        setConfigState({
          currentConfig: data.current,
          pendingConfig: data.pending,
          currentBatch: data.currentBatch
        });
        toast.success('Config scheduled for next batch');
        addLog(`Scheduled config change: ${JSON.stringify(updates)}`);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update config');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(message);
      addLog(`Config update failed: ${message}`);
    }
  };

  // Cancel pending config changes
  const cancelConfig = async () => {
    try {
      const response = await fetch('/api/admin/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'cancel_config'
        })
      });

      if (response.ok) {
        const data = await response.json();
        setConfigState({
          currentConfig: data.current,
          pendingConfig: null,
          currentBatch: configState.currentBatch
        });
        toast.success('Pending config cancelled');
        addLog('Cancelled pending config changes');
      }
    } catch (error) {
      toast.error('Failed to cancel config');
    }
  };

  return (
    <div className="space-y-6">
      {/* Interrupted Session Banner */}
      {interruptedSession && !isScrapingActive && (
        <Card className="p-4 border-2 border-yellow-200 bg-yellow-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-yellow-600" />
              <div>
                <h3 className="font-medium text-yellow-800">Interrupted Session Found</h3>
                <p className="text-sm text-yellow-700">
                  {interruptedSession.processed_templates}/{interruptedSession.total_templates} templates processed
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setInterruptedSession(null)}
                className="border-yellow-300"
              >
                Dismiss
              </Button>
              <Button onClick={resumeInterrupted} className="bg-yellow-600 hover:bg-yellow-700">
                <RefreshCw className="h-4 w-4 mr-2" />
                Resume Session
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Active Scrape Progress */}
      {isScrapingActive && progress.session && (
        <Card className="p-6 border-2 border-blue-200 bg-gradient-to-br from-blue-50/80 to-indigo-50/80">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">Batch Scrape in Progress</h2>
                <p className="text-sm text-gray-500">Session #{progress.session.id}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={togglePause}>
                {isPaused ? (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </>
                )}
              </Button>
              <Button variant="destructive" onClick={stopSession}>
                <XCircle className="h-4 w-4 mr-2" />
                Stop
              </Button>
            </div>
          </div>

          <BatchProgress progress={progress} onSkip={skipTemplate} isPaused={isPaused} />

          {/* Live Performance Controls */}
          <LivePerformanceControls
            config={configState}
            onUpdateConfig={updateConfig}
            onCancelConfig={cancelConfig}
          />
        </Card>
      )}

      {/* Discovery & Start Section */}
      {!isScrapingActive && (
        <Card className="p-6 border-2 border-blue-100 bg-gradient-to-br from-blue-50/50 to-white">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Radar className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Batch Template Scraper</h2>
              <p className="text-sm text-gray-500">
                Scrape templates in configurable batches with real-time progress
              </p>
            </div>
          </div>

          {/* Idle State */}
          {discoveryState.phase === 'idle' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
                <Globe className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-medium mb-2">Check for New Templates</h3>
              <p className="text-gray-500 mb-6 max-w-md mx-auto">
                Discover new templates from the Webflow marketplace and scrape them in batches.
              </p>
              <Button size="lg" onClick={discoverNewTemplates} className="bg-blue-600 hover:bg-blue-700">
                <Radar className="h-5 w-5 mr-2" />
                Check for Updates
              </Button>
              {discoveryState.error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <XCircle className="h-4 w-4 inline mr-2" />
                  {discoveryState.error}
                </div>
              )}
            </div>
          )}

          {/* Discovering */}
          {discoveryState.phase === 'discovering' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4 animate-pulse">
                <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
              </div>
              <h3 className="text-lg font-medium mb-2">Discovering Templates...</h3>
              <p className="text-gray-500">{discoveryState.message}</p>
            </div>
          )}

          {/* Discovered */}
          {discoveryState.phase === 'discovered' && (
            <div className="py-4">
              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="p-4 bg-white rounded-lg border text-center">
                  <Globe className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-gray-700">{discoveryState.sitemapCount}</div>
                  <div className="text-xs text-gray-500">In Sitemap</div>
                </div>
                <div className="p-4 bg-white rounded-lg border text-center">
                  <Database className="h-5 w-5 text-green-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-green-600">{discoveryState.existingCount}</div>
                  <div className="text-xs text-gray-500">In Database</div>
                </div>
                <div className="p-4 bg-white rounded-lg border text-center">
                  <Ban className="h-5 w-5 text-red-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-red-600">{discoveryState.blacklistedCount}</div>
                  <div className="text-xs text-gray-500">Blacklisted</div>
                </div>
                <div className="p-4 bg-white rounded-lg border text-center">
                  <Sparkles className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                  <div className="text-2xl font-bold text-blue-600">{discoveryState.newTemplates.length}</div>
                  <div className="text-xs text-gray-500">New Templates</div>
                </div>
              </div>

              {discoveryState.newTemplates.length > 0 ? (
                <>
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-700">New Templates Found</h4>
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                        {discoveryState.newTemplates.length} templates
                      </Badge>
                    </div>
                    <ScrollArea className="h-[200px] rounded-lg border bg-white">
                      <div className="p-2 space-y-1">
                        {discoveryState.newTemplates.map((template, index) => (
                          <div
                            key={template.url}
                            className="flex items-center justify-between p-2 rounded hover:bg-gray-50 group"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-medium">
                                {index + 1}
                              </span>
                              <span className="text-sm font-medium text-gray-700">
                                {template.displayName}
                              </span>
                            </div>
                            <a
                              href={template.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Batch Configuration */}
                  <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-medium text-gray-700">Batch Configuration</h4>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAdvancedMode(!advancedMode)}
                      >
                        {advancedMode ? 'Simple' : 'Advanced'}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-600 mb-1 block">
                          Batch Size
                        </label>
                        <Select value={batchSize} onValueChange={setBatchSize}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[5, 10, 15, 20, 25, 50].map(n => (
                              <SelectItem key={n} value={String(n)}>
                                {n} templates per batch
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {!advancedMode ? (
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Concurrency
                          </label>
                          <Select value={concurrency} onValueChange={setConcurrency}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {[1, 3, 5, 10, 15, 20].map(n => (
                                <SelectItem key={n} value={String(n)}>
                                  {n} concurrent
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">
                              Browser Instances
                            </label>
                            <Select value={browserInstances} onValueChange={setBrowserInstances}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4, 5].map(n => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n} browser{n > 1 ? 's' : ''}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600 mb-1 block">
                              Pages per Browser
                            </label>
                            <Select value={pagesPerBrowser} onValueChange={setPagesPerBrowser}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {[5, 10, 15, 20, 25].map(n => (
                                  <SelectItem key={n} value={String(n)}>
                                    {n} pages
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="mt-3 text-xs text-gray-500">
                      Will create {Math.ceil(discoveryState.newTemplates.length / parseInt(batchSize))}{' '}
                      batches of {batchSize} templates each
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={resetDiscovery} className="flex-1">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => startBatchScrape(discoveryState.newTemplates.map(t => t.url))}
                      className="flex-1 bg-green-600 hover:bg-green-700"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Start Batch Scrape
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="font-medium text-gray-700 mb-1">All Up to Date!</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Your collection is current with the Webflow marketplace.
                  </p>
                  <Button variant="outline" onClick={resetDiscovery}>
                    Done
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* Console Output */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Console Output</h2>
        <ScrollArea className="h-[300px] w-full rounded border p-4 font-mono text-xs bg-black text-green-400">
          {consoleLogs.length === 0 ? (
            <div className="text-gray-500">No logs yet...</div>
          ) : (
            consoleLogs.map((log, i) => (
              <div key={i} className="mb-1">
                {log}
              </div>
            ))
          )}
        </ScrollArea>
      </Card>
    </div>
  );
}
