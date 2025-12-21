'use client';

import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import { toAssetUrl } from '@/lib/assets';
import {
  AlertTriangle,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Camera,
  Clock,
  Database,
  Globe,
  Star,
  Zap,
  Server,
  Image as ImageIcon,
  RotateCcw,
  RefreshCw,
  Activity,
  Timer,
  Layers,
  Settings2,
  Cpu,
  FileSearch,
  AlertCircle,
  StopCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

// Types
interface FreshScrapeState {
  id: number;
  status: string;
  phase: string;
  total_sitemap_count: number;
  featured_author_ids: string | null;
  featured_template_urls: string | null;
  regular_template_urls: string | null;
  featured_total: number;
  featured_processed: number;
  featured_successful: number;
  featured_failed: number;
  regular_total: number;
  regular_processed: number;
  regular_successful: number;
  regular_failed: number;
  current_batch_index: number;
  current_batch_urls: string | null;
  config: string | null;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  deletion_completed_at: string | null;
  featured_completed_at: string | null;
  last_error: string | null;
  error_count: number;
}

interface FreshScrapeConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
  screenshotAnimationWaitMs: number;
  screenshotNudgeScrollRatio: number;
  screenshotNudgeWaitMs: number;
  screenshotNudgeAfterMs: number;
  screenshotStabilityStableMs: number;
  screenshotStabilityMaxWaitMs: number;
  screenshotStabilityCheckIntervalMs: number;
  screenshotJpegQuality: number;
  screenshotWebpQuality: number;
}

interface TemplatePhase {
  url: string;
  slug: string;
  name: string | null;
  phase: string;
  elapsed: number;
}

interface ExecutorProgress {
  processed: number;
  successful: number;
  failed: number;
  total: number;
}

interface SupabaseWriteState {
  queued: number;
  inFlight: boolean;
  successful: number;
  failed: number;
  lastError: string | null;
  recent: Array<{ slug: string; status: string; error?: string }>;
}

interface TemplateConfirmation {
  slug: string;
  name: string;
  supabaseStatus: 'queued' | 'saved' | 'failed';
  supabaseError?: string;
  screenshotPath: string | null;
  screenshotSaved: boolean;
  updatedAt: string;
}

interface PreflightResult {
  ok: boolean;
  checkedAt: string;
  storage: {
    ok: boolean;
    mode: 'r2';
    publicUrl: string | null;
    bucketName: string | null;
    writable: boolean;
    error: string | null;
  };
  supabase: {
    ok: boolean;
    readOk: boolean;
    writeOk: boolean;
    error: string | null;
  };
  browser: {
    ok: boolean;
    version: string | null;
    error: string | null;
  };
}

interface Screenshot {
  id: number;
  name: string | null;
  slug: string | null;
  screenshotPath: string | null;
  isFeaturedAuthor: boolean;
  capturedAt: string;
}

interface ScreenshotRow {
  id: number;
  fresh_scrape_id: number;
  template_name: string | null;
  template_slug: string | null;
  screenshot_thumbnail_path: string | null;
  screenshot_path: string | null;
  is_featured_author: boolean | number;
  captured_at: string;
}

interface LastScreenshotInfo {
  template_name: string | null;
  template_slug: string | null;
  screenshot_thumbnail_path: string | null;
  screenshot_path: string | null;
  captured_at: string;
}

// Real-time scraper metrics (from backend)
interface RealTimeState {
  activeBrowsers: number;
  totalPagesInUse: number;
  maxPagesCapacity: number;
  configuredConcurrency: number;
  configuredBrowserInstances: number;
  configuredPagesPerBrowser: number;
  configuredBatchSize: number;
  configuredTimeout: number;
  pendingBrowserRestart: boolean;
  isPaused: boolean;
  isStopped: boolean;
  isTimeoutPaused: boolean;
  currentBatchSize: number;
  timeoutCount: number;
  consecutiveTimeouts: number;
  pausedUrlCount: number;
  semaphoreAvailable: number;
  semaphoreWaiting: number;
}

interface NewTemplateDiscoveryState {
  phase: 'idle' | 'checking' | 'checked' | 'error';
  totalInSitemap: number;
  existingInDb: number;
  missingCount: number;
  updatedCount: number;
  toScrapeCount: number;
  missingTemplates: Array<{ url: string; slug: string; displayName: string; reason?: 'missing' | 'updated'; lastmod?: string | null }>;
  error: string | null;
}

// Helper components
function PhaseIcon({ phase }: { phase: string }) {
  switch (phase) {
    case 'pending':
      return <Clock className="h-4 w-4 text-gray-400" />;
    case 'loading':
      return <Globe className="h-4 w-4 text-blue-500 animate-pulse" />;
    case 'scraping_details':
      return <FileSearch className="h-4 w-4 text-blue-500 animate-pulse" />;
    case 'taking_screenshot':
      return <Camera className="h-4 w-4 text-purple-500 animate-pulse" />;
    case 'processing_screenshot':
      return <ImageIcon className="h-4 w-4 text-orange-500 animate-pulse" />;
    case 'saving':
      return <Database className="h-4 w-4 text-green-500 animate-pulse" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-600" />;
    default:
      return <Clock className="h-4 w-4 text-gray-400" />;
  }
}

function formatPhase(phase: string): string {
  const phases: Record<string, string> = {
    pending: 'Waiting',
    loading: 'Loading Page',
    scraping_details: 'Extracting Data',
    taking_screenshot: 'Screenshotting',
    processing_screenshot: 'Processing',
    saving: 'Saving',
    completed: 'Done',
    failed: 'Failed'
  };
  return phases[phase] || phase;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

function applyInFlightProgress(state: FreshScrapeState, inFlight: ExecutorProgress | null, isRunning: boolean): FreshScrapeState {
  if (!isRunning || !inFlight) return state;
  const isFeatured = state.status === 'scraping_featured' || state.phase === 'featured_scrape';
  if (isFeatured) {
    return {
      ...state,
      featured_processed: (state.featured_processed || 0) + (inFlight.processed || 0),
      featured_successful: (state.featured_successful || 0) + (inFlight.successful || 0),
      featured_failed: (state.featured_failed || 0) + (inFlight.failed || 0)
    };
  }
  return {
    ...state,
    regular_processed: (state.regular_processed || 0) + (inFlight.processed || 0),
    regular_successful: (state.regular_successful || 0) + (inFlight.successful || 0),
    regular_failed: (state.regular_failed || 0) + (inFlight.failed || 0)
  };
}

// Performance Controls Component
function PerformanceControls({
  config,
  onChange,
  disabled
}: {
  config: FreshScrapeConfig;
  onChange: (config: Partial<FreshScrapeConfig>) => void;
  disabled: boolean;
}) {
  return (
    <Card className="p-6 bg-gradient-to-br from-slate-50 to-white border-slate-200">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-slate-100 rounded-lg">
          <Settings2 className="h-5 w-5 text-slate-600" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-800">Performance Controls</h3>
          <p className="text-xs text-slate-500">Adjust resource usage vs speed</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Concurrency Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-gray-700">Concurrency</span>
            </div>
            <Badge variant="secondary" className="bg-amber-100 text-amber-700">
              {config.concurrency} parallel
            </Badge>
          </div>
          <Slider
            value={[config.concurrency]}
            onValueChange={([value]) => onChange({ concurrency: value })}
            min={1}
            max={100}
            step={1}
            disabled={disabled}
            className="cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>Slower</span>
            <span>Faster</span>
          </div>
        </div>

        {/* Browser Instances */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium text-gray-700">Browser Instances</span>
            </div>
            <Badge variant="secondary" className="bg-blue-100 text-blue-700">
              {config.browserInstances} browsers
            </Badge>
          </div>
          <Slider
            value={[config.browserInstances]}
            onValueChange={([value]) => onChange({ browserInstances: value })}
            min={1}
            max={30}
            step={1}
            disabled={disabled}
            className="cursor-pointer"
          />
        </div>

        {/* Batch Size */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-purple-500" />
              <span className="text-sm font-medium text-gray-700">Batch Size</span>
            </div>
            <Badge variant="secondary" className="bg-purple-100 text-purple-700">
              {config.batchSize} per batch
            </Badge>
          </div>
          <Slider
            value={[config.batchSize]}
            onValueChange={([value]) => onChange({ batchSize: value })}
            min={5}
            max={200}
            step={5}
            disabled={disabled}
            className="cursor-pointer"
          />
        </div>

        {/* Screenshot Timing Controls */}
        <div className="pt-2 border-t border-slate-200 space-y-5">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-purple-500" />
            <span className="text-sm font-semibold text-slate-800">Screenshot Timing</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium text-gray-700">Base animation wait</span>
              </div>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                {config.screenshotAnimationWaitMs}ms
              </Badge>
            </div>
            <Slider
              value={[config.screenshotAnimationWaitMs]}
              onValueChange={([value]) => onChange({ screenshotAnimationWaitMs: value })}
              min={1000}
              max={8000}
              step={250}
              disabled={disabled}
              className="cursor-pointer"
            />
            <div className="text-xs text-gray-400">Default: 3000ms</div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-slate-500" />
                <span className="text-sm font-medium text-gray-700">Nudge scroll amount</span>
              </div>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                {Math.round(config.screenshotNudgeScrollRatio * 100)}%
              </Badge>
            </div>
            <Slider
              value={[config.screenshotNudgeScrollRatio]}
              onValueChange={([value]) => onChange({ screenshotNudgeScrollRatio: value })}
              min={0}
              max={0.5}
              step={0.05}
              disabled={disabled}
              className="cursor-pointer"
            />
            <div className="text-xs text-gray-400">Default: 20% (0% disables nudge)</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Wait after nudge down</span>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  {config.screenshotNudgeWaitMs}ms
                </Badge>
              </div>
              <Slider
                value={[config.screenshotNudgeWaitMs]}
                onValueChange={([value]) => onChange({ screenshotNudgeWaitMs: value })}
                min={0}
                max={2000}
                step={100}
                disabled={disabled}
                className="cursor-pointer"
              />
              <div className="text-xs text-gray-400">Default: 500ms</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Wait after return to top</span>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  {config.screenshotNudgeAfterMs}ms
                </Badge>
              </div>
              <Slider
                value={[config.screenshotNudgeAfterMs]}
                onValueChange={([value]) => onChange({ screenshotNudgeAfterMs: value })}
                min={0}
                max={2000}
                step={100}
                disabled={disabled}
                className="cursor-pointer"
              />
              <div className="text-xs text-gray-400">Default: 500ms</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Stability window</span>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  {config.screenshotStabilityStableMs}ms
                </Badge>
              </div>
              <Slider
                value={[config.screenshotStabilityStableMs]}
                onValueChange={([value]) => onChange({ screenshotStabilityStableMs: value })}
                min={300}
                max={2000}
                step={100}
                disabled={disabled}
                className="cursor-pointer"
              />
              <div className="text-xs text-gray-400">Default: 1000ms</div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Max stability wait</span>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  {config.screenshotStabilityMaxWaitMs}ms
                </Badge>
              </div>
              <Slider
                value={[config.screenshotStabilityMaxWaitMs]}
                onValueChange={([value]) => onChange({ screenshotStabilityMaxWaitMs: value })}
                min={1000}
                max={12000}
                step={500}
                disabled={disabled}
                className="cursor-pointer"
              />
              <div className="text-xs text-gray-400">Default: 7000ms</div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Stability check interval</span>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                {config.screenshotStabilityCheckIntervalMs}ms
              </Badge>
            </div>
            <Slider
              value={[config.screenshotStabilityCheckIntervalMs]}
              onValueChange={([value]) => onChange({ screenshotStabilityCheckIntervalMs: value })}
              min={100}
              max={500}
              step={50}
              disabled={disabled}
              className="cursor-pointer"
            />
            <div className="text-xs text-gray-400">Default: 250ms</div>
          </div>
	        </div>

	        {/* Screenshot Quality Controls */}
	        <div className="pt-2 border-t border-slate-200 space-y-4">
	          <div className="flex items-center gap-2">
	            <ImageIcon className="h-4 w-4 text-purple-500" />
	            <span className="text-sm font-semibold text-slate-800">Screenshot Quality</span>
	          </div>

	          <div className="space-y-2">
	            <div className="flex items-center justify-between">
	              <span className="text-sm font-medium text-gray-700">Capture JPEG quality</span>
	              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
	                {config.screenshotJpegQuality}
	              </Badge>
	            </div>
	            <Slider
	              value={[config.screenshotJpegQuality]}
	              onValueChange={([value]) => onChange({ screenshotJpegQuality: value })}
	              min={50}
	              max={95}
	              step={5}
	              disabled={disabled}
	              className="cursor-pointer"
	            />
	            <div className="text-xs text-gray-400">Default: 80</div>
	          </div>

	          <div className="space-y-2">
	            <div className="flex items-center justify-between">
	              <span className="text-sm font-medium text-gray-700">Saved screenshot WebP quality</span>
	              <Badge variant="secondary" className="bg-slate-100 text-slate-700">
	                {config.screenshotWebpQuality}
	              </Badge>
	            </div>
	            <Slider
	              value={[config.screenshotWebpQuality]}
	              onValueChange={([value]) => onChange({ screenshotWebpQuality: value })}
	              min={40}
	              max={95}
	              step={5}
	              disabled={disabled}
	              className="cursor-pointer"
	            />
	            <div className="text-xs text-gray-400">Default: 75</div>
	          </div>

	        </div>

	        {/* Resource Usage Indicator */}
	        <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Estimated Resource Usage</span>
            <Badge variant="outline" className={
              config.concurrency > 10 ? 'border-red-300 text-red-700' :
                config.concurrency > 5 ? 'border-amber-300 text-amber-700' :
                  'border-green-300 text-green-700'
            }>
              {config.concurrency > 10 ? 'High' : config.concurrency > 5 ? 'Medium' : 'Low'}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 bg-white rounded-lg">
              <Cpu className="h-4 w-4 mx-auto text-gray-400 mb-1" />
              <div className="text-xs text-gray-500">CPU</div>
              <div className="text-sm font-semibold text-gray-700">
                ~{Math.min(100, config.concurrency * 8)}%
              </div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg">
              <Server className="h-4 w-4 mx-auto text-gray-400 mb-1" />
              <div className="text-xs text-gray-500">RAM</div>
              <div className="text-sm font-semibold text-gray-700">
                ~{config.browserInstances * 200}MB
              </div>
            </div>
            <div className="text-center p-2 bg-white rounded-lg">
              <Activity className="h-4 w-4 mx-auto text-gray-400 mb-1" />
              <div className="text-xs text-gray-500">Speed</div>
              <div className="text-sm font-semibold text-gray-700">
                ~{config.concurrency * 2}/min
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// Active Template Card
function ActiveTemplateCard({ template }: { template: TemplatePhase }) {
  const isActive = !['completed', 'failed', 'pending'].includes(template.phase);

  return (
    <div className={`p-3 rounded-xl border transition-all ${isActive
      ? 'bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200 shadow-sm'
      : template.phase === 'completed'
        ? 'bg-green-50/50 border-green-200'
        : template.phase === 'failed'
          ? 'bg-red-50/50 border-red-200'
          : 'bg-white border-gray-200'
      }`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isActive ? 'bg-white shadow-sm' : 'bg-gray-100'}`}>
          <PhaseIcon phase={template.phase} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 truncate">
            {template.name || template.slug}
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Badge variant="outline" className={`text-[10px] ${isActive ? 'border-blue-300 text-blue-600' : ''
              }`}>
              {formatPhase(template.phase)}
            </Badge>
            {isActive && template.elapsed > 0 && (
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" />
                {template.elapsed}s
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PreflightCheckTile({
  title,
  icon,
  ok,
  detail,
  secondary,
  error
}: {
  title: string;
  icon: ReactNode;
  ok: boolean | null;
  detail?: string | null;
  secondary?: string | null;
  error?: string | null;
}) {
  const statusClass = ok === null
    ? 'bg-slate-50 border-slate-200'
    : ok
      ? 'bg-green-50 border-green-200'
      : 'bg-red-50 border-red-200';
  const badgeClass = ok === null
    ? 'bg-slate-100 text-slate-600'
    : ok
      ? 'bg-green-100 text-green-700 border-green-200'
      : 'bg-red-100 text-red-700 border-red-200';
  const statusLabel = ok === null ? 'Not checked' : ok ? 'OK' : 'Failed';

  return (
    <div className={`p-4 rounded-xl border ${statusClass}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <span className="text-gray-500">{icon}</span>
          {title}
        </div>
        <Badge variant="outline" className={badgeClass}>{statusLabel}</Badge>
      </div>
      {detail && <div className="mt-2 text-xs text-gray-500 truncate" title={detail}>{detail}</div>}
      {secondary && <div className="mt-1 text-xs text-gray-500">{secondary}</div>}
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}

function TemplateConfirmationCard({ confirmations }: { confirmations: TemplateConfirmation[] }) {
  const recent = confirmations.slice(0, 120);
  const supabaseSaved = recent.filter(item => item.supabaseStatus === 'saved').length;
  const supabaseQueued = recent.filter(item => item.supabaseStatus === 'queued').length;
  const screenshotSaved = recent.filter(item => item.screenshotSaved).length;

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          Template Confirmations
        </h3>
        <div className="flex flex-wrap gap-2 justify-end">
          <Badge variant="outline" className="bg-slate-50">
            Recent: {recent.length}
          </Badge>
          <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700">
            Supabase ok: {supabaseSaved}
          </Badge>
          {supabaseQueued > 0 && (
            <Badge variant="outline" className="bg-slate-100 border-slate-200 text-slate-600">
              Supabase pending: {supabaseQueued}
            </Badge>
          )}
          <Badge variant="outline" className="bg-blue-50 border-blue-200 text-blue-700">
            Screenshots ok: {screenshotSaved}
          </Badge>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <ScrollArea className="h-[260px]">
          <div className="divide-y">
            {recent.map(item => (
              <div key={item.slug} className="px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-800 truncate">{item.name || item.slug}</div>
                    <div className="text-xs text-gray-500 truncate">{item.slug}</div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="flex items-center gap-1 text-xs">
                      {item.supabaseStatus === 'saved' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : item.supabaseStatus === 'failed' ? (
                        <XCircle className="h-3.5 w-3.5 text-red-600" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-slate-500" />
                      )}
                      <span
                        className={
                          item.supabaseStatus === 'saved'
                            ? 'text-green-700'
                            : item.supabaseStatus === 'failed'
                              ? 'text-red-700'
                              : 'text-slate-600'
                        }
                      >
                        Supabase
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs">
                      {item.screenshotSaved ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-600" />
                      )}
                      <span className={item.screenshotSaved ? 'text-blue-700' : 'text-red-700'}>
                        Screenshot
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(item.updatedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-4 text-xs text-gray-500">
                  <span className="truncate" title={item.screenshotPath || 'Screenshot missing'}>
                    {item.screenshotPath || 'Screenshot missing'}
                  </span>
                  {item.supabaseError && (
                    <span className="text-red-600 truncate" title={item.supabaseError}>
                      {item.supabaseError}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {recent.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500">No confirmations yet.</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}

// Lazy Screenshot Carousel - Only renders WINDOW_SIZE items at a time for performance
const CAROUSEL_WINDOW_SIZE = 20;

function LazyScreenshotCarousel({
  screenshots,
  onLoadMore,
  hasMore,
  isLoading
}: {
  screenshots: Screenshot[];
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  // windowStart is the index in the full screenshots array where our visible window begins
  const [windowStart, setWindowStart] = useState(0);
  // activeIndex is the currently focused item within the visible window
  const [activeIndexInWindow, setActiveIndexInWindow] = useState(0);

  // Calculate the visible window of screenshots
  const windowEnd = Math.min(windowStart + CAROUSEL_WINDOW_SIZE, screenshots.length);
  const visibleScreenshots = screenshots.slice(windowStart, windowEnd);

  // Check if we can navigate to newer (earlier in array) or older (later in array) screenshots
  const hasNewer = windowStart > 0;
  const hasOlder = windowEnd < screenshots.length || hasMore;

  // Reset window when screenshots change significantly (e.g., new scrape started)
  useEffect(() => {
    if (screenshots.length > 0 && windowStart >= screenshots.length) {
      setWindowStart(0);
      setActiveIndexInWindow(0);
    }
  }, [screenshots.length, windowStart]);

  // Auto-scroll to show newest screenshots when they arrive (only if at window start)
  useEffect(() => {
    if (windowStart === 0 && activeIndexInWindow === 0 && feedRef.current) {
      feedRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [screenshots.length, windowStart, activeIndexInWindow]);

  // Track scroll position within visible window
  useEffect(() => {
    const container = feedRef.current;
    if (!container) return;

    const handleScroll = () => {
      const children = Array.from(container.children) as HTMLElement[];
      if (children.length > 0) {
        const scrollLeft = container.scrollLeft;
        let nearestIdx = 0;
        let nearestDist = Infinity;
        for (let i = 0; i < children.length; i++) {
          const childLeft = children[i].offsetLeft;
          const dist = Math.abs(childLeft - scrollLeft);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
          }
        }
        setActiveIndexInWindow(nearestIdx);
      }
    };

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [visibleScreenshots.length]);

  // Scroll within current window
  const scrollToIndexInWindow = (index: number) => {
    const container = feedRef.current;
    if (!container) return;
    const children = container.children as HTMLCollectionOf<HTMLElement>;
    const clamped = Math.max(0, Math.min(index, children.length - 1));
    const child = children[clamped];
    if (child) {
      container.scrollTo({ left: child.offsetLeft, behavior: 'smooth' });
      setActiveIndexInWindow(clamped);
    }
  };

  // Load newer screenshots (move window towards start of array)
  const loadNewer = () => {
    const newStart = Math.max(0, windowStart - CAROUSEL_WINDOW_SIZE);
    setWindowStart(newStart);
    // Position at the end of the new window so user sees the transition point
    setTimeout(() => {
      if (feedRef.current) {
        const children = feedRef.current.children as HTMLCollectionOf<HTMLElement>;
        if (children.length > 0) {
          const lastChild = children[children.length - 1];
          feedRef.current.scrollTo({ left: lastChild.offsetLeft, behavior: 'auto' });
          setActiveIndexInWindow(children.length - 1);
        }
      }
    }, 50);
  };

  // Load older screenshots (move window towards end of array)
  const loadOlder = () => {
    // If we're at the edge and there's more data to fetch, trigger the fetch
    if (windowEnd >= screenshots.length && hasMore && !isLoading) {
      onLoadMore();
    }

    // Move window forward
    const newStart = Math.min(screenshots.length - 1, windowStart + CAROUSEL_WINDOW_SIZE);
    if (newStart < screenshots.length) {
      setWindowStart(newStart);
      // Position at the start of the new window
      setTimeout(() => {
        if (feedRef.current) {
          feedRef.current.scrollTo({ left: 0, behavior: 'auto' });
          setActiveIndexInWindow(0);
        }
      }, 50);
    }
  };

  if (screenshots.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        <Camera className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>Screenshots will appear here as they&apos;re captured...</p>
      </div>
    );
  }

  const globalActiveIndex = windowStart + activeIndexInWindow;

  return (
    <div className="relative">
      {/* Navigation Controls */}
      <div className="flex items-center gap-2 mb-3">
        {/* Load Newer Button */}
        {hasNewer && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadNewer}
            className="flex items-center gap-1 text-xs bg-blue-50 border-blue-200 hover:bg-blue-100 text-blue-700"
          >
            <ChevronLeft className="h-4 w-4" />
            Newer ({windowStart} more)
          </Button>
        )}

        <div className="flex-1" />

        {/* Window indicator */}
        <div className="text-xs text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
          Showing {windowStart + 1}-{windowEnd} of {screenshots.length}
          {hasMore && '+'}
        </div>

        <div className="flex-1" />

        {/* Load Older Button */}
        {hasOlder && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadOlder}
            disabled={isLoading}
            className="flex items-center gap-1 text-xs bg-purple-50 border-purple-200 hover:bg-purple-100 text-purple-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                Older ({screenshots.length - windowEnd}{hasMore ? '+' : ''} more)
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>

      {/* Carousel */}
      <div className="relative">
        {/* Arrow navigation within window */}
        {visibleScreenshots.length > 1 && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => scrollToIndexInWindow(activeIndexInWindow - 1)}
              disabled={activeIndexInWindow === 0}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white shadow-md rounded-full disabled:opacity-30"
            >
              <ChevronLeft className="h-5 w-5 text-gray-700" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => scrollToIndexInWindow(activeIndexInWindow + 1)}
              disabled={activeIndexInWindow >= visibleScreenshots.length - 1}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 bg-white/90 hover:bg-white shadow-md rounded-full disabled:opacity-30"
            >
              <ChevronRight className="h-5 w-5 text-gray-700" />
            </Button>
          </>
        )}

        <div
          ref={feedRef}
          className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory scroll-smooth px-10"
        >
          {visibleScreenshots.map((screenshot) => (
            <div
              key={screenshot.id}
              className="flex-shrink-0 w-64 group snap-start"
            >
              <div className="relative rounded-xl overflow-hidden shadow-lg hover:shadow-xl transition-shadow">
                <div className="relative w-64 aspect-[16/10] bg-gray-100">
                  {toAssetUrl(screenshot.screenshotPath || null) ? (
                    <Image
                      src={toAssetUrl(screenshot.screenshotPath || null)!}
                      alt={screenshot.name || screenshot.slug || 'Screenshot'}
                      fill
                      className="object-contain object-top"
                      unoptimized
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <ImageIcon className="h-8 w-8 text-gray-400" />
                    </div>
                  )}
                </div>
                {screenshot.isFeaturedAuthor && (
                  <div className="absolute top-2 right-2">
                    <Badge className="bg-amber-500 text-white text-[10px] px-1.5">
                      <Star className="h-3 w-3 mr-0.5" />
                      Featured
                    </Badge>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="text-white text-xs font-medium truncate">
                    {screenshot.name || screenshot.slug}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Position indicator */}
      <div className="mt-2 flex items-center justify-center gap-2">
        <div className="text-xs text-gray-500">
          {globalActiveIndex + 1} / {screenshots.length}
        </div>
        {/* Mini progress bar showing window position */}
        <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300"
            style={{
              width: `${(CAROUSEL_WINDOW_SIZE / screenshots.length) * 100}%`,
              marginLeft: `${(windowStart / screenshots.length) * 100}%`
            }}
          />
        </div>
      </div>
    </div>
  );
}

// Speed Indicator Component with Mini Graph
function SpeedIndicator({
  speedHistory,
  currentSpeed,
  totalCount,
  totalProcessed
}: {
  speedHistory: number[];
  currentSpeed: number;
  totalCount?: number;
  totalProcessed?: number;
}) {
  const maxSpeed = Math.max(...speedHistory, currentSpeed, 1);
  const graphHeight = 60;
  const remaining = totalCount && totalProcessed !== undefined
    ? Math.max(totalCount - totalProcessed, 0)
    : null;
  const etaSeconds = remaining !== null && currentSpeed > 0
    ? Math.round((remaining / currentSpeed) * 60)
    : 0;
  const totalSecondsAtSpeed = totalCount && currentSpeed > 0
    ? Math.round((totalCount / currentSpeed) * 60)
    : 0;

  return (
    <Card className="p-4 bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-500 rounded-lg">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-semibold text-emerald-800">Scraping Speed</span>
            <p className="text-xs text-emerald-600">Templates per minute</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-emerald-600">
            {currentSpeed.toFixed(1)}
          </div>
          <div className="text-xs text-emerald-500">/min</div>
          {remaining !== null && currentSpeed > 0 && (
            <div className="text-[11px] text-emerald-700 mt-1">
              ~{formatTime(etaSeconds)} to finish
              {totalSecondsAtSpeed > 0 && (
                <span className="text-emerald-600"> (≈{formatTime(totalSecondsAtSpeed)} total)</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mini bar chart */}
      <div className="mt-2 flex items-end gap-[2px] h-[60px] bg-white/50 rounded-lg p-2">
        {speedHistory.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-emerald-400 text-xs">
            Collecting data...
          </div>
        ) : (
          speedHistory.map((speed, idx) => {
            const height = maxSpeed > 0 ? (speed / maxSpeed) * (graphHeight - 16) : 0;
            const isLast = idx === speedHistory.length - 1;
            return (
              <div
                key={idx}
                className={`flex-1 rounded-t transition-all duration-300 ${
                  isLast
                    ? 'bg-gradient-to-t from-emerald-500 to-emerald-400'
                    : 'bg-gradient-to-t from-emerald-300 to-emerald-200'
                }`}
                style={{
                  height: `${Math.max(height, 2)}px`,
                  minWidth: '4px'
                }}
                title={`${speed.toFixed(1)}/min`}
              />
            );
          })
        )}
      </div>

      {/* Speed stats */}
      <div className="mt-2 flex justify-between text-xs text-emerald-600">
        <span>Avg: {speedHistory.length > 0 ? (speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length).toFixed(1) : '0'}/min</span>
        <span>Peak: {Math.max(...speedHistory, 0).toFixed(1)}/min</span>
      </div>
    </Card>
  );
}

// Progress Stats Component
function ProgressStats({
  state,
  estimatedSeconds
}: {
  state: FreshScrapeState;
  estimatedSeconds: number;
}) {
  const totalProcessed = state.featured_processed + state.regular_processed;
  const totalCount = state.featured_total + state.regular_total;
  const totalSuccessful = state.featured_successful + state.regular_successful;
  const totalFailed = state.featured_failed + state.regular_failed;
  const overallProgress = totalCount > 0 ? (totalProcessed / totalCount) * 100 : 0;

  const isFeaturedPhase = state.phase === 'featured_scrape';
  const currentPhaseProcessed = isFeaturedPhase ? state.featured_processed : state.regular_processed;
  const currentPhaseTotal = isFeaturedPhase ? state.featured_total : state.regular_total;
  const currentPhaseProgress = currentPhaseTotal > 0 ? (currentPhaseProcessed / currentPhaseTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <div className="p-6 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Overall Progress</h3>
            <p className="text-white/80 text-sm">
              {totalProcessed.toLocaleString()} of {totalCount.toLocaleString()} templates
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{Math.round(overallProgress)}%</div>
            {estimatedSeconds > 0 && (
              <div className="text-white/80 text-sm flex items-center gap-1 justify-end">
                <Timer className="h-4 w-4" />
                ~{formatTime(estimatedSeconds)} remaining
              </div>
            )}
          </div>
        </div>
        <Progress value={overallProgress} className="h-3 bg-white/20" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-white rounded-xl border shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Database className="h-4 w-4" />
            <span className="text-xs font-medium">Total</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">{totalCount.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-white rounded-xl border shadow-sm">
          <div className="flex items-center gap-2 text-blue-500 mb-2">
            <Activity className="h-4 w-4" />
            <span className="text-xs font-medium">Processed</span>
          </div>
          <div className="text-2xl font-bold text-blue-600">{totalProcessed.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-green-50 rounded-xl border border-green-200">
          <div className="flex items-center gap-2 text-green-500 mb-2">
            <CheckCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Successful</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{totalSuccessful.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-red-50 rounded-xl border border-red-200">
          <div className="flex items-center gap-2 text-red-500 mb-2">
            <XCircle className="h-4 w-4" />
            <span className="text-xs font-medium">Failed</span>
          </div>
          <div className="text-2xl font-bold text-red-600">{totalFailed.toLocaleString()}</div>
        </div>
      </div>

      {/* Current Phase Progress */}
      <div className="p-4 bg-white rounded-xl border shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {isFeaturedPhase ? (
              <>
                <Star className="h-5 w-5 text-amber-500" />
                <span className="font-medium text-gray-700">Featured Author Templates</span>
              </>
            ) : (
              <>
                <Layers className="h-5 w-5 text-blue-500" />
                <span className="font-medium text-gray-700">Regular Templates</span>
              </>
            )}
          </div>
          <span className="text-sm text-gray-500">
            {currentPhaseProcessed} / {currentPhaseTotal}
          </span>
        </div>
        <Progress
          value={currentPhaseProgress}
          className={`h-2 ${isFeaturedPhase ? 'bg-amber-100' : 'bg-blue-100'}`}
        />
      </div>
    </div>
  );
}

// Real-Time Metrics Panel - shows ACTUAL scraper state (foolproof)
function RealTimeMetricsPanel({
  realTimeState,
  configuredState,
  onResumeTimeout
}: {
  realTimeState: RealTimeState | null;
  configuredState: FreshScrapeConfig;
  onResumeTimeout?: () => void;
}) {
  const hasDiscrepancy = realTimeState && (
    realTimeState.activeBrowsers !== realTimeState.configuredBrowserInstances ||
    realTimeState.pendingBrowserRestart
  );

  const isTimeoutPaused = realTimeState?.isTimeoutPaused;

  return (
    <Card className={`p-4 ${isTimeoutPaused ? 'border-red-300 bg-red-50/50' : hasDiscrepancy ? 'border-amber-300 bg-amber-50/50' : 'border-green-200 bg-green-50/30'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className={`h-5 w-5 ${isTimeoutPaused ? 'text-red-600' : hasDiscrepancy ? 'text-amber-600' : 'text-green-600'}`} />
          <span className="font-semibold text-gray-800">Live Scraper Metrics</span>
        </div>
        {hasDiscrepancy && !isTimeoutPaused && (
          <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-700 text-xs">
            Config Pending
          </Badge>
        )}
      </div>

      {/* Timeout Pause Alert */}
      {isTimeoutPaused && (
        <div className="mb-4 p-4 bg-red-100 border border-red-200 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-200 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h4 className="font-semibold text-red-800">Auto-Paused Due to Timeouts</h4>
                <p className="text-sm text-red-700">
                  {realTimeState.consecutiveTimeouts} consecutive timeouts, {realTimeState.pausedUrlCount} URLs paused
                </p>
              </div>
            </div>
            {onResumeTimeout && (
              <Button
                onClick={onResumeTimeout}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <Play className="h-4 w-4 mr-2" />
                Resume & Retry
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Active Browsers - ACTUAL */}
        <div className="p-3 bg-white rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-gray-500">Active Browsers</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-blue-600">
              {realTimeState?.activeBrowsers ?? configuredState.browserInstances}
            </span>
            {realTimeState && realTimeState.activeBrowsers !== realTimeState.configuredBrowserInstances && (
              <span className="text-xs text-amber-600">
                (→{realTimeState.configuredBrowserInstances})
              </span>
            )}
          </div>
        </div>

        {/* Pages In Use - ACTUAL */}
        <div className="p-3 bg-white rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-gray-500">Pages In Use</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-600">
              {realTimeState?.totalPagesInUse ?? 0}
            </span>
            <span className="text-xs text-gray-400">
              /{realTimeState?.maxPagesCapacity ?? configuredState.browserInstances * configuredState.pagesPerBrowser}
            </span>
          </div>
        </div>

        {/* Concurrency - ACTUAL */}
        <div className="p-3 bg-white rounded-lg border shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-xs text-gray-500">Concurrency</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600">
              {realTimeState?.configuredConcurrency ?? configuredState.concurrency}
            </span>
            {realTimeState && (
              <span className="text-xs text-gray-400">
                ({realTimeState.semaphoreAvailable} avail)
              </span>
            )}
          </div>
        </div>

        {/* Timeout Count */}
        <div className={`p-3 rounded-lg border shadow-sm ${(realTimeState?.timeoutCount || 0) > 0 ? 'bg-red-50 border-red-200' : 'bg-white'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Timer className={`h-4 w-4 ${(realTimeState?.timeoutCount || 0) > 0 ? 'text-red-500' : 'text-gray-400'}`} />
            <span className="text-xs text-gray-500">Timeouts</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${(realTimeState?.timeoutCount || 0) > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {realTimeState?.timeoutCount ?? 0}
            </span>
            {(realTimeState?.consecutiveTimeouts || 0) > 0 && (
              <span className="text-xs text-red-500">
                ({realTimeState?.consecutiveTimeouts} in a row)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Status Indicators */}
      <div className="mt-3 flex flex-wrap gap-2">
        {realTimeState?.pendingBrowserRestart && (
          <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-700 animate-pulse">
            <RefreshCw className="h-3 w-3 mr-1" />
            Browser restart pending
          </Badge>
        )}
        {realTimeState?.isPaused && !isTimeoutPaused && (
          <Badge variant="outline" className="bg-yellow-100 border-yellow-300 text-yellow-700">
            <Pause className="h-3 w-3 mr-1" />
            Paused
          </Badge>
        )}
        {isTimeoutPaused && (
          <Badge variant="outline" className="bg-red-100 border-red-300 text-red-700 animate-pulse">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Timeout Paused
          </Badge>
        )}
        {(realTimeState?.pausedUrlCount ?? 0) > 0 && (
          <Badge variant="outline" className="bg-orange-100 border-orange-300 text-orange-700">
            <Clock className="h-3 w-3 mr-1" />
            {realTimeState?.pausedUrlCount} URLs queued for retry
          </Badge>
        )}
        {!realTimeState && (
          <Badge variant="outline" className="bg-gray-100 border-gray-300 text-gray-500">
            <Clock className="h-3 w-3 mr-1" />
            Awaiting scraper data...
          </Badge>
        )}
        {realTimeState && !realTimeState.isPaused && !realTimeState.isStopped && !isTimeoutPaused && (
          <Badge variant="outline" className="bg-green-100 border-green-300 text-green-700">
            <Activity className="h-3 w-3 mr-1 animate-pulse" />
            Running
          </Badge>
        )}
      </div>
    </Card>
  );
}

// Main Component
export function FreshScraperSection() {
  const { resolveAuthToken, loadStats } = useAdmin();

  // State
  const [scrapeState, setScrapeState] = useState<FreshScrapeState | null>(null);
  const [pausedState, setPausedState] = useState<FreshScrapeState | null>(null);
  const [pausedLastScreenshot, setPausedLastScreenshot] = useState<LastScreenshotInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
	  const [config, setConfig] = useState<FreshScrapeConfig>({
	    concurrency: 5,
	    browserInstances: 2,
	    pagesPerBrowser: 5,
	    batchSize: 10,
	    timeout: 45000,
	    screenshotAnimationWaitMs: 3000,
	    screenshotNudgeScrollRatio: 0.2,
	    screenshotNudgeWaitMs: 500,
	    screenshotNudgeAfterMs: 500,
	    screenshotStabilityStableMs: 1000,
	    screenshotStabilityMaxWaitMs: 7000,
	    screenshotStabilityCheckIntervalMs: 250,
	    screenshotJpegQuality: 80,
	    screenshotWebpQuality: 75
	  });
  const [currentBatch, setCurrentBatch] = useState<TemplatePhase[]>([]);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [screenshotsHasMore, setScreenshotsHasMore] = useState(true);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: string; message: string }>>([]);
  const [estimatedSeconds, setEstimatedSeconds] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [realTimeState, setRealTimeState] = useState<RealTimeState | null>(null);
  const [executorIsRunning, setExecutorIsRunning] = useState(false);
  const [executorProgress, setExecutorProgress] = useState<ExecutorProgress | null>(null);
  const [supabaseWriteState, setSupabaseWriteState] = useState<SupabaseWriteState | null>(null);
  const [templateConfirmations, setTemplateConfirmations] = useState<TemplateConfirmation[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [newTemplateDiscovery, setNewTemplateDiscovery] = useState<NewTemplateDiscoveryState>({
    phase: 'idle',
    totalInSitemap: 0,
    existingInDb: 0,
    missingCount: 0,
    updatedCount: 0,
    toScrapeCount: 0,
    missingTemplates: [],
    error: null
  });

  // Speed tracking
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const lastProcessedRef = useRef<{ count: number; time: number } | null>(null);
  const speedSampleRef = useRef<number[]>([]);
  const screenshotsLoadingRef = useRef(false);
  const scrapeStateRef = useRef<FreshScrapeState | null>(null);
  const executorIsRunningRef = useRef(false);
  const executorProgressRef = useRef<ExecutorProgress | null>(null);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const pollInFlightRef = useRef(false);
  useEffect(() => {
    scrapeStateRef.current = scrapeState;
  }, [scrapeState]);
  useEffect(() => {
    executorIsRunningRef.current = executorIsRunning;
  }, [executorIsRunning]);
  useEffect(() => {
    executorProgressRef.current = executorProgress;
  }, [executorProgress]);

  // Fetch initial state
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/admin/fresh-scrape?action=status', {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });
        if (response.ok) {
          const data = await response.json();
	          if (data.activeState) {
		            setScrapeState(data.activeState);
		            if (data.activeState.config) {
		              try {
		                const parsed = JSON.parse(data.activeState.config) as Partial<FreshScrapeConfig>;
		                setConfig(prev => ({ ...prev, ...parsed }));
		              } catch {
		                // Ignore invalid config JSON
		              }
		            }
		          }
          if (data.pausedState) {
            setPausedState(data.pausedState);
          }
          setPausedLastScreenshot(data.pausedLastScreenshot || null);
        }
      } catch (error) {
        console.error('Failed to fetch status:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchStatus();
  }, [resolveAuthToken]);

  // Polling for active scrape
  const scrapeStateId = scrapeState?.id;
  const scrapeStateStatus = scrapeState?.status;

  useEffect(() => {
    if (!scrapeStateId) {
      setTemplateConfirmations([]);
    }
  }, [scrapeStateId]);

  const mapScreenshotRow = (row: ScreenshotRow): Screenshot => ({
    id: row.id,
    name: row.template_name,
    slug: row.template_slug,
    screenshotPath: row.screenshot_path ?? row.screenshot_thumbnail_path ?? (row.template_slug ? `/screenshots/${row.template_slug}.webp` : null),
    isFeaturedAuthor: !!row.is_featured_author,
    capturedAt: row.captured_at
  });

  const loadScreenshotsPage = useCallback(async (offset: number, append: boolean) => {
    if (!scrapeStateId || screenshotsLoadingRef.current) return;
    screenshotsLoadingRef.current = true;
    setScreenshotsLoading(true);
    try {
      const res = await fetch(
        `/api/admin/fresh-scrape?action=screenshots&stateId=${scrapeStateId}&limit=50&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${resolveAuthToken()}` } }
      );
      if (!res.ok) return;
      const data: { screenshots: ScreenshotRow[]; hasMore: boolean } = await res.json();
      const mapped = (data.screenshots || []).map(mapScreenshotRow);

      setScreenshots(prev => {
        if (!append) {
          const byId = new Map(prev.map(s => [s.id, s]));
          for (const s of mapped) byId.set(s.id, s);
          return Array.from(byId.values()).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
        }
        const ids = new Set(prev.map(s => s.id));
        const next = [...prev];
        for (const s of mapped) {
          if (!ids.has(s.id)) next.push(s);
        }
        return next;
      });

      setScreenshotsHasMore(!!data.hasMore);
    } catch {
      // Ignore screenshot load errors
    } finally {
      screenshotsLoadingRef.current = false;
      setScreenshotsLoading(false);
    }
  }, [scrapeStateId, resolveAuthToken]);

  const loadMoreScreenshots = useCallback(() => {
    if (!scrapeStateId) return;
    loadScreenshotsPage(screenshots.length, true);
  }, [scrapeStateId, screenshots.length, loadScreenshotsPage]);

  // Initial screenshots load when a state becomes active/changes
  useEffect(() => {
    if (!scrapeStateId) return;
    setScreenshots([]);
    setScreenshotsHasMore(true);
    loadScreenshotsPage(0, false);
  }, [scrapeStateId, loadScreenshotsPage]);

	  useEffect(() => {
	    if (!scrapeStateId || !scrapeStateStatus || ['completed', 'failed', 'idle'].includes(scrapeStateStatus)) {
	      // Reset speed tracking when scrape is not active
	      lastProcessedRef.current = null;
	      speedSampleRef.current = [];
	      return;
	    }

	    const poll = async () => {
	      try {
	        if (pollInFlightRef.current) return;
	        pollInFlightRef.current = true;
	        const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
	          const controller = new AbortController();
	          const id = setTimeout(() => controller.abort(), timeoutMs);
	          try {
	            return await fetch(url, { ...options, signal: controller.signal });
	          } finally {
	            clearTimeout(id);
	          }
	        };

	        const headers = { 'Authorization': `Bearer ${resolveAuthToken()}` };
	        const progressUrl = `/api/admin/fresh-scrape?action=progress&stateId=${scrapeStateId}`;
	        const eventsUrl = '/api/admin/fresh-scrape/execute?action=events';

	        let nextBaseState: FreshScrapeState | null = null;
	        let nextExecutorIsRunning = executorIsRunningRef.current;
	        let nextExecutorProgress = executorProgressRef.current;

	        const [progressResult, eventsResult] = await Promise.allSettled([
	          fetchWithTimeout(progressUrl, { headers }, 8000),
	          fetchWithTimeout(eventsUrl, { headers }, 8000)
	        ]);

	        if (progressResult.status === 'fulfilled' && progressResult.value.ok) {
	          const data = await progressResult.value.json();
	          if (data?.state) {
	            nextBaseState = data.state as FreshScrapeState;
	            setScrapeState(nextBaseState);
	            setEstimatedSeconds(data.estimatedSecondsRemaining || 0);
	          }
	        }

	        if (eventsResult.status === 'fulfilled' && eventsResult.value.ok) {
	          const events = await eventsResult.value.json();
	          nextExecutorIsRunning = !!events.isRunning;
	          nextExecutorProgress = (events.progress || null) as ExecutorProgress | null;
          setExecutorIsRunning(nextExecutorIsRunning);
          setExecutorProgress(nextExecutorProgress);
          setCurrentBatch(events.currentBatch || []);
          setLogs(events.logs || []);
          setSupabaseWriteState((events.supabase || null) as SupabaseWriteState | null);
          setTemplateConfirmations((events.templateConfirmations || []) as TemplateConfirmation[]);
          if (events.realTimeState) {
            setRealTimeState(events.realTimeState);
          }
	        }

	        // Calculate speed using persisted + in-flight progress (keeps chart live within a batch).
	        const baseState = nextBaseState ?? scrapeStateRef.current;
	        const inFlight = nextExecutorIsRunning ? nextExecutorProgress : null;
	        if (baseState) {
	          const displayState = applyInFlightProgress(baseState, inFlight, nextExecutorIsRunning);
	          const currentProcessed = (displayState.featured_processed || 0) + (displayState.regular_processed || 0);
	          const now = Date.now();

	          if (lastProcessedRef.current) {
	            const timeDiffMinutes = (now - lastProcessedRef.current.time) / 60000;
	            const processedDiff = currentProcessed - lastProcessedRef.current.count;

	            if (timeDiffMinutes > 0 && processedDiff >= 0) {
	              const instantSpeed = processedDiff / timeDiffMinutes;
	              speedSampleRef.current.push(instantSpeed);
	              if (speedSampleRef.current.length > 10) {
	                speedSampleRef.current.shift();
	              }

	              const smoothedSpeed = speedSampleRef.current.reduce((a, b) => a + b, 0) / speedSampleRef.current.length;
	              setCurrentSpeed(smoothedSpeed);

	              if (speedSampleRef.current.length % 5 === 0) {
	                setSpeedHistory(prev => [...prev, smoothedSpeed].slice(-30));
	              }
	            }
	          }

	          lastProcessedRef.current = { count: currentProcessed, time: now };
	        }

	        // Refresh latest screenshots page for live feed
	        if (scrapeStateId) {
	          loadScreenshotsPage(0, false);
	        }
	      } catch (error) {
	        console.error('Polling error:', error);
	      } finally {
	        pollInFlightRef.current = false;
	      }
	    };

    poll();
    pollingRef.current = setInterval(poll, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [scrapeStateId, scrapeStateStatus, resolveAuthToken, loadScreenshotsPage]);

  const checkForNewTemplates = async () => {
    setNewTemplateDiscovery({
      phase: 'checking',
      totalInSitemap: 0,
      existingInDb: 0,
      missingCount: 0,
      updatedCount: 0,
      toScrapeCount: 0,
      missingTemplates: [],
      error: null
    });

    try {
      const response = await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'check_new' })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to check for new templates');
      }

      const data = await response.json();
      const discovery = data.discovery;
      const templates = (discovery?.templates || discovery?.missingTemplates || []) as Array<{ url: string; slug: string; displayName: string; reason?: 'missing' | 'updated'; lastmod?: string | null }>;

      setNewTemplateDiscovery({
        phase: 'checked',
        totalInSitemap: discovery.totalInSitemap || 0,
        existingInDb: discovery.existingInDb || 0,
        missingCount: discovery.missingCount || 0,
        updatedCount: discovery.updatedCount || 0,
        toScrapeCount: discovery.toScrapeCount || 0,
        missingTemplates: templates || [],
        error: null
      });

      if ((discovery.toScrapeCount || 0) > 0) {
        toast.success(`Found ${discovery.toScrapeCount} template${discovery.toScrapeCount === 1 ? '' : 's'} to scrape`);
      } else {
        toast.info('No missing/updated templates found');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for new templates';
      setNewTemplateDiscovery(prev => ({ ...prev, phase: 'error', error: message }));
      toast.error(message);
    }
  };

  const runPreflight = async (): Promise<boolean> => {
    if (preflightLoading) return false;
    setPreflightLoading(true);
    setPreflightError(null);
    try {
      const response = await fetch('/api/admin/fresh-scrape?action=preflight', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Preflight checks failed');
      }
      const data = await response.json();
      setPreflight(data);
      if (data?.ok) {
        toast.success('Preflight checks passed');
      } else {
        toast.error('Preflight checks failed');
      }
      return !!data?.ok;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to run preflight checks';
      setPreflightError(message);
      toast.error(message);
      return false;
    } finally {
      setPreflightLoading(false);
    }
  };

  const ensurePreflight = async (): Promise<boolean> => {
    if (preflight?.ok) return true;
    if (preflightLoading) {
      toast.info('Preflight checks are already running.');
      return false;
    }
    return runPreflight();
  };

  const startMissingTemplateScrape = async () => {
    if (newTemplateDiscovery.toScrapeCount === 0) return;
    if (!confirm(`Scrape ${newTemplateDiscovery.toScrapeCount} template${newTemplateDiscovery.toScrapeCount === 1 ? '' : 's'} now? (missing: ${newTemplateDiscovery.missingCount}, updated: ${newTemplateDiscovery.updatedCount})`)) {
      return;
    }

    try {
      const ready = await ensurePreflight();
      if (!ready) return;
      const response = await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'start_update',
          totalSitemapCount: newTemplateDiscovery.totalInSitemap,
          includeUpdates: true,
          config
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to start update scrape');
      }

      const data = await response.json();
      if (data.state) {
        setScrapeState(data.state);
        await executeBatches(data.state);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start update scrape';
      toast.error(message);
    }
  };

  const startRescreenshotAll = async (options?: { wipeImages?: boolean }) => {
    const wipeImages = options?.wipeImages !== false;

    if (wipeImages) {
      const confirmText = window.prompt(
        'This will delete ALL files in public/screenshots on the running server before re-capturing screenshots.\n\nType WIPE_SCREENSHOTS to confirm.'
      );
      if (confirmText !== 'WIPE_SCREENSHOTS') return;
    } else {
      if (!window.confirm('Re-capture screenshots for all templates without deleting existing files first?')) return;
    }

    try {
      const ready = await ensurePreflight();
      if (!ready) return;
      const response = await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'start_rescreenshot_all',
          wipeImages,
          confirm: wipeImages ? 'WIPE_SCREENSHOTS' : undefined,
          config
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to start rescreenshot-all');
      }

      const data = await response.json();
      if (data.state) {
        setScrapeState(data.state);
        await executeBatches(data.state);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start rescreenshot-all';
      toast.error(message);
    }
  };

  const startFreshScrape = async () => {
    const confirmText = window.prompt(
      'DANGER: This will delete ALL templates in Supabase (plus related metadata tables) and wipe ALL screenshot files on the running server.\n\nType DELETE_ALL to confirm.'
    );
    if (confirmText !== 'DELETE_ALL') return;

    try {
      const ready = await ensurePreflight();
      if (!ready) return;
      const response = await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          action: 'start_fresh',
          confirm: 'DELETE_ALL',
          config
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to start fresh scrape');
      }

      const data = await response.json();
      if (data.state) {
        setScrapeState(data.state);
        await executeBatches(data.state);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start fresh scrape';
      toast.error(message);
    }
  };

  // Execute batches
  const executeBatches = async (state: FreshScrapeState) => {
    setIsExecuting(true);

    try {
      const ready = await ensurePreflight();
      if (!ready) return;
      let urls: string[] = [];
	      const rawUrls: unknown = (state as unknown as { regular_template_urls?: unknown }).regular_template_urls;
	      if (Array.isArray(rawUrls)) {
	        urls = rawUrls.filter((u): u is string => typeof u === 'string');
	      } else if (typeof rawUrls === 'string' && rawUrls) {
	        try {
	          urls = JSON.parse(rawUrls) as string[];
	        } catch {
	          urls = [];
	        }
	      }

      if (urls.length === 0) {
        toast.info('No templates to scrape');
        return;
      }
      // Resume from persisted progress so batch size can change safely mid-scrape.
      let offset = Math.max(0, state.regular_processed || 0);

      while (offset < urls.length) {
        // Stop if DB says we're paused/cancelled/completed
        const statusResponse = await fetch('/api/admin/fresh-scrape?action=status', {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });

        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          const active = statusData.activeState as FreshScrapeState | null;
          const paused = statusData.pausedState as FreshScrapeState | null;

          if (paused?.id === state.id && paused.status === 'paused') {
            toast.info('Scrape paused');
            break;
          }

          if (!active && !paused) {
            toast.info('Scrape is no longer active');
            break;
          }

          if (active?.id === state.id) {
            setScrapeState(active);
            offset = Math.max(offset, active.regular_processed || 0);
          }
        }

        // If a batch is already running (e.g. resumed mid-batch), wait for it to finish.
        const execStatusResponse = await fetch('/api/admin/fresh-scrape/execute?action=status', {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });
        if (execStatusResponse.ok) {
          const execStatus = await execStatusResponse.json();
          if (execStatus.isRunning) {
            await waitForBatchCompletion();
            continue;
          }
        }

        const nextBatchSize = Math.max(1, config.batchSize);
        const batchUrls = urls.slice(offset, offset + nextBatchSize);
        if (batchUrls.length === 0) break;

        const batchResponse = await fetch('/api/admin/fresh-scrape/execute', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resolveAuthToken()}`
          },
          body: JSON.stringify({
            action: 'start_batch',
            stateId: state.id,
            batchUrls,
            isFeatured: false,
            config
          })
        });

        if (!batchResponse.ok) {
          let message = 'Batch execution failed';
          try {
            const data = await batchResponse.json();
            message = data?.error || message;
          } catch {
            // Ignore
          }
          throw new Error(message);
        }

        await waitForBatchCompletion();

        // Refresh persisted progress after each batch.
        const progressResponse = await fetch(
          `/api/admin/fresh-scrape?action=progress&stateId=${state.id}`,
          { headers: { 'Authorization': `Bearer ${resolveAuthToken()}` } }
        );
        if (progressResponse.ok) {
          const progressData = await progressResponse.json();
          if (progressData?.state) {
            setScrapeState(progressData.state);
            offset = Math.max(offset, progressData.state.regular_processed || 0);
          } else {
            offset += batchUrls.length;
          }
        } else {
          offset += batchUrls.length;
        }
      }

      if (offset >= urls.length) {
        await fetch('/api/admin/fresh-scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resolveAuthToken()}`
          },
          body: JSON.stringify({ action: 'complete', stateId: state.id })
        });

        toast.success('Fresh scrape completed!');
        loadStats();
      }

    } catch (error) {
      console.error('Batch execution error:', error);
      toast.error('Batch execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  // Wait for batch completion
  const waitForBatchCompletion = async () => {
    return new Promise<void>((resolve) => {
      const checkStatus = async () => {
        const response = await fetch('/api/admin/fresh-scrape/execute?action=status', {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });

        if (response.ok) {
          const data = await response.json();
          if (!data.isRunning) {
            resolve();
            return;
          }
        }

        setTimeout(checkStatus, 2000);
      };

      checkStatus();
    });
  };

  // Pause scrape
  const pauseScrape = async () => {
    try {
      // Pause state
      await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'pause' })
      });

      // Pause execution
      await fetch('/api/admin/fresh-scrape/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'pause' })
      });

      toast.success('Scrape paused - can be resumed later');
    } catch {
      toast.error('Failed to pause');
    }
  };

  // Resume scrape
  const resumeScrape = async () => {
    try {
      const response = await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'resume' })
      });

      let nextState: FreshScrapeState | null = null;
      if (response.ok) {
        const data = await response.json();
        nextState = data.state || null;
        setScrapeState(nextState);
        setPausedState(null);
      }

      // Resume any in-progress/paused batch executor (if present).
      await fetch('/api/admin/fresh-scrape/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'resume' })
      }).catch(() => {});

      if (isExecuting) {
        toast.success('Scrape resumed');
        return;
      }

      if (nextState) {
        await executeBatches(nextState);
        toast.success('Scrape resumed');
      }
    } catch {
      toast.error('Failed to resume');
    }
  };

  // Begin scrape (manual start after discovery)
  const beginScrape = async () => {
    if (!scrapeState) return;
    const ready = await ensurePreflight();
    if (!ready) return;
    try {
      // Ensure backend has latest config before first batch
      await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'update_config', config })
      });
      await fetch('/api/admin/fresh-scrape/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'update_config', config })
      });
    } catch {
      // Ignore config sync errors
    }

    await executeBatches(scrapeState);
  };

  // Stop scrape
  const stopScrape = async () => {
    if (!confirm('Are you sure you want to stop the scrape? Progress has been saved and can be resumed.')) {
      return;
    }

    try {
      await fetch('/api/admin/fresh-scrape/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'stop' })
      });

      await fetch('/api/admin/fresh-scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'cancel' })
      });

      setScrapeState(null);
      setRealTimeState(null); // Clear real-time state
      toast.success('Scrape stopped');
      loadStats();
    } catch {
      toast.error('Failed to stop');
    }
  };

  // Resume from timeout pause
  const resumeTimeoutPaused = async () => {
    try {
      await fetch('/api/admin/fresh-scrape/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ action: 'resume_timeout' })
      });
      toast.success('Resuming from timeout pause - URLs will be retried');
    } catch {
      toast.error('Failed to resume from timeout');
    }
  };

  // Update config
  const updateConfig = async (updates: Partial<FreshScrapeConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);

    if (scrapeState && !['completed', 'failed', 'idle'].includes(scrapeState.status)) {
      // Update live config
      try {
        await fetch('/api/admin/fresh-scrape', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resolveAuthToken()}`
          },
          body: JSON.stringify({ action: 'update_config', config: newConfig })
        });

	        await fetch('/api/admin/fresh-scrape/execute', {
	          method: 'POST',
	          headers: {
	            'Content-Type': 'application/json',
	            'Authorization': `Bearer ${resolveAuthToken()}`
	          },
	          body: JSON.stringify({ action: 'update_config', config: newConfig })
	        });
	
	        const screenshotKeys: Array<keyof FreshScrapeConfig> = [
	          'screenshotAnimationWaitMs',
	          'screenshotNudgeScrollRatio',
	          'screenshotNudgeWaitMs',
	          'screenshotNudgeAfterMs',
	          'screenshotStabilityStableMs',
	          'screenshotStabilityMaxWaitMs',
	          'screenshotStabilityCheckIntervalMs',
	          'screenshotJpegQuality',
	          'screenshotWebpQuality'
	        ];
	        const hasScreenshotUpdates = screenshotKeys.some(k => updates[k] !== undefined);

	        if (updates.browserInstances !== undefined) {
	          toast.success('Browser count will update when current pages finish');
	        } else if (updates.concurrency !== undefined) {
	          toast.success('Concurrency change applied immediately');
	        } else if (hasScreenshotUpdates) {
	          toast.success('Screenshot settings apply immediately');
	        } else {
	          toast.success('Config will apply to next batch');
	        }
	      } catch {
	        // Ignore
      }
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
      </div>
    );
  }

	  // Active scrape - Control Center View
	  if (scrapeState && !['completed', 'failed', 'idle'].includes(scrapeState.status) && scrapeState.phase !== 'none') {
	    const displayScrapeState = applyInFlightProgress(scrapeState, executorProgress, executorIsRunning);
	    const totalProcessed = (displayScrapeState.featured_processed || 0) + (displayScrapeState.regular_processed || 0);
	    const totalCount = (displayScrapeState.featured_total || 0) + (displayScrapeState.regular_total || 0);
	    const isScrapePhase = scrapeState.status === 'scraping_featured' || scrapeState.status === 'scraping_regular';
	    const isActuallyRunning = executorIsRunning && !!realTimeState && !realTimeState.isPaused && !realTimeState.isStopped && !realTimeState.isTimeoutPaused;
	    const isReadyToBegin = isScrapePhase && totalProcessed === 0 && !isActuallyRunning && scrapeState.status !== 'paused';
	    const hasRemainingWork = totalCount > totalProcessed;
	    const isInterrupted = isScrapePhase && hasRemainingWork && !executorIsRunning && scrapeState.status !== 'paused' && !isExecuting;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl shadow-lg">
              <Activity className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Scrape Control Center</h1>
              <p className="text-gray-500">
                {scrapeState.status === 'paused' ? 'Paused' : 'Live monitoring and controls'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isInterrupted && (
              <Button
                onClick={beginScrape}
                disabled={isExecuting}
                className="bg-green-600 hover:bg-green-700"
              >
                <Play className="h-4 w-4 mr-2" />
                Continue
              </Button>
            )}
            {isReadyToBegin && (
              <Button
                onClick={beginScrape}
                disabled={isExecuting}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Play className="h-4 w-4 mr-2" />
                Begin scrape
              </Button>
            )}
            {scrapeState.status === 'paused' ? (
              <Button
                onClick={resumeScrape}
                className="bg-green-600 hover:bg-green-700"
              >
                <Play className="h-4 w-4 mr-2" />
                Resume
              </Button>
            ) : executorIsRunning && !isReadyToBegin ? (
              <Button
                variant="outline"
                onClick={pauseScrape}
              >
                <Pause className="h-4 w-4 mr-2" />
                Pause
              </Button>
            ) : null}
            <Button
              variant="destructive"
              onClick={stopScrape}
            >
              <StopCircle className="h-4 w-4 mr-2" />
              Stop
            </Button>
          </div>
        </div>

	        {/* Progress Stats */}
	        <ProgressStats state={displayScrapeState} estimatedSeconds={estimatedSeconds} />

        {/* Speed Indicator */}
        <SpeedIndicator
          speedHistory={speedHistory}
          currentSpeed={currentSpeed}
          totalCount={totalCount}
          totalProcessed={totalProcessed}
        />

        {/* Real-Time Scraper Metrics - Shows ACTUAL state, not configured */}
        <RealTimeMetricsPanel realTimeState={realTimeState} configuredState={config} onResumeTimeout={resumeTimeoutPaused} />

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Templates */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-500" />
                Active Templates
              </h3>
              <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                {currentBatch.filter(t => !['completed', 'failed', 'pending'].includes(t.phase)).length} processing
              </Badge>
            </div>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {currentBatch.length > 0 ? (
                  currentBatch.map((template, idx) => (
                    <ActiveTemplateCard key={`${template.url}-${idx}`} template={template} />
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                    <p>Waiting for templates...</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Performance Controls */}
          <PerformanceControls
            config={config}
            onChange={updateConfig}
            disabled={scrapeState.status === 'paused'}
          />
        </div>

        {/* Screenshot Feed */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Camera className="h-5 w-5 text-purple-500" />
              Live Screenshot Feed
            </h3>
            <Badge variant="secondary" className="bg-purple-100 text-purple-700">
              {screenshots.length} captured
            </Badge>
          </div>
          <LazyScreenshotCarousel
            screenshots={screenshots}
            onLoadMore={loadMoreScreenshots}
            hasMore={screenshotsHasMore}
            isLoading={screenshotsLoading}
          />
        </Card>

        <TemplateConfirmationCard confirmations={templateConfirmations} />

        {/* Console Logs */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-gray-500" />
              Console Output
            </h3>
            <Badge variant="outline" className="text-gray-500">
              {logs.length} entries
            </Badge>
          </div>
          <ScrollArea className="h-[200px] rounded-lg bg-gray-900 p-4 font-mono text-xs">
            {logs.length > 0 ? (
              logs.map((log, idx) => (
                <div
                  key={idx}
                  className={`mb-1 ${log.level === 'error' ? 'text-red-400' :
                    log.level === 'warn' ? 'text-yellow-400' :
                      'text-green-400'
                    }`}
                >
                  <span className="text-gray-500">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>{' '}
                  {log.message}
                </div>
              ))
            ) : (
              <div className="text-gray-500">No logs yet...</div>
            )}
          </ScrollArea>
        </Card>
      </div>
    );
  }

  // Idle state - Start Fresh UI
  return (
    <div className="space-y-6">
      {/* Paused Session Banner */}
      {pausedState && (
        <Card className="p-6 border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-100 rounded-xl">
                <AlertCircle className="h-6 w-6 text-amber-600" />
              </div>
              {toAssetUrl(pausedLastScreenshot?.screenshot_path || null) && (
                <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-amber-200 bg-white">
                  <Image
                    src={toAssetUrl(pausedLastScreenshot?.screenshot_path || null)!}
                    alt={pausedLastScreenshot?.template_name || pausedLastScreenshot?.template_slug || 'Last template'}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                </div>
              )}
              <div>
                <h3 className="font-semibold text-amber-800">Paused Scrape Found</h3>
                <p className="text-sm text-amber-700">
                  {pausedState.regular_processed} of {pausedState.regular_total} templates processed
                </p>
                {(pausedLastScreenshot?.template_name || pausedLastScreenshot?.template_slug) && (
                  <p className="text-xs text-amber-700 mt-0.5">
                    Last captured: <span className="font-medium">{pausedLastScreenshot.template_name || pausedLastScreenshot.template_slug}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setPausedState(null)}
                className="border-amber-300"
              >
                Dismiss
              </Button>
              <Button
                onClick={resumeScrape}
                className="bg-amber-600 hover:bg-amber-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Resume Scrape
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Preflight Checks */}
      <Card className="p-6 border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Server className="h-5 w-5 text-slate-700" />
              Preflight Checks
            </h3>
            <p className="text-sm text-gray-500">
              Verify Supabase writes, R2 storage access, and screenshot browser health before scraping.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                preflight
                  ? preflight.ok
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-slate-100 border-slate-200 text-slate-600'
              }
            >
              {preflight ? (preflight.ok ? 'All systems go' : 'Checks failed') : 'Not checked'}
            </Badge>
            <Button variant="outline" onClick={runPreflight} disabled={preflightLoading}>
              {preflightLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Activity className="h-4 w-4 mr-2" />
                  Run checks
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          {preflight?.checkedAt
            ? `Last checked: ${new Date(preflight.checkedAt).toLocaleString()}`
            : 'Run checks before starting any scraper mode.'}
        </div>

        {preflightError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {preflightError}
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <PreflightCheckTile
            title="R2 Storage"
            icon={<Server className="h-4 w-4" />}
            ok={preflight ? preflight.storage.ok : null}
            detail={
              preflight
                ? `Bucket: ${preflight.storage.bucketName || 'not set'}${preflight.storage.publicUrl ? ` | URL: ${preflight.storage.publicUrl}` : ''}`
                : 'Cloudflare R2 bucket for screenshots'
            }
            secondary={
              preflight
                ? `${preflight.storage.writable ? 'Write OK' : 'Write failed'}`
                : null
            }
            error={preflight?.storage.error || null}
          />
          <PreflightCheckTile
            title="Supabase"
            icon={<Database className="h-4 w-4" />}
            ok={preflight ? preflight.supabase.ok : null}
            detail={
              preflight
                ? `Read: ${preflight.supabase.readOk ? 'ok' : 'fail'} | Write: ${preflight.supabase.writeOk ? 'ok' : 'fail'}`
                : null
            }
            error={preflight?.supabase.error || null}
          />
          <PreflightCheckTile
            title="Screenshot Browser"
            icon={<Cpu className="h-4 w-4" />}
            ok={preflight ? preflight.browser.ok : null}
            detail={preflight?.browser.version ? `Chromium ${preflight.browser.version}` : null}
            error={preflight?.browser.error || null}
          />
        </div>
      </Card>

      {/* Incremental Scrape Card */}
      <Card className="p-8 border border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start gap-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shrink-0">
              <RotateCcw className="h-7 w-7 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">Incremental Update Scrape</h1>
              <p className="text-sm text-gray-600 mt-1">
                No destructive deletes. This checks the Webflow sitemap for missing/updated templates and pushes updates into Supabase in batches.
                Screenshots are uploaded directly to Cloudflare R2 and served from the R2 public domain.
              </p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={checkForNewTemplates} disabled={newTemplateDiscovery.phase === 'checking'}>
                  {newTemplateDiscovery.phase === 'checking' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Checking…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Check sitemap
                    </>
                  )}
                </Button>
                <Button
                  onClick={startMissingTemplateScrape}
                  disabled={isExecuting || newTemplateDiscovery.toScrapeCount === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Scrape missing/updated templates
                </Button>
              </div>
              {newTemplateDiscovery.phase === 'checked' && (
                <div className="mt-3 text-xs text-gray-500">
                  Missing: {newTemplateDiscovery.missingCount} · Updated: {newTemplateDiscovery.updatedCount} · To scrape: {newTemplateDiscovery.toScrapeCount}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Maintenance / Destructive Operations */}
      <Card className="p-8 border border-red-200 bg-gradient-to-br from-red-50/40 to-white">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-start gap-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 shadow-lg shrink-0">
              <AlertTriangle className="h-7 w-7 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">Maintenance / Destructive</h2>
              <p className="text-sm text-gray-600 mt-1">
                These operations clear database records. Screenshots in R2 are overwritten during re-scrape.
              </p>
              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => startRescreenshotAll({ wipeImages: true })}
                  disabled={isExecuting}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Wipe images + re-do screenshots
                </Button>
                <Button
                  onClick={startFreshScrape}
                  disabled={isExecuting}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Start from scratch (delete Supabase + images)
                </Button>
              </div>
              <div className="mt-3 text-xs text-gray-500">
                Images are loaded from Cloudflare R2 (screenshots.luminardigital.com) in both localhost and production.
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PerformanceControls
          config={config}
          onChange={updateConfig}
          disabled={false}
        />

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Star className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-800">Featured Authors</h3>
              <p className="text-xs text-gray-500">Templates from these authors are scraped first</p>
            </div>
          </div>
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
            <p className="text-sm text-amber-800">
              Configure featured authors in the <span className="font-medium">Authors</span> section.
              Their templates will be prioritized during scraping.
            </p>
          </div>
        </Card>
      </div>

      {/* Supabase Push Visibility */}
      <Card className="p-6 border border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-700" />
              Supabase Push
            </h3>
            <p className="text-sm text-gray-500">
              Shows live write queue + recent templates persisted to Supabase during scraping.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Badge variant="outline" className="bg-slate-50">
              Queued: {supabaseWriteState?.queued ?? 0}
            </Badge>
            <Badge variant="outline" className="bg-slate-50">
              In flight: {supabaseWriteState?.inFlight ? 'yes' : 'no'}
            </Badge>
            <Badge variant="outline" className="bg-green-50 border-green-200 text-green-700">
              Saved: {supabaseWriteState?.successful ?? 0}
            </Badge>
            <Badge variant="outline" className="bg-red-50 border-red-200 text-red-700">
              Failed: {supabaseWriteState?.failed ?? 0}
            </Badge>
          </div>
        </div>

        {supabaseWriteState?.lastError && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            Last error: {supabaseWriteState.lastError}
          </div>
        )}

        <div className="mt-4 border rounded-lg overflow-hidden">
          <ScrollArea className="h-[220px]">
            <div className="divide-y">
              {(supabaseWriteState?.recent || []).slice(0, 50).map((item, idx) => (
                <div key={`${item.slug}-${idx}`} className="px-3 py-2 flex items-center justify-between text-sm">
                  <div className="font-mono text-xs text-gray-700 truncate max-w-[65%]">{item.slug}</div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={
                        item.status === 'saved'
                          ? 'bg-green-100 text-green-700'
                          : item.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-slate-100 text-slate-700'
                      }
                    >
                      {item.status}
                    </Badge>
                    {item.error && (
                      <span className="text-xs text-red-600 truncate max-w-[220px]" title={item.error}>
                        {item.error}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {(!supabaseWriteState || (supabaseWriteState.recent || []).length === 0) && (
                <div className="p-6 text-center text-sm text-gray-500">No Supabase writes yet.</div>
              )}
            </div>
          </ScrollArea>
        </div>
      </Card>

      <TemplateConfirmationCard confirmations={templateConfirmations} />

      {/* Check for Updates */}
      <Card className="p-6 border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600" />
              Check for Missing/Updated Templates
            </h3>
            <p className="text-sm text-gray-500">
              Scan the Webflow sitemap and find templates that are missing or have changed since the last scrape.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={checkForNewTemplates}
            disabled={newTemplateDiscovery.phase === 'checking'}
          >
            {newTemplateDiscovery.phase === 'checking' ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Check sitemap
              </>
            )}
          </Button>
        </div>

        {newTemplateDiscovery.phase === 'checked' && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="p-3 rounded-lg bg-slate-50 border">
                <div className="text-xs text-gray-500">In sitemap</div>
                <div className="text-xl font-bold text-gray-800">{newTemplateDiscovery.totalInSitemap}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border">
                <div className="text-xs text-gray-500">In gallery</div>
                <div className="text-xl font-bold text-gray-800">{newTemplateDiscovery.existingInDb}</div>
              </div>
              <div className={`p-3 rounded-lg border ${newTemplateDiscovery.missingCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-xs text-gray-500">Missing</div>
                <div className={`text-xl font-bold ${newTemplateDiscovery.missingCount > 0 ? 'text-amber-700' : 'text-gray-800'}`}>
                  {newTemplateDiscovery.missingCount}
                </div>
              </div>
              <div className={`p-3 rounded-lg border ${newTemplateDiscovery.updatedCount > 0 ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-xs text-gray-500">Updated</div>
                <div className={`text-xl font-bold ${newTemplateDiscovery.updatedCount > 0 ? 'text-blue-700' : 'text-gray-800'}`}>
                  {newTemplateDiscovery.updatedCount}
                </div>
              </div>
            </div>

            {newTemplateDiscovery.toScrapeCount > 0 && (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-gray-600">
                  Showing {Math.min(10, newTemplateDiscovery.missingTemplates.length)} of {newTemplateDiscovery.toScrapeCount} templates to scrape
                </div>
                <Button
                  onClick={startMissingTemplateScrape}
                  disabled={isExecuting}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Scrape missing/updated templates
                </Button>
              </div>
            )}

            {newTemplateDiscovery.missingTemplates.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {newTemplateDiscovery.missingTemplates.slice(0, 10).map((t) => (
                  <a
                    key={t.url}
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg border bg-white hover:bg-slate-50 text-sm text-gray-700 truncate"
                    title={t.url}
                  >
                    {t.displayName}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {newTemplateDiscovery.phase === 'error' && newTemplateDiscovery.error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {newTemplateDiscovery.error}
          </div>
        )}
      </Card>

    </div>
  );
}
