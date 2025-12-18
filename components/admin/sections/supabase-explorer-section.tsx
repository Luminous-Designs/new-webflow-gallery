'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../admin-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, Database, Copy } from 'lucide-react';
import { toast } from 'sonner';

type TableName =
  | 'templates'
  | 'subcategories'
  | 'styles'
  | 'features'
  | 'featured_authors'
  | 'ultra_featured_templates'
  | 'template_subcategories'
  | 'template_styles'
  | 'template_features'
  | 'template_blacklist'
  | 'screenshot_exclusions'
  | 'fresh_scrape_state'
  | 'fresh_scrape_screenshots'
  | 'visitors'
  | 'purchases'
  | 'supabase_activity_log';

const TABLES: Array<{ group: string; items: TableName[] }> = [
  { group: 'Core', items: ['templates', 'subcategories', 'styles', 'features'] },
  { group: 'Relations', items: ['template_subcategories', 'template_styles', 'template_features', 'ultra_featured_templates'] },
  { group: 'Curation', items: ['featured_authors', 'template_blacklist', 'screenshot_exclusions'] },
  { group: 'Scraping', items: ['fresh_scrape_state', 'fresh_scrape_screenshots'] },
  { group: 'App', items: ['visitors', 'purchases'] },
  { group: 'Ops', items: ['supabase_activity_log'] },
];

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

export function SupabaseExplorerSection() {
  const { resolveAuthToken } = useAdmin();
  const [status, setStatus] = useState<{ isConnected?: boolean; latencyMs?: number | null; lastChecked?: string | null; lastError?: string | null } | null>(null);

  const [table, setTable] = useState<TableName>('templates');
  const [limit, setLimit] = useState(25);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');

  const offset = (page - 1) * limit;

  const visibleRows = useMemo(() => {
    if (!searchText.trim()) return rows;
    const q = searchText.toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }, [rows, searchText]);

  const columns = useMemo(() => {
    const first = visibleRows[0];
    if (!first || typeof first !== 'object') return [];
    return Object.keys(first);
  }, [visibleRows]);

  const fetchStatus = useCallback(async () => {
    try {
      const token = resolveAuthToken();
      const response = await fetch('/api/admin/supabase?action=status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const data = await response.json();
      setStatus(data);
    } catch {
      // ignore
    }
  }, [resolveAuthToken]);

  const fetchTable = useCallback(async () => {
    setLoading(true);
    try {
      const token = resolveAuthToken();
      const response = await fetch(
        `/api/admin/supabase?action=table-data&table=${encodeURIComponent(table)}&limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to fetch table data');
      }

      setRows(Array.isArray(data.data) ? data.data : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (error) {
      setRows([]);
      setTotal(0);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch table data');
    } finally {
      setLoading(false);
    }
  }, [resolveAuthToken, table, limit, offset]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    void fetchTable();
  }, [fetchTable]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-gray-700" />
              <h2 className="text-xl font-semibold">Supabase Explorer</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">Browse tables, inspect rows, and sanity-check live data.</p>
          </div>
          <div className="flex items-center gap-2">
            {status?.isConnected ? (
              <Badge className="bg-green-600 hover:bg-green-600">Connected</Badge>
            ) : (
              <Badge variant="destructive">Disconnected</Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void fetchStatus();
                void fetchTable();
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {status && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-gray-500">Latency</div>
              <div className="font-medium">{typeof status.latencyMs === 'number' ? `${status.latencyMs}ms` : '—'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-gray-500">Last Checked</div>
              <div className="font-medium">{status.lastChecked ? new Date(status.lastChecked).toLocaleString() : '—'}</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg md:col-span-2">
              <div className="text-gray-500">Last Error</div>
              <div className="font-medium truncate">{status.lastError || '—'}</div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="p-4 lg:col-span-1">
          <div className="font-semibold text-gray-900 mb-2">Tables</div>
          <ScrollArea className="h-[520px] pr-3">
            <div className="space-y-4">
              {TABLES.map((group) => (
                <div key={group.group}>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{group.group}</div>
                  <div className="space-y-1">
                    {group.items.map((t) => (
                      <Button
                        key={t}
                        variant={t === table ? 'secondary' : 'ghost'}
                        className="w-full justify-start"
                        onClick={() => {
                          setSearchText('');
                          setPage(1);
                          setTable(t);
                        }}
                      >
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>

        <Card className="p-4 lg:col-span-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="font-semibold">{table}</div>
              <Badge variant="secondary">{total.toLocaleString()} rows</Badge>
              {loading && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading
                </Badge>
              )}
            </div>
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Search within loaded rows…"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="w-64"
              />
              <Input
                type="number"
                min={5}
                max={100}
                value={limit}
                onChange={(e) => {
                  const next = Math.max(5, Math.min(100, parseInt(e.target.value || '25', 10)));
                  setLimit(next);
                  setPage(1);
                }}
                className="w-24"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Page {page} / {totalPages} (offset {offset})
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>

          <div className="mt-4 border rounded-lg overflow-hidden">
            <ScrollArea className="h-[440px]">
              <div className="min-w-[800px]">
                <div className="grid" style={{ gridTemplateColumns: `200px repeat(${Math.max(1, Math.min(6, columns.length))}, minmax(180px, 1fr)) 90px` }}>
                  <div className="px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">Row</div>
                  {columns.slice(0, 6).map((col) => (
                    <div key={col} className="px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600 truncate">
                      {col}
                    </div>
                  ))}
                  <div className="px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-600">JSON</div>
                </div>

                {visibleRows.length === 0 && !loading && (
                  <div className="p-8 text-center text-gray-500 text-sm">No rows found.</div>
                )}

                {visibleRows.map((row, idx) => (
                  <div
                    key={row?.id ? `${row.id}` : `${idx}`}
                    className="grid border-b last:border-b-0"
                    style={{ gridTemplateColumns: `200px repeat(${Math.max(1, Math.min(6, columns.length))}, minmax(180px, 1fr)) 90px` }}
                  >
                    <div className="px-3 py-2 text-xs text-gray-500 truncate">{row?.id ? `id=${row.id}` : `#${offset + idx + 1}`}</div>
                    {columns.slice(0, 6).map((col) => (
                      <div key={col} className="px-3 py-2 text-xs truncate">
                        {row?.[col] === null || row?.[col] === undefined ? '—' : String(row[col])}
                      </div>
                    ))}
                    <div className="px-3 py-2 text-xs">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await copyToClipboard(JSON.stringify(row, null, 2));
                            toast.success('Copied row JSON');
                          } catch {
                            toast.error('Failed to copy');
                          }
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </Card>
      </div>
    </div>
  );
}
