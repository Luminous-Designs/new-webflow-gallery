/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import { toAssetUrl } from '@/lib/assets';
import { Loader2, History, Sparkles, Star, Trash2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

type TemplateLog = {
  id: number;
  name?: string | null;
  slug?: string | null;
  author_id?: string | null;
  author_name?: string | null;
  screenshot_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const PAGE_SIZE = 25;

function normalizePosition(list: any[]): any[] {
  return list.map((item, index) => ({ ...item, position: index + 1 }));
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function LogsSection() {
  const {
    resolveAuthToken,
    ultraFeaturedTemplates,
    setUltraFeaturedTemplates,
    persistUltraFeatured,
    isUltraSaving,
    featuredAuthors,
    toggleFeaturedAuthor,
  } = useAdmin();

  const [logs, setLogs] = useState<TemplateLog[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const offsetRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const ultraFeaturedIds = useMemo(() => new Set(ultraFeaturedTemplates.map((t: any) => t.id)), [ultraFeaturedTemplates]);
  const featuredAuthorIds = useMemo(() => new Set(featuredAuthors.map((a: any) => a.author_id)), [featuredAuthors]);

  const loadLogs = useCallback(async (reset = false) => {
    const token = resolveAuthToken();
    if (!token) return;
    const nextOffset = reset ? 0 : offsetRef.current;
    if (reset) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const res = await fetch(`/api/admin/logs?limit=${PAGE_SIZE}&offset=${nextOffset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load logs');
      const data = await res.json();
      const items = Array.isArray(data.templates) ? data.templates : [];

      if (reset) {
        setLogs(items);
      } else {
        setLogs((prev) => [...prev, ...items]);
      }
      offsetRef.current = nextOffset + items.length;
      setHasMore(Boolean(data.hasMore));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [resolveAuthToken]);

  const handleRefresh = () => {
    offsetRef.current = 0;
    setHasMore(true);
    void loadLogs(true);
  };

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return;
    void loadLogs(false);
  };

  const handleMarkUltra = async (template: TemplateLog) => {
    if (ultraFeaturedIds.has(template.id)) return;
    const next = normalizePosition([...ultraFeaturedTemplates, template]);
    setUltraFeaturedTemplates(next);
    await persistUltraFeatured(next, 'Marked as ultra featured');
  };

  const handleFeatureAuthor = async (template: TemplateLog) => {
    if (!template.author_id || !template.author_name) return;
    if (featuredAuthorIds.has(template.author_id)) return;
    await toggleFeaturedAuthor(
      { author_id: template.author_id, author_name: template.author_name },
      true
    );
  };

  const handleDelete = async (template: TemplateLog) => {
    const name = template.name || template.slug || 'this template';
    if (!confirm(`Delete ${name} from the database and remove its screenshot?`)) return;

    setDeletingId(template.id);
    try {
      const res = await fetch(`/api/admin/logs?id=${template.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${resolveAuthToken()}` },
      });
      if (!res.ok) throw new Error('Delete failed');

      setLogs((prev) => prev.filter((item) => item.id !== template.id));
      setUltraFeaturedTemplates((prev) => prev.filter((item: any) => item.id !== template.id));
      toast.success('Template deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const token = resolveAuthToken();
    if (!token) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadLogs(true);
  }, [loadLogs, resolveAuthToken]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <History className="h-5 w-5 text-slate-700" />
              Template Logs
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Recent template additions and updates in Supabase.
            </p>
          </div>
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCcw className="h-4 w-4 mr-2" />}
            Refresh
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">Latest Activity</h3>
            <p className="text-xs text-gray-500 mt-1">{logs.length} templates loaded</p>
          </div>
          {(isLoading || isLoadingMore) && (
            <Badge variant="secondary" className="gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading
            </Badge>
          )}
        </div>

        <div className="mt-4">
          <ScrollArea className="h-[620px] pr-3">
            <div className="space-y-3">
              {logs.map((template) => {
                const isUltra = ultraFeaturedIds.has(template.id);
                const isFeaturedAuthor = template.author_id ? featuredAuthorIds.has(template.author_id) : false;
                return (
                  <div key={template.id} className="flex flex-col xl:flex-row xl:items-center gap-4 border rounded-lg p-4 bg-white">
                    <div className="relative h-16 w-24 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                      {toAssetUrl(template.screenshot_path) ? (
                        <Image
                          src={toAssetUrl(template.screenshot_path)!}
                          alt={template.name || template.slug || 'Template'}
                          fill
                          className="object-contain object-top"
                          unoptimized
                          loading="lazy"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-sm truncate">{template.name || template.slug || 'Untitled'}</div>
                        {isUltra && (
                          <Badge variant="secondary" className="text-[10px] flex items-center gap-1">
                            <Sparkles className="h-3 w-3" />
                            Ultra
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {template.author_name || 'Unknown author'}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span>Added: {formatTimestamp(template.created_at)}</span>
                        <span>Updated: {formatTimestamp(template.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={isUltra ? 'secondary' : 'default'}
                        onClick={() => void handleMarkUltra(template)}
                        disabled={isUltra || isUltraSaving}
                      >
                        <Sparkles className="h-4 w-4 mr-1" />
                        {isUltra ? 'Ultra Featured' : 'Mark Ultra'}
                      </Button>
                      <Button
                        size="sm"
                        variant={isFeaturedAuthor ? 'secondary' : 'outline'}
                        onClick={() => void handleFeatureAuthor(template)}
                        disabled={!template.author_id || isFeaturedAuthor}
                      >
                        <Star className="h-4 w-4 mr-1" />
                        {isFeaturedAuthor ? 'Featured Author' : 'Feature Author'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => void handleDelete(template)}
                        disabled={deletingId === template.id}
                      >
                        {deletingId === template.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        <span className="ml-1">Delete</span>
                      </Button>
                    </div>
                  </div>
                );
              })}

              {!isLoading && logs.length === 0 && (
                <div className="text-sm text-gray-500">No recent template updates found.</div>
              )}
            </div>
          </ScrollArea>

          <div className="mt-4 flex items-center justify-center">
            <Button variant="outline" onClick={handleLoadMore} disabled={!hasMore || isLoadingMore}>
              {isLoadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {hasMore ? 'Load More' : 'All Caught Up'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
