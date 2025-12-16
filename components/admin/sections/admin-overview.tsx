'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdmin } from '../admin-context';
import {
  Package,
  Users,
  ShoppingCart,
  HardDrive,
  Cloud,
  Laptop,
  Images,
  Image as ImageIcon,
  Database,
  FolderOpen,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import type { AdminSection } from '../admin-sidebar';

interface AdminOverviewProps {
  onNavigate: (section: AdminSection) => void;
}

export function AdminOverview({ onNavigate }: AdminOverviewProps) {
  const { stats, systemStats, thumbnailQueueCounts, thumbnailJobs, fetchThumbnailJobs, formatBytes } = useAdmin();

  return (
    <div className="space-y-6">
      {/* Environment Status Card */}
      <Card className={`p-4 border-2 ${
        systemStats?.environment?.type === 'vps'
          ? 'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50'
          : 'border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50'
      }`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${
              systemStats?.environment?.type === 'vps'
                ? 'bg-green-100'
                : 'bg-blue-100'
            }`}>
              {systemStats?.environment?.type === 'vps' ? (
                <Cloud className="h-8 w-8 text-green-600" />
              ) : (
                <Laptop className="h-8 w-8 text-blue-600" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {systemStats?.environment?.name || 'Detecting environment...'}
                </h2>
                <Badge variant={systemStats?.environment?.type === 'vps' ? 'default' : 'secondary'} className={
                  systemStats?.environment?.type === 'vps'
                    ? 'bg-green-600'
                    : 'bg-blue-600'
                }>
                  {systemStats?.environment?.type === 'vps' ? 'Production' : 'Development'}
                </Badge>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {systemStats?.environment?.description || 'Loading...'}
              </p>
            </div>
          </div>

          {/* Storage Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="text-center p-3 bg-white/60 rounded-lg border">
              <Images className="h-5 w-5 mx-auto text-purple-500 mb-1" />
              <div className="text-lg font-bold text-gray-800">
                {systemStats?.storage?.screenshotCount ?? 0}
              </div>
              <div className="text-xs text-gray-500">Screenshots</div>
              <div className="text-xs text-gray-400">
                {formatBytes(systemStats?.storage?.screenshots || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-white/60 rounded-lg border">
              <ImageIcon className="h-5 w-5 mx-auto text-indigo-500 mb-1" />
              <div className="text-lg font-bold text-gray-800">
                {systemStats?.storage?.thumbnailCount ?? 0}
              </div>
              <div className="text-xs text-gray-500">Thumbnails</div>
              <div className="text-xs text-gray-400">
                {formatBytes(systemStats?.storage?.thumbnails || 0)}
              </div>
            </div>
            <div className="text-center p-3 bg-white/60 rounded-lg border">
              <Database className="h-5 w-5 mx-auto text-amber-500 mb-1" />
              <div className="text-lg font-bold text-gray-800">
                {formatBytes(systemStats?.storage?.database || 0)}
              </div>
              <div className="text-xs text-gray-500">Database</div>
            </div>
            <div className="text-center p-3 bg-white/60 rounded-lg border border-2 border-gray-300">
              <HardDrive className="h-5 w-5 mx-auto text-gray-600 mb-1" />
              <div className="text-lg font-bold text-gray-800">
                {formatBytes(systemStats?.storage?.total || 0)}
              </div>
              <div className="text-xs text-gray-500 font-medium">Total Storage</div>
            </div>
          </div>
        </div>

        {/* Storage Warning for Local */}
        {systemStats?.environment?.type === 'local' && (systemStats?.storage?.screenshotCount || 0) === 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">No local images found</p>
                <p className="text-xs text-amber-600 mt-1">
                  Your screenshots are stored on the VPS. Run a new scrape locally to generate images, or use the deploy script to sync from VPS.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Storage Path Info */}
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <FolderOpen className="h-3 w-3" />
          <span>Storage path: <code className="bg-gray-100 px-1 rounded">{systemStats?.environment?.storagePath || '...'}</code></span>
        </div>
      </Card>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate('fresh-scraper')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Templates</p>
              <p className="text-2xl font-bold">{stats?.templates || 0}</p>
            </div>
            <Package className="h-8 w-8 text-blue-500" />
          </div>
        </Card>

        <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate('visitors')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Visitors</p>
              <p className="text-2xl font-bold">{Array.isArray(stats?.activeVisitors) ? stats.activeVisitors.length : (stats?.activeVisitorsCount || 0)}</p>
            </div>
            <Users className="h-8 w-8 text-green-500" />
          </div>
        </Card>

        <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate('purchases')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Purchases</p>
              <p className="text-2xl font-bold">{stats?.completedPurchases || 0}</p>
            </div>
            <ShoppingCart className="h-8 w-8 text-purple-500" />
          </div>
        </Card>

        <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate('storage')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Storage Used</p>
              <p className="text-2xl font-bold">{formatBytes(systemStats?.storage?.total || stats?.databaseSize || 0)}</p>
            </div>
            <HardDrive className="h-8 w-8 text-orange-500" />
          </div>
        </Card>
      </div>

      {/* Thumbnail Queue Card */}
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-purple-500" />
              Thumbnail Queue
            </h2>
            <p className="text-sm text-gray-500">Screenshots run in the background so you can queue multiple updates at once.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 className={`h-4 w-4 ${thumbnailQueueCounts.running > 0 ? 'animate-spin text-blue-500' : 'text-gray-300'}`} />
              <span>{thumbnailQueueCounts.running} running</span>
            </div>
            <Badge variant="outline" className="text-xs">Pending {thumbnailQueueCounts.pending}</Badge>
            <Badge variant="outline" className="text-xs">Completed {thumbnailQueueCounts.completed}</Badge>
            <Badge variant="destructive" className="text-xs">Failed {thumbnailQueueCounts.failed}</Badge>
            <Button size="sm" variant="outline" onClick={() => fetchThumbnailJobs({ emitNotifications: false })}>
              Refresh
            </Button>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {thumbnailJobs.length === 0 ? (
            <p className="text-sm text-gray-500">No thumbnail jobs queued right now.</p>
          ) : (
            thumbnailJobs.slice(0, 5).map((job) => {
              const statusLabel = job.status === 'completed'
                ? 'Completed'
                : job.status === 'failed'
                  ? 'Failed'
                  : job.status === 'running'
                    ? 'Processing'
                    : 'Queued';
              const statusStyles = job.status === 'completed'
                ? 'bg-green-50 text-green-700 border-green-200'
                : job.status === 'failed'
                  ? 'bg-red-50 text-red-700 border-red-200'
                  : job.status === 'running'
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';
              return (
                <div key={job.id} className="flex items-start justify-between gap-3 border rounded-lg p-3 bg-white">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{job.template_name}</p>
                    <p className="text-xs text-gray-500 truncate">{job.target_url}</p>
                    {job.status === 'failed' && job.error_message && (
                      <p className="text-xs text-red-600 mt-1 truncate">{job.error_message}</p>
                    )}
                  </div>
                  <Badge variant="outline" className={`text-xs font-medium whitespace-nowrap ${statusStyles}`}>
                    {statusLabel}
                  </Badge>
                </div>
              );
            })
          )}
        </div>
        {thumbnailJobs.length > 5 && (
          <Button
            variant="ghost"
            className="w-full mt-2 text-sm"
            onClick={() => onNavigate('images')}
          >
            View all {thumbnailJobs.length} jobs
          </Button>
        )}
      </Card>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-blue-200"
          onClick={() => onNavigate('fresh-scraper')}
        >
          <div className="text-center">
            <Package className="h-8 w-8 mx-auto text-blue-500 mb-2" />
            <p className="font-medium text-sm">Scrape Templates</p>
            <p className="text-xs text-gray-500 mt-1">Discover & import new templates</p>
          </div>
        </Card>

        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-purple-200"
          onClick={() => onNavigate('ultra')}
        >
          <div className="text-center">
            <Sparkles className="h-8 w-8 mx-auto text-purple-500 mb-2" />
            <p className="font-medium text-sm">Ultra Featured</p>
            <p className="text-xs text-gray-500 mt-1">Curate homepage templates</p>
          </div>
        </Card>

        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-amber-200"
          onClick={() => onNavigate('images')}
        >
          <div className="text-center">
            <ImageIcon className="h-8 w-8 mx-auto text-amber-500 mb-2" />
            <p className="font-medium text-sm">Manage Images</p>
            <p className="text-xs text-gray-500 mt-1">Fix missing screenshots</p>
          </div>
        </Card>

        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-green-200"
          onClick={() => onNavigate('storage')}
        >
          <div className="text-center">
            <HardDrive className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <p className="font-medium text-sm">Data Transfer</p>
            <p className="text-xs text-gray-500 mt-1">Export or import data</p>
          </div>
        </Card>
      </div>
    </div>
  );
}

import { Sparkles } from 'lucide-react';
