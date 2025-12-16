'use client';

import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useAdmin } from '../admin-context';
import { Activity, Cpu, Server, HardDrive } from 'lucide-react';

export function SystemSection() {
  const { systemStats, formatBytes } = useAdmin();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            CPU Information
          </h2>
          {systemStats ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Model</span>
                <span className="text-sm font-medium">{systemStats.cpu.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Cores</span>
                <span className="text-sm font-medium">{systemStats.cpu.cores}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Load Average</span>
                <span className="text-sm font-medium">
                  {systemStats.cpu.loadAverage['1min']} / {systemStats.cpu.loadAverage['5min']} / {systemStats.cpu.loadAverage['15min']}
                </span>
              </div>
              <div className="pt-2 border-t">
                <p className="text-xs text-gray-600 mb-2">Recommended Settings:</p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Max Concurrency</span>
                    <span className="text-xs font-medium">{systemStats.recommendations.maxConcurrency}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Suggested Browsers</span>
                    <span className="text-xs font-medium">{systemStats.recommendations.suggestedBrowsers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Pages per Browser</span>
                    <span className="text-xs font-medium">{systemStats.recommendations.suggestedPagesPerBrowser}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">Loading...</div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Server className="h-5 w-5" />
            Memory Usage
          </h2>
          {systemStats ? (
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total</span>
                <span className="text-sm font-medium">{formatBytes(systemStats.memory.total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Used</span>
                <span className="text-sm font-medium">{formatBytes(systemStats.memory.used)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Free</span>
                <span className="text-sm font-medium">{formatBytes(systemStats.memory.free)}</span>
              </div>
              <div className="pt-2">
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-gray-600">Usage</span>
                  <span className="text-xs font-medium">{systemStats.memory.percentage}%</span>
                </div>
                <Progress value={systemStats.memory.percentage} className="h-2" />
              </div>
              <div className="pt-2 border-t">
                <p className="text-xs text-gray-600 mb-2">Process Memory:</p>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Heap Used</span>
                    <span className="text-xs font-medium">{formatBytes(systemStats.memory.process.heapUsed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Heap Total</span>
                    <span className="text-xs font-medium">{formatBytes(systemStats.memory.process.heapTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500">Loading...</div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage Usage
        </h2>
        {systemStats ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Screenshots</div>
              <div className="text-lg font-semibold">{formatBytes(systemStats.storage.screenshots)}</div>
              <div className="text-xs text-gray-400">{systemStats.storage.screenshotCount} files</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Thumbnails</div>
              <div className="text-lg font-semibold">{formatBytes(systemStats.storage.thumbnails)}</div>
              <div className="text-xs text-gray-400">{systemStats.storage.thumbnailCount} files</div>
            </div>
            <div className="p-4 bg-gray-50 rounded">
              <div className="text-sm text-gray-600 mb-1">Database</div>
              <div className="text-lg font-semibold">{formatBytes(systemStats.storage.database)}</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Loading...</div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5" />
          System Information
        </h2>
        {systemStats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-600">Platform</div>
              <div className="text-sm font-medium">{systemStats.system.platform}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Architecture</div>
              <div className="text-sm font-medium">{systemStats.system.architecture}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Node Version</div>
              <div className="text-sm font-medium">{systemStats.system.nodeVersion}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">System Uptime</div>
              <div className="text-sm font-medium">{systemStats.system.uptime} min</div>
            </div>
          </div>
        ) : (
          <div className="text-gray-500">Loading...</div>
        )}
      </Card>
    </div>
  );
}
