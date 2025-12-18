/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useMemo, useState } from 'react';
import Image from 'next/image';
import { toAssetUrl } from '@/lib/assets';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import TemplatePreview from '@/components/template-preview';
import { useAdmin } from '../admin-context';
import { Loader2, Plus, Search, Trash2, ArrowUp, ArrowDown, Eye, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

function normalizePosition(list: any[]): any[] {
  return list.map((item, index) => ({ ...item, position: index + 1 }));
}

export function UltraFeaturedSection() {
  const {
    ultraPool,
    ultraFeaturedTemplates,
    isUltraLoading,
    isUltraSaving,
    setUltraFeaturedTemplates,
    setUltraPool,
    persistUltraFeatured,
    resolveAuthToken,
  } = useAdmin();

  const [previewTemplate, setPreviewTemplate] = useState<any | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [poolCategory, setPoolCategory] = useState<string>('all');
  const [poolSearch, setPoolSearch] = useState<string>('');

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const template of ultraPool) {
      for (const cat of (template?.subcategories || []) as string[]) {
        if (cat) unique.add(cat);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [ultraPool]);

  const filteredPool = useMemo(() => {
    const q = poolSearch.trim().toLowerCase();
    return ultraPool.filter((t: any) => {
      const matchesCategory = poolCategory === 'all' || (t?.subcategories || []).includes(poolCategory);
      if (!matchesCategory) return false;
      if (!q) return true;
      const name = String(t?.name || '').toLowerCase();
      const slug = String(t?.slug || '').toLowerCase();
      const author = String(t?.author_name || '').toLowerCase();
      return name.includes(q) || slug.includes(q) || author.includes(q);
    });
  }, [ultraPool, poolCategory, poolSearch]);

  const openPreview = useCallback((template: any) => {
    setPreviewTemplate(template);
    setIsPreviewOpen(true);
  }, []);

  const addToFeatured = useCallback(async (template: any) => {
    const exists = ultraFeaturedTemplates.some((t: any) => t.id === template.id);
    if (exists) return;
    const next = normalizePosition([...ultraFeaturedTemplates, template]);
    setUltraFeaturedTemplates(next);
    await persistUltraFeatured(next, 'Added to ultra featured');
  }, [ultraFeaturedTemplates, setUltraFeaturedTemplates, persistUltraFeatured]);

  const removeFromFeatured = useCallback(async (templateId: number) => {
    const next = normalizePosition(ultraFeaturedTemplates.filter((t: any) => t.id !== templateId));
    setUltraFeaturedTemplates(next);
    await persistUltraFeatured(next, 'Removed from ultra featured');
  }, [ultraFeaturedTemplates, setUltraFeaturedTemplates, persistUltraFeatured]);

  const moveFeatured = useCallback(async (templateId: number, direction: 'up' | 'down') => {
    const index = ultraFeaturedTemplates.findIndex((t: any) => t.id === templateId);
    if (index === -1) return;
    const nextIndex = direction === 'up' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= ultraFeaturedTemplates.length) return;

    const next = [...ultraFeaturedTemplates];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);

    const normalized = normalizePosition(next);
    setUltraFeaturedTemplates(normalized);
    await persistUltraFeatured(normalized, 'Ultra featured order updated');
  }, [ultraFeaturedTemplates, setUltraFeaturedTemplates, persistUltraFeatured]);

  const removeFromPool = useCallback((templateId: number) => {
    setUltraPool((prev: any[]) => prev.filter((t: any) => t.id !== templateId));
    toast.success('Removed from pool');
  }, [setUltraPool]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    try {
      const res = await fetch(`/api/admin/ultra-featured/search?query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${resolveAuthToken()}` },
      });
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setSearchResults(Array.isArray(data.results) ? data.results : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, resolveAuthToken]);

  const addSearchResultToPool = useCallback((template: any) => {
    setUltraPool((prev: any[]) => {
      if (prev.some((t: any) => t.id === template.id)) return prev;
      return [template, ...prev];
    });
    toast.success('Added to pool');
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
  }, [setUltraPool]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Ultra Featured
            </h2>
            <p className="text-sm text-gray-600 mt-1">Curate a small, ordered set of templates.</p>
          </div>
          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Search className="h-4 w-4 mr-2" />
                Search templates
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Search templates</DialogTitle>
              </DialogHeader>
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, slug, or author…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch();
                  }}
                />
                <Button onClick={() => void runSearch()} disabled={isSearching || !searchQuery.trim()}>
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
                </Button>
              </div>
              <div className="mt-4">
                <ScrollArea className="h-[360px] pr-3">
                  <div className="space-y-2">
                    {searchResults.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{t.name || t.slug}</div>
                          <div className="text-xs text-gray-500 truncate">{t.slug}</div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openPreview(t)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="sm" onClick={() => addSearchResultToPool(t)}>
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!isSearching && searchResults.length === 0 && (
                      <div className="text-sm text-gray-500">No results yet.</div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Ultra Featured List</h3>
              <p className="text-xs text-gray-500 mt-1">{ultraFeaturedTemplates.length} templates</p>
            </div>
            {isUltraSaving && (
              <Badge variant="secondary" className="gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving
              </Badge>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {ultraFeaturedTemplates.map((t: any, idx: number) => (
              <div key={t.id} className="flex items-center gap-3 border rounded-lg p-3">
                <div className="relative h-12 w-16 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                  {toAssetUrl(t.screenshot_path) ? (
                    <Image src={toAssetUrl(t.screenshot_path)!} alt={t.name || t.slug} fill className="object-contain object-top" unoptimized />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">{idx + 1}</Badge>
                    <div className="font-medium text-sm truncate">{t.name || t.slug}</div>
                  </div>
                  <div className="text-xs text-gray-500 truncate">{t.slug}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void moveFeatured(t.id, 'up')} disabled={idx === 0 || isUltraSaving}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void moveFeatured(t.id, 'down')} disabled={idx === ultraFeaturedTemplates.length - 1 || isUltraSaving}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openPreview(t)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeFromFeatured(t.id)} disabled={isUltraSaving}>
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            ))}
            {ultraFeaturedTemplates.length === 0 && (
              <div className="text-sm text-gray-500">No ultra featured templates yet.</div>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Pool</h3>
              <p className="text-xs text-gray-500 mt-1">{ultraPool.length} templates</p>
            </div>
            {isUltraLoading && (
              <Badge variant="secondary" className="gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading
              </Badge>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Input value={poolSearch} onChange={(e) => setPoolSearch(e.target.value)} placeholder="Filter pool…" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={poolCategory === 'all' ? 'default' : 'outline'} onClick={() => setPoolCategory('all')}>
                All
              </Button>
              {categories.slice(0, 12).map((cat) => (
                <Button
                  key={cat}
                  size="sm"
                  variant={poolCategory === cat ? 'default' : 'outline'}
                  onClick={() => setPoolCategory(cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-2">
                {filteredPool.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-3 border rounded-lg p-3">
                    <div className="relative h-12 w-16 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                      {toAssetUrl(t.screenshot_path) ? (
                        <Image src={toAssetUrl(t.screenshot_path)!} alt={t.name || t.slug} fill className="object-contain object-top" unoptimized />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{t.name || t.slug}</div>
                      <div className="text-xs text-gray-500 truncate">{t.author_name || t.slug}</div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openPreview(t)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" onClick={() => void addToFeatured(t)} disabled={isUltraSaving}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeFromPool(t.id)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
                {!isUltraLoading && filteredPool.length === 0 && (
                  <div className="text-sm text-gray-500">No templates match the current filter.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </Card>
      </div>

      <TemplatePreview
        template={previewTemplate}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
      />
    </div>
  );
}
