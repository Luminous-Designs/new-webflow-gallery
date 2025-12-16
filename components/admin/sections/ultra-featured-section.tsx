/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
'use client';

import { useState, useCallback, useMemo, type DragEvent as ReactDragEvent } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAdmin } from '../admin-context';
import TemplatePreview from '@/components/template-preview';
import { toast } from 'sonner';
import {
  Search,
  Loader2,
  Plus,
  Link2,
  Image as ImageIcon,
  Move,
  ArrowLeft,
  ArrowRight,
  Sparkles
} from 'lucide-react';

export function UltraFeaturedSection() {
  const {
    ultraPool, ultraFeaturedTemplates, isUltraLoading, isUltraSaving,
    setUltraFeaturedTemplates, setUltraPool, persistUltraFeatured,
    queueThumbnailJob, pendingThumbnailMap, withCacheBust, resolveAuthToken
  } = useAdmin();

  // Drag and drop state
  const [draggingTemplate, setDraggingTemplate] = useState<{ template: any; origin: 'pool' | 'featured' } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Search state
  const [ultraSearchOpen, setUltraSearchOpen] = useState(false);
  const [ultraSearchQuery, setUltraSearchQuery] = useState('');
  const [ultraSearchResults, setUltraSearchResults] = useState<any[]>([]);
  const [isSearchingTemplates, setIsSearchingTemplates] = useState(false);

  // Category filter state
  const [poolCategory, setPoolCategory] = useState<string>('all');
  const [poolCategorySearch, setPoolCategorySearch] = useState('');

  // Link modal state
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkModalTemplate, setLinkModalTemplate] = useState<any | null>(null);
  const [templateLinks, setTemplateLinks] = useState<any[]>([]);
  const [linksFilter, setLinksFilter] = useState('');
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [isUpdatingThumbnail, setIsUpdatingThumbnail] = useState(false);
  const [thumbnailTarget, setThumbnailTarget] = useState('');

  // Preview state
  const [previewTemplate, setPreviewTemplate] = useState<any | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Link preview state
  const [isLinkPreviewOpen, setIsLinkPreviewOpen] = useState(false);
  const [linkPreviewIndex, setLinkPreviewIndex] = useState<number | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);

  // Pool categories
  const poolCategories = useMemo(() => {
    const unique = new Set<string>();
    ultraPool.forEach((template: any) => {
      (template.subcategories || []).forEach((cat: string) => {
        if (cat) unique.add(cat);
      });
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [ultraPool]);

  const visiblePoolCategories = useMemo(() => {
    if (!poolCategorySearch.trim()) return poolCategories;
    const query = poolCategorySearch.toLowerCase();
    return poolCategories.filter(cat => cat.toLowerCase().includes(query));
  }, [poolCategories, poolCategorySearch]);

  const filteredPoolTemplates = useMemo(() => {
    if (poolCategory === 'all') return ultraPool;
    return ultraPool.filter((template: any) => (template.subcategories || []).includes(poolCategory));
  }, [ultraPool, poolCategory]);

  const filteredLinks = useMemo(() => {
    const query = linksFilter.trim().toLowerCase();
    if (!query) return templateLinks;
    return templateLinks.filter((link: any) => {
      const path = (link.path || '').toLowerCase();
      const text = (link.text || '').toLowerCase();
      const url = (link.url || '').toLowerCase();
      return path.includes(query) || text.includes(query) || url.includes(query);
    });
  }, [templateLinks, linksFilter]);

  const currentLinkPreview = useMemo(() => {
    if (linkPreviewIndex === null) return null;
    return templateLinks[linkPreviewIndex] || null;
  }, [linkPreviewIndex, templateLinks]);

  // Drag handlers
  const handleDragStart = useCallback((template: any, origin: 'pool' | 'featured') => (event: ReactDragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(template.id));
    setDraggingTemplate({ template, origin });
    if (origin === 'featured') {
      const currentIndex = ultraFeaturedTemplates.findIndex(item => item.id === template.id);
      if (currentIndex !== -1) setDragOverIndex(currentIndex);
    }
  }, [ultraFeaturedTemplates]);

  const handleDragEnd = useCallback(() => {
    setDraggingTemplate(null);
    setDragOverIndex(null);
  }, []);

  const handleFeaturedDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!draggingTemplate) return;

    const updatedList = [...ultraFeaturedTemplates];
    let insertIndex = dragOverIndex !== null ? dragOverIndex : updatedList.length;
    const existingIndex = updatedList.findIndex(item => item.id === draggingTemplate.template.id);
    let changed = false;
    let message = 'Template order updated';

    if (draggingTemplate.origin === 'featured') {
      if (existingIndex === -1) return;
      const [item] = updatedList.splice(existingIndex, 1);
      if (existingIndex < insertIndex) insertIndex = Math.max(0, insertIndex - 1);
      updatedList.splice(insertIndex, 0, item);
      changed = existingIndex !== insertIndex;
    } else {
      if (existingIndex !== -1) {
        const [item] = updatedList.splice(existingIndex, 1);
        updatedList.splice(insertIndex, 0, item);
        changed = existingIndex !== insertIndex;
      } else {
        updatedList.splice(insertIndex, 0, draggingTemplate.template);
        changed = true;
        message = 'Template added to ultra featured';
      }
    }

    if (!changed) {
      setDraggingTemplate(null);
      setDragOverIndex(null);
      return;
    }

    const normalized = updatedList.map((item, index) => ({ ...item, position: index + 1 }));
    setUltraFeaturedTemplates(normalized);
    persistUltraFeatured(normalized, message);
    setDraggingTemplate(null);
    setDragOverIndex(null);
  }, [draggingTemplate, dragOverIndex, ultraFeaturedTemplates, setUltraFeaturedTemplates, persistUltraFeatured]);

  const handleRemoveFromUltra = useCallback((templateId: number) => {
    const updated = ultraFeaturedTemplates
      .filter((template) => template.id !== templateId)
      .map((template, index) => ({ ...template, position: index + 1 }));
    setUltraFeaturedTemplates(updated);
    persistUltraFeatured(updated, 'Template removed from ultra featured');
    setDragOverIndex(null);
  }, [ultraFeaturedTemplates, setUltraFeaturedTemplates, persistUltraFeatured]);

  // Template search
  const searchTemplates = useCallback(async (query: string) => {
    if (!query.trim()) {
      setUltraSearchResults([]);
      return;
    }

    try {
      setIsSearchingTemplates(true);
      const response = await fetch(`/api/admin/ultra-featured/search?query=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });
      if (response.ok) {
        const data = await response.json();
        setUltraSearchResults(data.results || []);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearchingTemplates(false);
    }
  }, [resolveAuthToken]);

  const handleAddTemplateToPool = useCallback((template: any) => {
    setUltraPool((prev: any[]) => {
      if (prev.some((item: any) => item.id === template.id)) return prev;
      return [{ ...template, _thumbUpdated: Date.now() }, ...prev];
    });
    toast.success('Template added to pool');
    setUltraSearchOpen(false);
  }, [setUltraPool]);

  // Link modal handlers
  const handleOpenThumbnailModal = useCallback(async (template: any) => {
    setLinkModalTemplate(template);
    setIsLinkModalOpen(true);
    setIsLoadingLinks(true);
    setThumbnailTarget(template.live_preview_url || '');
    setLinksFilter('');
    setTemplateLinks([]);

    try {
      const response = await fetch(`/api/admin/templates/${template.id}/links`, {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });
      if (response.ok) {
        const data = await response.json();
        setTemplateLinks(data.links || []);
      } else {
        toast.error('Failed to fetch preview links');
      }
    } catch (error) {
      toast.error('Failed to fetch preview links');
    } finally {
      setIsLoadingLinks(false);
    }
  }, [resolveAuthToken]);

  const handleThumbnailSwitch = useCallback(async (target?: string) => {
    if (!linkModalTemplate) {
      toast.error('Select a link before updating the thumbnail');
      return;
    }

    const selectedTarget = target || thumbnailTarget;
    if (!selectedTarget) {
      toast.error('Select a link before updating the thumbnail');
      return;
    }

    setThumbnailTarget(selectedTarget);
    setIsUpdatingThumbnail(true);

    const success = await queueThumbnailJob(linkModalTemplate.id, selectedTarget);
    if (success) {
      setIsLinkModalOpen(false);
      setIsLinkPreviewOpen(false);
      setLinkPreviewIndex(null);
      setThumbnailTarget('');
    }
    setIsUpdatingThumbnail(false);
  }, [linkModalTemplate, thumbnailTarget, queueThumbnailJob]);

  const handlePreviewTemplate = useCallback((template: any) => {
    setPreviewTemplate(template);
    setIsPreviewOpen(true);
  }, []);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-500" />
              <h2 className="text-xl font-semibold">Ultra-Featured Templates</h2>
            </div>
            <p className="text-sm text-gray-600 mt-1">
              Handpick the templates that appear first in the gallery. Drag from the pool into the ultra-featured column.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isUltraSaving && (
              <Badge variant="secondary" className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving
              </Badge>
            )}
            <Dialog open={ultraSearchOpen} onOpenChange={setUltraSearchOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Add Templates</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add templates to the pool</DialogTitle>
                  <DialogDescription>Search across all templates in the database.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      autoFocus
                      placeholder="Search by name, slug, or tags..."
                      value={ultraSearchQuery}
                      onChange={(e) => { setUltraSearchQuery(e.target.value); searchTemplates(e.target.value); }}
                      className="pl-10"
                    />
                  </div>
                  <div className="border rounded-lg max-h-72 overflow-y-auto">
                    {isSearchingTemplates ? (
                      <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching...
                      </div>
                    ) : ultraSearchResults.length === 0 ? (
                      <div className="py-10 text-center text-sm text-gray-500">
                        {ultraSearchQuery.trim() ? 'No templates match that search.' : 'Start typing to search.'}
                      </div>
                    ) : (
                      <div className="space-y-1 p-2">
                        {ultraSearchResults.map((template: any) => (
                          <button
                            key={template.id}
                            className="w-full text-left p-3 rounded-md hover:bg-gray-50 transition flex items-start gap-3"
                            onClick={() => handleAddTemplateToPool(template)}
                          >
                            <div className="w-16 h-12 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                              {template.screenshot_thumbnail_path ? (
                                <Image src={template.screenshot_thumbnail_path} alt={template.name} width={64} height={48}
                                  className="w-full h-full object-cover" sizes="64px" />
                              ) : (
                                <ImageIcon className="h-5 w-5 text-gray-400" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{template.name}</p>
                              <p className="text-xs text-gray-500">{template.author_name || 'Unknown author'}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Template Pool */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Template Pool</h3>
              <Badge variant="secondary">{ultraPool.length}</Badge>
            </div>
            <p className="text-sm text-gray-500">
              Templates from featured authors. Drag a card to the Ultra Featured column.
            </p>
            <div className="border rounded-lg bg-white flex flex-col h-[520px]">
              {isUltraLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />Loading...
                </div>
              ) : (
                <>
                  <div className="space-y-3 border-b border-gray-100 p-4 shrink-0">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input placeholder="Search categories..." value={poolCategorySearch}
                        onChange={(e) => setPoolCategorySearch(e.target.value)} className="pl-10" />
                    </div>
                    <div className="overflow-x-auto pb-2">
                      <div className="flex gap-2 whitespace-nowrap pr-4">
                        <Button size="sm" variant={poolCategory === 'all' ? 'default' : 'outline'}
                          onClick={() => setPoolCategory('all')}>All</Button>
                        {visiblePoolCategories.map((cat) => (
                          <Button key={cat} size="sm" variant={poolCategory === cat ? 'default' : 'outline'}
                            onClick={() => setPoolCategory(cat)}>{cat}</Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <ScrollArea className="flex-1 px-4 pb-4">
                    {filteredPoolTemplates.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-gray-500">
                        <Sparkles className="h-5 w-5" />No templates match.
                      </div>
                    ) : (
                      <div className="space-y-3 pt-4">
                        {filteredPoolTemplates.map((template: any) => {
                          const isSelected = draggingTemplate?.template.id === template.id;
                          const thumbSrc = withCacheBust(template.screenshot_thumbnail_path, template._thumbUpdated);
                          const pendingInfo = pendingThumbnailMap.get(template.id);
                          return (
                            <div key={template.id} draggable onDragStart={handleDragStart(template, 'pool')} onDragEnd={handleDragEnd}
                              className={`border rounded-lg p-3 bg-white shadow-sm transition hover:shadow-md cursor-move ${isSelected ? 'opacity-60' : ''}`}>
                              <div className="flex gap-3">
                                <div className="w-20 h-16 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                                  {thumbSrc ? <Image src={thumbSrc} alt={template.name} width={80} height={64} className="w-full h-full object-cover" sizes="80px" />
                                    : <ImageIcon className="h-4 w-4 text-gray-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="font-medium text-sm truncate">{template.name}</p>
                                      <p className="text-xs text-gray-500 truncate">{template.author_name || 'Unknown'}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {pendingInfo && (
                                        <Badge variant="outline" className={`text-[10px] ${
                                          pendingInfo.status === 'failed' ? 'border-red-300 text-red-600 bg-red-50' :
                                          pendingInfo.status === 'running' ? 'border-blue-300 text-blue-600 bg-blue-50' :
                                          'border-amber-300 text-amber-600 bg-amber-50'}`}>
                                          {pendingInfo.status === 'running' ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Processing</span>
                                            : pendingInfo.status === 'pending' ? 'Queued' : 'Failed'}
                                        </Badge>
                                      )}
                                      <Move className="h-4 w-4 text-gray-400" />
                                    </div>
                                  </div>
                                  <div className="mt-2">
                                    <Button size="sm" variant="outline" draggable={false}
                                      onClick={(e) => { e.stopPropagation(); handlePreviewTemplate(template); }}>Preview</Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </>
              )}
            </div>
          </div>

          {/* Ultra Featured Order */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Ultra Featured Order</h3>
              <Badge variant="default">{ultraFeaturedTemplates.length}</Badge>
            </div>
            <p className="text-sm text-gray-500">The order here is exactly how templates appear on the homepage.</p>
            <div className={`border rounded-lg h-[520px] bg-white ${draggingTemplate ? 'border-purple-400 border-dashed' : ''}`}
              onDrop={handleFeaturedDrop}
              onDragOver={(e) => { if (!draggingTemplate) return; e.preventDefault(); if (dragOverIndex === null) setDragOverIndex(ultraFeaturedTemplates.length); }}>
              {ultraFeaturedTemplates.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-gray-500">
                  <Sparkles className="h-5 w-5" />Drag templates here to curate the collection.
                </div>
              ) : (
                <ScrollArea className="h-[520px] p-4">
                  <div className="space-y-3">
                    {ultraFeaturedTemplates.map((template: any, index: number) => {
                      const pendingInfo = pendingThumbnailMap.get(template.id);
                      const disableSwitch = Boolean(pendingInfo && pendingInfo.status !== 'failed');
                      return (
                        <div key={template.id} draggable onDragStart={handleDragStart(template, 'featured')} onDragEnd={handleDragEnd}
                          onDragEnter={() => setDragOverIndex(index)}
                          className={`border rounded-lg p-3 bg-white shadow-sm transition cursor-move ${dragOverIndex === index ? 'ring-2 ring-purple-400' : ''}`}>
                          <div className="flex gap-3">
                            <div className="w-24 h-20 rounded bg-gray-100 overflow-hidden flex items-center justify-center">
                              {template.screenshot_thumbnail_path ? (
                                <Image src={withCacheBust(template.screenshot_thumbnail_path, template._thumbUpdated)}
                                  alt={template.name} width={96} height={80} className="w-full h-full object-cover" sizes="96px" />
                              ) : <ImageIcon className="h-5 w-5 text-gray-400" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-semibold text-sm truncate">{index + 1}. {template.name}</p>
                                  <p className="text-xs text-gray-500 truncate">{template.author_name || 'Unknown'}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {pendingInfo && (
                                    <Badge variant="outline" className={`text-[10px] ${
                                      pendingInfo.status === 'failed' ? 'border-red-300 text-red-600 bg-red-50' :
                                      pendingInfo.status === 'running' ? 'border-blue-300 text-blue-600 bg-blue-50' :
                                      'border-amber-300 text-amber-600 bg-amber-50'}`}>
                                      {pendingInfo.status === 'running' ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Processing</span>
                                        : pendingInfo.status === 'pending' ? 'Queued' : 'Failed'}
                                    </Badge>
                                  )}
                                  <Move className="h-4 w-4 text-gray-400" />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1 mt-2">
                                {(template.subcategories || []).slice(0, 3).map((tag: string, i: number) => (
                                  <Badge key={`${template.id}-tag-${i}`} variant="outline" className="text-[10px]">{tag}</Badge>
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-2 mt-3">
                                <Button size="sm" variant="outline" disabled={disableSwitch || isUpdatingThumbnail}
                                  onClick={() => handleOpenThumbnailModal(template)} className="flex items-center gap-1">
                                  <ImageIcon className="h-3 w-3" />
                                  {pendingInfo?.status === 'running' ? 'Processing' : pendingInfo?.status === 'pending' ? 'Queued' : 'Switch Thumbnail'}
                                </Button>
                                <Button size="sm" variant="outline" draggable={false}
                                  onClick={(e) => { e.stopPropagation(); handlePreviewTemplate(template); }}>Preview</Button>
                                <Button size="sm" variant="outline" asChild>
                                  <a href={template.live_preview_url} target="_blank" rel="noreferrer" className="flex items-center gap-1">
                                    <Link2 className="h-3 w-3" />Open Site
                                  </a>
                                </Button>
                                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                                  onClick={() => handleRemoveFromUltra(template.id)}>Remove</Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {draggingTemplate && dragOverIndex === ultraFeaturedTemplates.length && (
                      <div className="border-2 border-dashed border-purple-300 rounded-lg p-4 text-center text-xs text-purple-600">
                        Drop here to place at the end
                      </div>
                    )}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Link Modal */}
      <Dialog open={isLinkModalOpen} onOpenChange={setIsLinkModalOpen}>
        <DialogContent className="max-w-2xl" showCloseButton={!isUpdatingThumbnail}>
          <DialogHeader>
            <DialogTitle>Switch thumbnail source</DialogTitle>
            <DialogDescription>Choose a page from {linkModalTemplate?.name || 'the template'} to generate a new screenshot.</DialogDescription>
          </DialogHeader>

          {linkModalTemplate && (
            <div className="text-sm text-gray-600 mb-4 break-all">
              Current preview URL: <span className="font-medium text-gray-800">{linkModalTemplate.live_preview_url}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input placeholder="Filter links..." value={linksFilter} onChange={(e) => setLinksFilter(e.target.value)} className="pl-10" />
            </div>

            <div className="border rounded-lg max-h-80 overflow-hidden">
              {isLoadingLinks ? (
                <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Fetching links...
                </div>
              ) : filteredLinks.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-500">
                  {templateLinks.length === 0 ? 'No internal links detected.' : 'No links match the filter.'}
                </div>
              ) : (
                <ScrollArea className="h-80">
                  <div className="space-y-2 p-3">
                    {filteredLinks.map((link: any) => {
                      const isSelected = thumbnailTarget === link.url;
                      return (
                        <div key={link.url} className={`border rounded-md p-3 transition ${isSelected ? 'border-purple-400 bg-purple-50/60' : 'border-gray-200 hover:bg-gray-50'}`}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm text-gray-800 break-all">{link.url}</span>
                              {link.path && <div className="text-xs text-gray-500">Path: {link.path}</div>}
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button size="sm" variant="outline" onClick={() => { setLinkPreviewIndex(templateLinks.indexOf(link)); setIsLinkPreviewOpen(true); }}>
                                Preview
                              </Button>
                              <Button size="sm" onClick={() => handleThumbnailSwitch(link.url)} disabled={isUpdatingThumbnail}>
                                {isUpdatingThumbnail && isSelected ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</> : 'Use Page'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={isUpdatingThumbnail}>Cancel</Button></DialogClose>
            <Button onClick={() => handleThumbnailSwitch()} disabled={!thumbnailTarget || isUpdatingThumbnail}>
              {isUpdatingThumbnail ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</> : 'Update Thumbnail'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link Preview Dialog */}
      <Dialog open={isLinkPreviewOpen} onOpenChange={(open) => { if (!open) { setIsLinkPreviewOpen(false); setLinkPreviewIndex(null); } }}>
        <DialogContent className="w-full h-[85vh] flex flex-col" style={{ width: '90vw', maxWidth: '90vw' }}>
          <DialogHeader className="shrink-0 border-b p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setLinkPreviewIndex(prev => Math.max(0, (prev ?? 0) - 1))}
                  disabled={linkPreviewIndex === 0}><ArrowLeft className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setLinkPreviewIndex(prev => Math.min(templateLinks.length - 1, (prev ?? 0) + 1))}
                  disabled={linkPreviewIndex === templateLinks.length - 1}><ArrowRight className="h-4 w-4" /></Button>
                <div className="text-sm text-gray-600 break-all max-w-xs sm:max-w-md">
                  {currentLinkPreview?.path || currentLinkPreview?.url || 'Select a link'}
                </div>
              </div>
              <Button size="sm" onClick={() => currentLinkPreview && handleThumbnailSwitch(currentLinkPreview.url)}
                disabled={!currentLinkPreview || isUpdatingThumbnail}>
                {isUpdatingThumbnail ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Updating...</> : 'Set as Thumbnail'}
              </Button>
            </div>
          </DialogHeader>

          <div className="flex-1 bg-gray-100 p-4">
            {currentLinkPreview ? (
              <div className="relative w-full h-full bg-white rounded-lg shadow overflow-hidden">
                {linkPreviewLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
                  </div>
                )}
                <iframe key={currentLinkPreview.url} src={`/api/proxy?url=${encodeURIComponent(currentLinkPreview.url)}`}
                  className="w-full h-full border-0" title="Link Preview" onLoad={() => setLinkPreviewLoading(false)}
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms" />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">Select a link to preview</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Template Preview */}
      <TemplatePreview
        template={previewTemplate}
        isOpen={isPreviewOpen}
        onClose={() => { setIsPreviewOpen(false); setPreviewTemplate(null); }}
        primaryAction={{
          label: 'Add to Ultra Featured',
          onClick: async (template, currentUrl) => {
            const updatedList = ultraFeaturedTemplates.some((item: any) => item.id === template.id)
              ? ultraFeaturedTemplates.map((item: any) => item.id === template.id ? { ...item, ...template, _thumbUpdated: Date.now() } : item)
              : [...ultraFeaturedTemplates, { ...template as any, _thumbUpdated: Date.now() }];
            const normalized = updatedList.map((item: any, index: number) => ({ ...item, position: index + 1, _thumbUpdated: item._thumbUpdated ?? Date.now() }));
            setUltraFeaturedTemplates(normalized);
            setUltraPool((prev: any[]) => prev.filter((item: any) => item.id !== template.id));
            persistUltraFeatured(normalized);
            queueThumbnailJob(template.id, currentUrl || template.live_preview_url, { successMessage: 'Template added and screenshot queued.' });
            setIsPreviewOpen(false);
          }
        }}
      />
    </div>
  );
}
