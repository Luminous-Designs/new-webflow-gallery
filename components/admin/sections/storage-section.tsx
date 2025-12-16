'use client';

import { useState, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import { Download, UploadCloud, Loader2, HardDrive } from 'lucide-react';

interface ImportProgressState {
  status: 'idle' | 'running' | 'success' | 'error';
  percent: number;
  stage: string;
  detail?: string;
  totalTemplates?: number;
  totalScreenshots?: number;
  totalThumbnails?: number;
  exportedAt?: string;
}

type ImportEvent =
  | { type: 'start'; message: string }
  | { type: 'manifest'; totalTemplates?: number; totalScreenshots?: number; totalThumbnails?: number; exportedAt?: string }
  | { type: 'progress'; stage: string; detail?: string; percent?: number }
  | { type: 'info'; message: string }
  | { type: 'complete'; percent?: number; templatesImported: number; screenshotsImported: number; thumbnailsImported: number }
  | { type: 'error'; message: string };

function parseFilenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (!match) return null;
  try {
    return decodeURIComponent((match[1] ?? match[2]).trim());
  } catch {
    return (match[1] ?? match[2]).trim();
  }
}

export function StorageSection() {
  const { stats, systemStats, loadStats, loadSystemStats, resolveAuthToken, formatBytes } = useAdmin();

  const [isExportingData, setIsExportingData] = useState(false);
  const [isImportingData, setIsImportingData] = useState(false);
  const [importProgressState, setImportProgressState] = useState<ImportProgressState | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportEvent = useCallback((event: ImportEvent): 'complete' | 'error' | null => {
    setImportProgressState((prev) => {
      switch (event.type) {
        case 'start':
          return { status: 'running', percent: 0, stage: event.message };
        case 'manifest':
          return {
            ...prev,
            status: 'running',
            percent: prev?.percent ?? 0,
            stage: prev?.stage ?? 'Preparing import',
            totalTemplates: event.totalTemplates ?? prev?.totalTemplates,
            totalScreenshots: event.totalScreenshots ?? prev?.totalScreenshots,
            totalThumbnails: event.totalThumbnails ?? prev?.totalThumbnails,
            exportedAt: event.exportedAt ?? prev?.exportedAt,
          };
        case 'progress':
          return { ...prev, status: 'running', percent: event.percent ?? prev?.percent ?? 0, stage: event.stage, detail: event.detail ?? prev?.detail };
        case 'info':
          return prev ? { ...prev, detail: event.message } : { status: 'running', percent: 0, stage: 'Info', detail: event.message };
        case 'complete':
          return {
            status: 'success',
            percent: event.percent ?? 100,
            stage: 'Import complete',
            detail: `Templates imported: ${event.templatesImported}`,
            totalTemplates: event.templatesImported,
            totalScreenshots: event.screenshotsImported,
            totalThumbnails: event.thumbnailsImported,
          };
        case 'error':
          return { ...prev, status: 'error', stage: 'Import failed', detail: event.message } as ImportProgressState;
        default:
          return prev;
      }
    });

    if (event.type === 'complete') {
      loadStats();
      loadSystemStats();
      toast.success(`Imported ${event.templatesImported} templates`);
      return 'complete';
    }
    if (event.type === 'error') {
      toast.error(event.message);
      return 'error';
    }
    return null;
  }, [loadStats, loadSystemStats]);

  const performImport = useCallback(async (file: File) => {
    setIsImportingData(true);
    setImportProgressState({ status: 'running', percent: 0, stage: 'Uploading archive...', detail: file.name });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/data/import', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: formData,
      });

      if (!response.ok || !response.body) throw new Error('Failed to start import process');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as ImportEvent;
            handleImportEvent(event);
          } catch (e) {
            console.error('Failed to parse import event:', e);
          }
        }
      }

      if (buffer.trim()) {
        try {
          handleImportEvent(JSON.parse(buffer));
        } catch (e) {
          console.error('Failed to parse final import payload:', e);
        }
      }
    } catch (error) {
      handleImportEvent({ type: 'error', message: error instanceof Error ? error.message : 'Import failed' });
    } finally {
      setIsImportingData(false);
    }
  }, [resolveAuthToken, handleImportEvent]);

  const handleExportData = useCallback(async () => {
    setIsExportingData(true);
    try {
      const response = await fetch('/api/admin/data/export', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` },
      });

      if (!response.ok) throw new Error(await response.text() || 'Failed to export data');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const disposition = response.headers.get('Content-Disposition');
      const filename = parseFilenameFromDisposition(disposition) ?? `webflow-data-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success('Export package ready');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export data');
    } finally {
      setIsExportingData(false);
    }
  }, [resolveAuthToken]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold mb-1">Data Transfer</h2>
            <p className="text-sm text-gray-500">Export or import a packaged archive to sync templates between environments.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={handleExportData} disabled={isExportingData || isImportingData}>
              {isExportingData ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Preparing...</> :
                <><Download className="h-4 w-4 mr-2" />Export All Data</>}
            </Button>
            <Button onClick={() => importFileInputRef.current?.click()} disabled={isImportingData}>
              {isImportingData ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</> :
                <><UploadCloud className="h-4 w-4 mr-2" />Import Data</>}
            </Button>
          </div>
        </div>

        <input ref={importFileInputRef} type="file" accept=".zip" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) performImport(file); }} />

        {importProgressState && (
          <div className="mt-6 space-y-4 rounded-lg border bg-gray-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-gray-800">{importProgressState.stage}</p>
                {importProgressState.detail && <p className="text-xs text-gray-500 break-all">{importProgressState.detail}</p>}
              </div>
              <Badge variant={importProgressState.status === 'error' ? 'destructive' : importProgressState.status === 'success' ? 'secondary' : 'outline'}>
                {Math.round(importProgressState.percent)}%
              </Badge>
            </div>
            <Progress value={importProgressState.percent} />
            <div className="grid grid-cols-1 gap-3 text-xs text-gray-600 sm:grid-cols-3">
              <div><div className="text-gray-500">Templates</div><div className="text-sm font-semibold">{importProgressState.totalTemplates ?? '-'}</div></div>
              <div><div className="text-gray-500">Screenshots</div><div className="text-sm font-semibold">{importProgressState.totalScreenshots ?? '-'}</div></div>
              <div><div className="text-gray-500">Thumbnails</div><div className="text-sm font-semibold">{importProgressState.totalThumbnails ?? '-'}</div></div>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-100 rounded-lg">
            <HardDrive className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Storage Information</h2>
            <p className="text-sm text-gray-500">Current storage usage and database statistics</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="font-medium text-gray-700 mb-2">Storage Breakdown</h3>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="font-medium">Screenshots</span>
              <span>{formatBytes(systemStats?.storage?.screenshots || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="font-medium">Thumbnails</span>
              <span>{formatBytes(systemStats?.storage?.thumbnails || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <span className="font-medium">Database</span>
              <span>{formatBytes(systemStats?.storage?.database || stats?.databaseSize || 0)}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 rounded border-2 border-blue-200">
              <span className="font-bold text-blue-800">Total Storage Used</span>
              <span className="font-bold text-blue-800">{formatBytes(systemStats?.storage?.total || 0)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="font-medium text-gray-700 mb-2">Database Stats</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Templates</span><span className="font-medium">{stats?.templates || 0}</span></div>
              <div className="flex justify-between"><span>Subcategories</span><span className="font-medium">{stats?.subcategories || 0}</span></div>
              <div className="flex justify-between"><span>Styles</span><span className="font-medium">{stats?.styles || 0}</span></div>
              <div className="flex justify-between"><span>Features</span><span className="font-medium">{stats?.features || 0}</span></div>
              <div className="flex justify-between"><span>Scrape Jobs</span><span className="font-medium">{stats?.scrapeJobs || 0}</span></div>
            </div>
            {stats?.templates ? (
              <div className="text-xs text-gray-500 text-center mt-4 p-2 bg-gray-50 rounded">
                Average {formatBytes((systemStats?.storage?.total || 0) / (stats?.templates || 1))} per template
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}
