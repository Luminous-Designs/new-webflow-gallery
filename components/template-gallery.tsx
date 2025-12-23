'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import { Eye, X, Loader2, Search, Sparkles, ExternalLink, Calendar, User } from 'lucide-react';
import Image from 'next/image';
import { useInView } from '@/hooks/useInView';
import TemplatePreview from './template-preview';
import type { Template } from '@/types/template';
import { toAssetUrl } from '@/lib/assets';

// Cache for subcategories and styles (persists across component re-renders)
const metadataCache = {
  subcategories: null as {id: number; name: string; slug: string; display_name: string; template_count: number}[] | null,
  styles: null as {id: number; name: string; slug: string; display_name: string; template_count: number}[] | null,
  lastFetched: 0,
  CACHE_DURATION: 5 * 60 * 1000, // 5 minutes
};

// Prefetch cache for next page data
const prefetchCache = new Map<string, { data: any; timestamp: number }>();
const PREFETCH_CACHE_DURATION = 30 * 1000; // 30 seconds

interface TemplateCardProps {
  template: Template;
  onPreview: (template: Template) => void;
  onAuthorClick: (authorId: string, authorName: string) => void;
  /** Whether this image should be loaded with priority (for above-the-fold content) */
  priority?: boolean;
  /** Index of the template in the list (for lazy loading optimization) */
  index?: number;
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function TemplateCard({ template, onPreview, onAuthorClick, priority = false, index = 0 }: TemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // First 6 images get priority loading (above the fold on most screens)
  const shouldPrioritize = priority || index < 6;

  // Auto-scroll on hover
  useEffect(() => {
    if (isHovered && scrollRef.current) {
      const element = scrollRef.current;
      const scrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;
      const scrollDistance = scrollHeight - clientHeight;
      const duration = scrollDistance * 15;

      element.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
      element.style.transform = `translateY(-${scrollDistance}px)`;

      animationRef.current = setTimeout(() => {
        animationRef.current = setTimeout(() => {
          if (element) {
            element.style.transition = `transform ${duration / 2}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
            element.style.transform = 'translateY(0)';
          }
        }, 1000);
      }, duration);
    } else if (scrollRef.current) {
      const element = scrollRef.current;
      element.style.transition = 'transform 500ms ease-out';
      element.style.transform = 'translateY(0)';

      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, [isHovered]);

  const handleAuthorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (template.author_id && template.author_name) {
      onAuthorClick(template.author_id, template.author_name);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="group"
    >
      <div className="overflow-hidden bg-white border border-neutral-200 transition-all duration-300 hover:border-neutral-400">
        {/* Image Container */}
        <div
          className="relative aspect-[16/10] overflow-hidden bg-neutral-100"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {template.screenshot_path && toAssetUrl(template.screenshot_path) ? (
            <div ref={scrollRef} className="w-full">
              <Image
                src={toAssetUrl(template.screenshot_path)!}
                alt={template.name}
                width={1200}
                height={750}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className="w-full h-auto"
                priority={shouldPrioritize}
                loading={shouldPrioritize ? 'eager' : 'lazy'}
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-neutral-400 text-sm tracking-wide uppercase">No preview</span>
            </div>
          )}

          {/* Hover Overlay with Actions */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end">
            <div className="p-5 flex gap-3">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 bg-white/90 hover:bg-white text-neutral-900 border-0 rounded-none h-10 text-xs font-medium tracking-wide uppercase"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(template);
                }}
              >
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white border-0 rounded-none h-10 text-xs font-medium tracking-wide uppercase"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(template.storefront_url, '_blank');
                }}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Buy Now
              </Button>
            </div>
          </div>
        </div>

        {/* Card Content */}
        <div className="p-5 space-y-3 border-t border-neutral-100">
          {/* Template Name and Featured Badge */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-lg text-neutral-900 line-clamp-1 tracking-tight">
              {template.name}
            </h3>
            {template.is_featured_author && (
              <span className="shrink-0 inline-flex items-center gap-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                <Sparkles className="h-2.5 w-2.5" />
                Featured
              </span>
            )}
          </div>

          {/* Author and Date - Horizontal Layout */}
          <div className="flex items-center justify-between text-sm">
            {/* Author - Clickable */}
            <button
              onClick={handleAuthorClick}
              className="flex items-center gap-1.5 text-neutral-600 hover:text-neutral-900 transition-colors group/author"
              disabled={!template.author_id}
            >
              <User className="h-3.5 w-3.5" />
              <span className="group-hover/author:underline">
                {template.author_name || 'Unknown'}
              </span>
            </button>

            {/* Date Published */}
            <div className="flex items-center gap-1.5 text-neutral-500">
              <Calendar className="h-3.5 w-3.5" />
              <span className="text-xs tracking-wide">{formatDate(template.created_at)}</span>
            </div>
          </div>

          {/* Price */}
          <div className="pt-2 border-t border-neutral-100">
            <span className="text-xl font-semibold text-neutral-900 tracking-tight">
              {template.price || 'Free'}
            </span>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

interface TemplateGalleryProps {
  onTemplateSelect: (template: Template) => void;
}

export default function TemplateGallery({ onTemplateSelect }: TemplateGalleryProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 0, hasNext: true });
  const [selectedTag, setSelectedTag] = useState<{ slug: string; type: 'subcategory' | 'style' | '' }>({ slug: '', type: '' });
  const [selectedAuthor, setSelectedAuthor] = useState<{ id: string; name: string } | null>(null);
  const [collection, setCollection] = useState<'ultra' | 'all'>('ultra');
  const [subcategories, setSubcategories] = useState<{id: number; name: string; slug: string; display_name: string; template_count: number}[]>([]);
  const [styles, setStyles] = useState<{id: number; name: string; slug: string; display_name: string; template_count: number}[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [allTags, setAllTags] = useState<{
    id: number;
    name: string;
    slug: string;
    display_name: string;
    template_count: number;
    type: 'style' | 'subcategory';
  }[]>([]);

  // Refs for infinite scroll state management
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Minimum delay between fetches (debounce)
  const FETCH_DEBOUNCE_MS = 200;

  const normalizeTemplate = (template: any): Template => ({
    id: template.id,
    template_id: template.template_id,
    name: template.name,
    slug: template.slug,
    author_name: template.author_name,
    author_id: template.author_id,
    storefront_url: template.storefront_url,
    live_preview_url: template.live_preview_url,
    designer_preview_url: template.designer_preview_url,
    price: template.price,
    short_description: template.short_description,
    screenshot_path: template.screenshot_path,
    subcategories: Array.isArray(template.subcategories) ? template.subcategories : [],
    styles: Array.isArray(template.styles) ? template.styles : [],
    is_featured_author: template.is_featured_author,
    position: template.position,
    created_at: template.created_at
  });

  // Fetch subcategories and styles with caching
  useEffect(() => {
    const now = Date.now();
    const isCacheValid = metadataCache.lastFetched > 0 &&
                         (now - metadataCache.lastFetched) < metadataCache.CACHE_DURATION;

    // Use cached data if valid
    if (isCacheValid && metadataCache.subcategories && metadataCache.styles) {
      setSubcategories(metadataCache.subcategories);
      setStyles(metadataCache.styles);
      setAllTags([
        ...metadataCache.subcategories.map((cat: any) => ({ ...cat, type: 'subcategory' as const })),
        ...metadataCache.styles.map((style: any) => ({ ...style, type: 'style' as const }))
      ]);
      return;
    }

    // Fetch fresh data
    Promise.all([
      fetch('/api/subcategories').then(res => res.json()),
      fetch('/api/styles').then(res => res.json())
    ])
      .then(([subcatData, styleData]) => {
        // Update cache
        metadataCache.subcategories = subcatData;
        metadataCache.styles = styleData;
        metadataCache.lastFetched = Date.now();

        // Update state
        setSubcategories(subcatData);
        setStyles(styleData);
        setAllTags([
          ...subcatData.map((cat: any) => ({ ...cat, type: 'subcategory' as const })),
          ...styleData.map((style: any) => ({ ...style, type: 'style' as const }))
        ]);
      })
      .catch(console.error);
  }, []);

  // Build URL params for current filter state
  const buildParams = useCallback((page: number) => {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: '20'
    });

    if (selectedAuthor) {
      params.append('author', selectedAuthor.id);
    } else if (collection === 'ultra') {
      params.append('collection', 'ultra');
    } else if (selectedTag.slug) {
      if (selectedTag.type === 'subcategory') {
        params.append('subcategory', selectedTag.slug);
      } else if (selectedTag.type === 'style') {
        params.append('style', selectedTag.slug);
      }
    }

    return params;
  }, [collection, selectedTag.slug, selectedTag.type, selectedAuthor]);

  // Prefetch next page in background
  const prefetchNextPage = useCallback(async (nextPage: number) => {
    const params = buildParams(nextPage);
    const cacheKey = params.toString();

    // Check if already cached
    const cached = prefetchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < PREFETCH_CACHE_DURATION) {
      return; // Already prefetched
    }

    try {
      const response = await fetch(`/api/templates?${params}`);
      const data = await response.json();

      if (data.templates && data.pagination) {
        prefetchCache.set(cacheKey, {
          data,
          timestamp: Date.now()
        });

        // Preload images for prefetched templates
        data.templates.slice(0, 6).forEach((template: any) => {
          if (template.screenshot_path) {
            const url = toAssetUrl(template.screenshot_path);
            if (url) {
              const img = new window.Image();
              img.src = url;
            }
          }
        });
      }
    } catch {
      // Silently fail prefetch - it's not critical
    }
  }, [buildParams]);

  // Main fetch function with debouncing and abort support
  const fetchTemplates = useCallback(async (page: number, isReset: boolean = false) => {
    // Prevent concurrent fetches
    if (loadingRef.current) return;
    if (!isReset && !hasMoreRef.current) return;

    // Debounce rapid requests
    const now = Date.now();
    if (!isReset && (now - lastFetchTimeRef.current) < FETCH_DEBOUNCE_MS) {
      return;
    }
    lastFetchTimeRef.current = now;

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    loadingRef.current = true;
    if (isReset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = buildParams(page);
      const cacheKey = params.toString();

      // Check prefetch cache first
      const cached = prefetchCache.get(cacheKey);
      let data: any;

      if (cached && (Date.now() - cached.timestamp) < PREFETCH_CACHE_DURATION) {
        data = cached.data;
        prefetchCache.delete(cacheKey); // Consume the cache
      } else {
        const response = await fetch(`/api/templates?${params}`, {
          signal: abortControllerRef.current.signal
        });
        data = await response.json();
      }

      if (!data.templates || !data.pagination) return;

      const normalized = data.templates.map(normalizeTemplate);

      if (isReset) {
        setTemplates(normalized);
        pageRef.current = 2;
      } else {
        setTemplates(prev => [...prev, ...normalized]);
        pageRef.current = page + 1;
      }

      hasMoreRef.current = data.pagination.hasNext;
      setPageInfo({
        current: page,
        total: data.pagination.totalPages,
        hasNext: data.pagination.hasNext
      });

      // Prefetch next page if there's more data
      if (data.pagination.hasNext) {
        const nextPage = isReset ? 2 : page + 1;
        // Delay prefetch slightly to not compete with current render
        setTimeout(() => prefetchNextPage(nextPage + 1), 500);
      }

    } catch (error) {
      // Ignore abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Fetch error:', error);
      // Stop trying to load more on error to prevent infinite retry loops
      hasMoreRef.current = false;
      setPageInfo(prev => ({ ...prev, hasNext: false }));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildParams, prefetchNextPage]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Clear prefetch cache when filters change
  useEffect(() => {
    prefetchCache.clear();
  }, [collection, selectedTag.slug, selectedTag.type, selectedAuthor]);

  // Reset and fetch when filters change
  useEffect(() => {
    setTemplates([]);
    pageRef.current = 1;
    hasMoreRef.current = true;
    fetchTemplates(1, true);
  }, [fetchTemplates]);

  // Setup infinite scroll with early trigger (100% viewport from bottom)
  // Use the inView state to track when trigger element is visible
  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '100% 0px', // Trigger when within 100% of viewport height from bottom (loads early)
    threshold: 0,
  });

  // Effect-based infinite scroll that re-checks after loading completes
  // This handles the case where the trigger element stays in view after loading
  useEffect(() => {
    // Only proceed if we have templates and more to load
    if (templates.length === 0 || !hasMoreRef.current) return;

    // Skip if any loading is in progress
    if (loading || loadingMore) return;

    // Only trigger if we're in view and not currently loading
    if (inView && !loadingRef.current) {
      // Small delay to batch rapid state changes and allow DOM to settle
      const timer = setTimeout(() => {
        if (!loadingRef.current && hasMoreRef.current) {
          fetchTemplates(pageRef.current, false);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [inView, loading, loadingMore, templates.length, fetchTemplates]);

  // Handle author click - filter by author
  const handleAuthorClick = (authorId: string, authorName: string) => {
    setCollection('all');
    setSelectedTag({ slug: '', type: '' });
    setSelectedAuthor({ id: authorId, name: authorName });
  };

  // Clear all filters
  const clearFilters = () => {
    setCollection('all');
    setSelectedTag({ slug: '', type: '' });
    setSelectedAuthor(null);
  };

  // Get active filter display text
  const getActiveFilterText = () => {
    if (selectedAuthor) {
      return `Templates by ${selectedAuthor.name}`;
    }
    if (collection === 'ultra') {
      return 'Ultra Featured';
    }
    if (selectedTag.slug) {
      return allTags.find(t => t.slug === selectedTag.slug)?.display_name || selectedTag.slug;
    }
    return null;
  };

  const activeFilter = getActiveFilterText();

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Hero Section */}
      <header className="bg-white border-b border-neutral-200">
        <div className="w-full px-6 lg:px-12 py-16">
          <h1 className="text-4xl lg:text-5xl font-bold text-neutral-900 tracking-tight mb-4">
            Template Gallery
          </h1>
          <p className="text-lg text-neutral-600 max-w-2xl">
            Curated collection of premium Webflow templates for your next project
          </p>
        </div>
      </header>

      {/* Main Layout with Sidebar */}
      <div className="flex w-full">
        {/* Sidebar - Independently Scrollable */}
        <aside className="hidden lg:block w-72 xl:w-80 border-r border-neutral-200 bg-white sticky top-0 h-screen">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {/* Search */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Search Tags
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <Input
                    placeholder="Search..."
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0 h-10"
                  />
                </div>
              </div>

              {/* Collection Filters */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Collection
                </h3>
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setCollection('ultra');
                      setSelectedTag({ slug: '', type: '' });
                      setSelectedAuthor(null);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${
                      collection === 'ultra' && !selectedAuthor
                        ? 'bg-neutral-900 text-white'
                        : 'hover:bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Ultra Featured
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setCollection('all');
                      setSelectedTag({ slug: '', type: '' });
                      setSelectedAuthor(null);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      collection === 'all' && !selectedTag.slug && !selectedAuthor
                        ? 'bg-neutral-900 text-white'
                        : 'hover:bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    All Templates
                  </button>
                </div>
              </div>

              {/* Subcategories */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Categories
                </h3>
                <div className="space-y-1">
                  {subcategories
                    .filter(cat => !tagSearch || cat.display_name.toLowerCase().includes(tagSearch.toLowerCase()))
                    .map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => {
                          setCollection('all');
                          setSelectedTag({ slug: cat.slug, type: 'subcategory' });
                          setSelectedAuthor(null);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                          selectedTag.slug === cat.slug && selectedTag.type === 'subcategory' && !selectedAuthor
                            ? 'bg-neutral-900 text-white'
                            : 'hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <span>{cat.display_name}</span>
                        <span className="text-xs text-neutral-400">
                          {cat.template_count}
                        </span>
                      </button>
                    ))}
                </div>
              </div>

              {/* Styles */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Styles
                </h3>
                <div className="space-y-1">
                  {styles
                    .filter(style => !tagSearch || style.display_name.toLowerCase().includes(tagSearch.toLowerCase()))
                    .map((style) => (
                      <button
                        key={style.id}
                        onClick={() => {
                          setCollection('all');
                          setSelectedTag({ slug: style.slug, type: 'style' });
                          setSelectedAuthor(null);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                          selectedTag.slug === style.slug && selectedTag.type === 'style' && !selectedAuthor
                            ? 'bg-neutral-900 text-white'
                            : 'hover:bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        <span>{style.display_name}</span>
                        <span className="text-xs text-neutral-400">
                          {style.template_count}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </div>
          </ScrollArea>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {/* Mobile Filters */}
          <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-neutral-200 p-4">
            <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-hide">
              <Button
                size="sm"
                variant={collection === 'ultra' && !selectedAuthor ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('ultra');
                  setSelectedTag({ slug: '', type: '' });
                  setSelectedAuthor(null);
                }}
                className="rounded-none shrink-0"
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Featured
              </Button>
              <Button
                size="sm"
                variant={collection === 'all' && !selectedTag.slug && !selectedAuthor ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('all');
                  setSelectedTag({ slug: '', type: '' });
                  setSelectedAuthor(null);
                }}
                className="rounded-none shrink-0"
              >
                All
              </Button>
              {subcategories.slice(0, 5).map((cat) => (
                <Button
                  key={cat.id}
                  size="sm"
                  variant={selectedTag.slug === cat.slug && !selectedAuthor ? 'default' : 'outline'}
                  onClick={() => {
                    setCollection('all');
                    setSelectedTag({ slug: cat.slug, type: 'subcategory' });
                    setSelectedAuthor(null);
                  }}
                  className="rounded-none shrink-0"
                >
                  {cat.display_name}
                </Button>
              ))}
            </div>
          </div>

          {/* Active Filter Display */}
          {activeFilter && (
            <div className="px-6 lg:px-12 py-4 bg-white border-b border-neutral-200">
              <div className="flex items-center gap-3">
                <span className="text-sm text-neutral-500">Viewing:</span>
                <Badge
                  variant="secondary"
                  className="rounded-none bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer px-3 py-1 flex items-center gap-2"
                  onClick={clearFilters}
                >
                  {selectedAuthor && <User className="h-3 w-3" />}
                  {activeFilter}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              </div>
            </div>
          )}

          {/* Collection Info Banner */}
          {collection === 'ultra' && !selectedAuthor && (
            <div className="px-6 lg:px-12 py-3 bg-neutral-100 border-b border-neutral-200">
              <p className="text-sm text-neutral-600 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-neutral-500" />
                Hand-picked premium templates curated by our team
              </p>
            </div>
          )}

          {/* Author Filter Info Banner */}
          {selectedAuthor && (
            <div className="px-6 lg:px-12 py-3 bg-neutral-100 border-b border-neutral-200">
              <p className="text-sm text-neutral-600 flex items-center gap-2">
                <User className="h-4 w-4 text-neutral-500" />
                Showing all templates created by <span className="font-medium">{selectedAuthor.name}</span>
              </p>
            </div>
          )}

          {/* Template Grid */}
          <div className="px-6 lg:px-12 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
              {templates.map((template, index) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onPreview={setPreviewTemplate}
                  onAuthorClick={handleAuthorClick}
                  index={index}
                />
              ))}
            </div>

            {/* Initial Loading */}
            {loading && templates.length === 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 mt-8">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="border border-neutral-200 bg-white">
                    <Skeleton className="aspect-[16/10] rounded-none" />
                    <div className="p-5 space-y-4">
                      <Skeleton className="h-6 w-3/4 rounded-none" />
                      <Skeleton className="h-4 w-1/2 rounded-none" />
                      <Skeleton className="h-4 w-1/3 rounded-none" />
                      <Skeleton className="h-10 w-full rounded-none mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Load More Loading Skeletons */}
            {loadingMore && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8 mt-8">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="border border-neutral-200 bg-white">
                    <Skeleton className="aspect-[16/10] rounded-none" />
                    <div className="p-5 space-y-4">
                      <Skeleton className="h-6 w-3/4 rounded-none" />
                      <Skeleton className="h-4 w-1/2 rounded-none" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Infinite Scroll Trigger - Always rendered for reliable observation */}
            {templates.length > 0 && (
              <div
                ref={loadMoreRef}
                className="py-8"
                aria-hidden="true"
              >
                {/* Show loading indicator when fetching more */}
                {loadingMore && (
                  <div className="text-neutral-500 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    <span className="text-sm tracking-wide">Loading more templates...</span>
                  </div>
                )}

                {/* Show subtle indicator when more pages available but not loading */}
                {pageInfo.hasNext && !loadingMore && !loading && (
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-neutral-400 text-xs tracking-wide">
                      Scroll for more
                    </div>
                    {/* Manual load button as fallback */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => fetchTemplates(pageRef.current, false)}
                      className="text-neutral-500 hover:text-neutral-700"
                    >
                      Load More
                    </Button>
                  </div>
                )}

                {/* End of results message */}
                {!pageInfo.hasNext && !loadingMore && (
                  <div className="text-center py-4 border-t border-neutral-200">
                    <p className="text-neutral-500 text-sm tracking-wide">
                      Showing all {templates.length} templates
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* No Results */}
            {!loading && templates.length === 0 && (
              <div className="text-center py-20">
                <p className="text-neutral-500 text-lg">No templates found for the selected filters</p>
                <Button
                  variant="outline"
                  className="mt-4 rounded-none"
                  onClick={clearFilters}
                >
                  View All Templates
                </Button>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Template Preview Modal */}
      <TemplatePreview
        template={previewTemplate}
        isOpen={!!previewTemplate}
        onClose={() => setPreviewTemplate(null)}
        primaryAction={{
          label: 'Select Template',
          onClick: async (template, currentUrl) => {
            onTemplateSelect(template);
            void currentUrl;
          }
        }}
      />
    </div>
  );
}
