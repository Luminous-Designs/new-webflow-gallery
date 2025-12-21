'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAdmin } from '../admin-context';
import {
  Package,
  Users,
  ShoppingCart,
  Cloud,
  Laptop,
  Camera,
  Database,
  Sparkles,
} from 'lucide-react';
import type { AdminSection } from '../admin-sidebar';

interface AdminOverviewProps {
  onNavigate: (section: AdminSection) => void;
}

export function AdminOverview({ onNavigate }: AdminOverviewProps) {
  const { stats, systemStats } = useAdmin();

  return (
    <div className="space-y-6">
      {/* Environment Status Card */}
      <Card className={`p-4 border-2 ${
        systemStats?.environment?.type === 'production'
          ? 'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50'
          : 'border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50'
      }`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${
              systemStats?.environment?.type === 'production'
                ? 'bg-green-100'
                : 'bg-blue-100'
            }`}>
              {systemStats?.environment?.type === 'production' ? (
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
                <Badge variant={systemStats?.environment?.type === 'production' ? 'default' : 'secondary'} className={
                  systemStats?.environment?.type === 'production'
                    ? 'bg-green-600'
                    : 'bg-blue-600'
                }>
                  {systemStats?.environment?.type === 'production' ? 'Production' : 'Development'}
                </Badge>
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {systemStats?.environment?.description || 'Loading...'}
              </p>
            </div>
          </div>

          {/* R2 Storage Info */}
          <div className="grid grid-cols-1 gap-3">
            <div className="text-center p-3 bg-white/60 rounded-lg border">
              <Cloud className="h-5 w-5 mx-auto text-orange-500 mb-1" />
              <div className="text-sm font-bold text-gray-800">
                {systemStats?.storage?.r2Configured ? 'R2 Connected' : 'R2 Not Configured'}
              </div>
              <div className="text-xs text-gray-500">Cloudflare R2</div>
              {systemStats?.storage?.r2PublicUrl && (
                <div className="text-xs text-gray-400 truncate max-w-[200px]">
                  {systemStats.storage.r2PublicUrl}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* R2 Bucket Info */}
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <Cloud className="h-3 w-3" />
          <span>R2 Bucket: <code className="bg-gray-100 px-1 rounded">{systemStats?.storage?.r2BucketName || 'not configured'}</code></span>
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

        <Card className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => onNavigate('system')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">R2 Storage</p>
              <p className="text-2xl font-bold">{systemStats?.storage?.r2Configured ? 'Connected' : 'Not Configured'}</p>
            </div>
            <Cloud className="h-8 w-8 text-orange-500" />
          </div>
        </Card>
      </div>

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
          onClick={() => onNavigate('screenshots')}
        >
          <div className="text-center">
            <Camera className="h-8 w-8 mx-auto text-amber-500 mb-2" />
            <p className="font-medium text-sm">Screenshots</p>
            <p className="text-xs text-gray-500 mt-1">Test + exclusions</p>
          </div>
        </Card>

        <Card
          className="p-4 cursor-pointer hover:shadow-md transition-shadow hover:border-green-200"
          onClick={() => onNavigate('supabase-explorer')}
        >
          <div className="text-center">
            <Database className="h-8 w-8 mx-auto text-green-500 mb-2" />
            <p className="font-medium text-sm">Supabase Explorer</p>
            <p className="text-xs text-gray-500 mt-1">Inspect database tables</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
