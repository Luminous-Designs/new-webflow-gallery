'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { motion } from 'framer-motion';
import { Eye, X, Loader2, Search, Sparkles, ExternalLink, Calendar, User, Star, ChevronDown, ChevronUp, FolderHeart, Settings } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useInView } from '@/hooks/useInView';
import TemplatePreview from './template-preview';
import type { Template } from '@/types/template';
import { toAssetUrl } from '@/lib/assets';
import { AuthButton } from '@/components/auth/auth-button';
import { SaveToCollectionButton } from '@/components/collections/save-to-collection-button';
import { useAuth } from '@/components/auth/auth-context';
import { AdminQueueWidget } from '@/components/admin-gallery/admin-queue-widget';
import { AdminTemplateToolsDialog } from '@/components/admin-gallery/admin-template-tools-dialog';

// Types for categories
interface CategoryItem {
  name: string;
  slug: string;
  display_name: string;
  template_count: number;
  type: 'primary' | 'subcategory';
}

interface SelectedFilter {
  name: string;
  slug: string;
  type: 'primary' | 'subcategory';
}

// Cache for categories (persists across component re-renders)
const categoryCache = {
  primaryCategories: null as CategoryItem[] | null,
  webflowSubcategories: null as CategoryItem[] | null,
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
  onCategoryClick?: (category: string, type: 'primary' | 'subcategory') => void;
  onAdminTools?: (template: Template) => void;
  isAdmin?: boolean;
  priority?: boolean;
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

function TemplateCard({ template, onPreview, onAuthorClick, onCategoryClick, onAdminTools, isAdmin = false, priority = false, index = 0 }: TemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  const shouldPrioritize = priority || index < 6;

  // Get the new category fields from template
  const primaryCategories = (template as any).primary_category as string[] | null;
  const webflowSubcategories = (template as any).webflow_subcategories as string[] | null;

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
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-between">
            {/* Save to Collection Button */}
            <div className="p-3 flex justify-end gap-2">
              {isAdmin ? (
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center bg-white/90 hover:bg-white text-neutral-900 border-0 rounded-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdminTools?.(template);
                  }}
                  aria-label="Admin tools"
                  title="Admin tools"
                >
                  <Settings className="h-4 w-4" />
                </button>
              ) : null}
              <SaveToCollectionButton
                templateId={template.id}
                templateName={template.name}
                thumbnailUrl={toAssetUrl(template.screenshot_path) ?? undefined}
              />
            </div>

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

          {/* Categories Display */}
          {(primaryCategories?.length || webflowSubcategories?.length) && (
            <div className="flex flex-wrap gap-1.5">
              {primaryCategories?.slice(0, 2).map((cat) => (
                <button
                  key={cat}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryClick?.(cat, 'primary');
                  }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-medium hover:bg-amber-100 transition-colors"
                >
                  <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                  {cat}
                </button>
              ))}
              {webflowSubcategories?.slice(0, 2).map((subcat) => (
                <button
                  key={subcat}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCategoryClick?.(subcat, 'subcategory');
                  }}
                  className="inline-flex items-center px-2 py-0.5 bg-neutral-100 text-neutral-600 text-[10px] font-medium hover:bg-neutral-200 transition-colors"
                >
                  {subcat}
                </button>
              ))}
            </div>
          )}

          {/* Author and Publish Date */}
          <div className="flex items-center justify-between text-sm">
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

            {template.publish_date && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-sm">
                <Calendar className="h-3 w-3" />
                <span className="text-[10px] font-medium tracking-wide">
                  {formatDate(template.publish_date)}
                </span>
              </div>
            )}
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

// My Collections Button - only shows for logged in users
function MyCollectionsButton() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <Link href="/collections">
      <Button
        variant="outline"
        className="rounded-none border-neutral-300 hover:border-neutral-900 hover:bg-neutral-50 h-10 text-sm font-medium"
      >
        <FolderHeart className="h-4 w-4 mr-2" />
        <span className="hidden sm:inline">My Collections</span>
        <span className="sm:hidden">Collections</span>
      </Button>
    </Link>
  );
}

interface TemplateGalleryProps {
  onTemplateSelect: (template: Template) => void;
}

export default function TemplateGallery({ onTemplateSelect }: TemplateGalleryProps) {
  const { isAdmin } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 0, hasNext: true });
  const [adminToolsTemplate, setAdminToolsTemplate] = useState<Template | null>(null);
  const [adminToolsOpen, setAdminToolsOpen] = useState(false);

  // New category state
  const [primaryCategories, setPrimaryCategories] = useState<CategoryItem[]>([]);
  const [webflowSubcategories, setWebflowSubcategories] = useState<CategoryItem[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<SelectedFilter[]>([]);
  const [categorySearch, setCategorySearch] = useState('');
  const [expandedSections, setExpandedSections] = useState({ primary: true, subcategory: true });

  // Other filters
  const [selectedAuthor, setSelectedAuthor] = useState<{ id: string; name: string } | null>(null);
  const [collection, setCollection] = useState<'ultra' | 'all'>('ultra');
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);

  // Refs for infinite scroll
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const lastFetchTimeRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
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
    created_at: template.created_at,
    // Add new fields
    primary_category: template.primary_category,
    webflow_subcategories: template.webflow_subcategories,
    publish_date: template.publish_date,
  });

  // Fetch categories with caching
  useEffect(() => {
    const now = Date.now();
    const isCacheValid = categoryCache.lastFetched > 0 &&
                         (now - categoryCache.lastFetched) < categoryCache.CACHE_DURATION;

    if (isCacheValid && categoryCache.primaryCategories && categoryCache.webflowSubcategories) {
      setPrimaryCategories(categoryCache.primaryCategories);
      setWebflowSubcategories(categoryCache.webflowSubcategories);
      return;
    }

    Promise.all([
      fetch('/api/primary-categories').then(res => res.json()),
      fetch('/api/webflow-subcategories').then(res => res.json())
    ])
      .then(([primaryData, subcatData]) => {
        // Handle API errors
        if (primaryData.error || subcatData.error) {
          console.error('Category fetch error:', primaryData.error || subcatData.error);
          return;
        }

        categoryCache.primaryCategories = primaryData;
        categoryCache.webflowSubcategories = subcatData;
        categoryCache.lastFetched = Date.now();

        setPrimaryCategories(primaryData);
        setWebflowSubcategories(subcatData);
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
    } else if (selectedFilters.length > 0) {
      // Group filters by type
      const primaryFilters = selectedFilters.filter(f => f.type === 'primary').map(f => f.name);
      const subcatFilters = selectedFilters.filter(f => f.type === 'subcategory').map(f => f.name);

      if (primaryFilters.length > 0) {
        params.append('primaryCategory', primaryFilters.join(','));
      }
      if (subcatFilters.length > 0) {
        params.append('webflowSubcategory', subcatFilters.join(','));
      }
    }

    return params;
  }, [collection, selectedFilters, selectedAuthor]);

  const handleAdminTools = useCallback((t: Template) => {
    setAdminToolsTemplate(t);
    setAdminToolsOpen(true);
  }, []);

  const handleTemplateScreenshotUpdated = useCallback((templateId: number, screenshotPath: string) => {
    setTemplates((prev) => prev.map((t) => (t.id === templateId ? { ...t, screenshot_path: screenshotPath } : t)));
  }, []);

  // Prefetch next page
  const prefetchNextPage = useCallback(async (nextPage: number) => {
    const params = buildParams(nextPage);
    const cacheKey = params.toString();

    const cached = prefetchCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < PREFETCH_CACHE_DURATION) {
      return;
    }

    try {
      const response = await fetch(`/api/templates?${params}`);
      const data = await response.json();

      if (data.templates && data.pagination) {
        prefetchCache.set(cacheKey, { data, timestamp: Date.now() });

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
      // Silently fail
    }
  }, [buildParams]);

  // Main fetch function
  const fetchTemplates = useCallback(async (page: number, isReset: boolean = false) => {
    if (loadingRef.current) return;
    if (!isReset && !hasMoreRef.current) return;

    const now = Date.now();
    if (!isReset && (now - lastFetchTimeRef.current) < FETCH_DEBOUNCE_MS) {
      return;
    }
    lastFetchTimeRef.current = now;

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

      const cached = prefetchCache.get(cacheKey);
      let data: any;

      if (cached && (Date.now() - cached.timestamp) < PREFETCH_CACHE_DURATION) {
        data = cached.data;
        prefetchCache.delete(cacheKey);
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

      if (data.pagination.hasNext) {
        const nextPage = isReset ? 2 : page + 1;
        setTimeout(() => prefetchNextPage(nextPage + 1), 500);
      }

    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('Fetch error:', error);
      hasMoreRef.current = false;
      setPageInfo(prev => ({ ...prev, hasNext: false }));
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [buildParams, prefetchNextPage]);

  // Cleanup
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
  }, [collection, selectedFilters, selectedAuthor]);

  // Reset and fetch when filters change
  useEffect(() => {
    setTemplates([]);
    pageRef.current = 1;
    hasMoreRef.current = true;
    fetchTemplates(1, true);
  }, [fetchTemplates]);

  // Infinite scroll
  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '100% 0px',
    threshold: 0,
  });

  useEffect(() => {
    if (templates.length === 0 || !hasMoreRef.current) return;
    if (loading || loadingMore) return;

    if (inView && !loadingRef.current) {
      const timer = setTimeout(() => {
        if (!loadingRef.current && hasMoreRef.current) {
          fetchTemplates(pageRef.current, false);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [inView, loading, loadingMore, templates.length, fetchTemplates]);

  // Filter handlers
  const addFilter = (name: string, type: 'primary' | 'subcategory') => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check if already selected
    if (selectedFilters.some(f => f.name === name && f.type === type)) {
      return;
    }

    setCollection('all');
    setSelectedAuthor(null);
    setSelectedFilters(prev => [...prev, { name, slug, type }]);
  };

  const removeFilter = (name: string, type: 'primary' | 'subcategory') => {
    setSelectedFilters(prev => prev.filter(f => !(f.name === name && f.type === type)));
  };

  const clearAllFilters = () => {
    setCollection('all');
    setSelectedFilters([]);
    setSelectedAuthor(null);
  };

  const handleAuthorClick = (authorId: string, authorName: string) => {
    setCollection('all');
    setSelectedFilters([]);
    setSelectedAuthor({ id: authorId, name: authorName });
  };

  const handleCategoryClick = (category: string, type: 'primary' | 'subcategory') => {
    addFilter(category, type);
  };

  // Filtered categories based on search
  const filteredPrimaryCategories = primaryCategories.filter(cat =>
    !categorySearch || cat.display_name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const filteredWebflowSubcategories = webflowSubcategories.filter(cat =>
    !categorySearch || cat.display_name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  // Combined search results for unified search dropdown
  const searchResults = categorySearch ? [
    ...filteredPrimaryCategories.slice(0, 5).map(c => ({ ...c, type: 'primary' as const })),
    ...filteredWebflowSubcategories.slice(0, 5).map(c => ({ ...c, type: 'subcategory' as const }))
  ] : [];

  const hasActiveFilters = selectedFilters.length > 0 || selectedAuthor !== null;

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Hero Section */}
      <header className="bg-white border-b border-neutral-200">
        <div className="w-full px-6 lg:px-12 py-12 lg:py-16">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
            <div>
              <h1 className="text-3xl lg:text-5xl font-bold text-neutral-900 tracking-tight mb-3 lg:mb-4">
                Template Gallery
              </h1>
              <p className="text-base lg:text-lg text-neutral-600 max-w-2xl">
                Curated collection of premium Webflow templates for your next project
              </p>
            </div>

            {/* Auth and Collections buttons */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <MyCollectionsButton />
              <AuthButton />
            </div>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex w-full">
        {/* Sidebar */}
        <aside className="hidden lg:block w-72 xl:w-80 border-r border-neutral-200 bg-white sticky top-0 h-screen">
          <ScrollArea className="h-full">
            <div className="p-6 space-y-6">
              {/* Unified Search */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  Search Categories
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                  <Input
                    placeholder="Search categories..."
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    className="pl-10 rounded-none border-neutral-300 focus:border-neutral-900 focus:ring-0 h-10"
                  />
                </div>

                {/* Search Results Dropdown */}
                {categorySearch && searchResults.length > 0 && (
                  <div className="absolute z-50 w-[calc(100%-3rem)] mt-1 bg-white border border-neutral-200 shadow-lg max-h-64 overflow-y-auto">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.type}-${result.slug}`}
                        onClick={() => {
                          addFilter(result.name, result.type);
                          setCategorySearch('');
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-neutral-100 flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2">
                          {result.type === 'primary' && (
                            <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                          )}
                          {result.display_name}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {result.template_count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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
                      setSelectedFilters([]);
                      setSelectedAuthor(null);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${
                      collection === 'ultra' && !hasActiveFilters
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
                      setSelectedFilters([]);
                      setSelectedAuthor(null);
                    }}
                    className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                      collection === 'all' && !hasActiveFilters
                        ? 'bg-neutral-900 text-white'
                        : 'hover:bg-neutral-100 text-neutral-700'
                    }`}
                  >
                    All Templates
                  </button>
                </div>
              </div>

              {/* Primary Categories Section */}
              <div className="space-y-3">
                <button
                  onClick={() => setExpandedSections(prev => ({ ...prev, primary: !prev.primary }))}
                  className="w-full flex items-center justify-between text-xs font-medium text-neutral-500 uppercase tracking-wider"
                >
                  <span className="flex items-center gap-2">
                    <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                    Primary Categories
                  </span>
                  {expandedSections.primary ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                {expandedSections.primary && (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {filteredPrimaryCategories.map((cat) => {
                      const isSelected = selectedFilters.some(f => f.name === cat.name && f.type === 'primary');
                      return (
                        <button
                          key={cat.slug}
                          onClick={() => isSelected ? removeFilter(cat.name, 'primary') : addFilter(cat.name, 'primary')}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                            isSelected
                              ? 'bg-amber-100 text-amber-900 border-l-2 border-amber-500'
                              : 'hover:bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <Star className={`h-3 w-3 ${isSelected ? 'fill-amber-500 text-amber-500' : 'text-neutral-300'}`} />
                            {cat.display_name}
                          </span>
                          <span className="text-xs text-neutral-400">
                            {cat.template_count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Subcategories Section */}
              <div className="space-y-3">
                <button
                  onClick={() => setExpandedSections(prev => ({ ...prev, subcategory: !prev.subcategory }))}
                  className="w-full flex items-center justify-between text-xs font-medium text-neutral-500 uppercase tracking-wider"
                >
                  Subcategories
                  {expandedSections.subcategory ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
                {expandedSections.subcategory && (
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {filteredWebflowSubcategories.map((cat) => {
                      const isSelected = selectedFilters.some(f => f.name === cat.name && f.type === 'subcategory');
                      return (
                        <button
                          key={cat.slug}
                          onClick={() => isSelected ? removeFilter(cat.name, 'subcategory') : addFilter(cat.name, 'subcategory')}
                          className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                            isSelected
                              ? 'bg-neutral-200 text-neutral-900 border-l-2 border-neutral-900'
                              : 'hover:bg-neutral-100 text-neutral-700'
                          }`}
                        >
                          <span>{cat.display_name}</span>
                          <span className="text-xs text-neutral-400">
                            {cat.template_count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
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
                variant={collection === 'ultra' && !hasActiveFilters ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('ultra');
                  setSelectedFilters([]);
                  setSelectedAuthor(null);
                }}
                className="rounded-none shrink-0"
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Featured
              </Button>
              <Button
                size="sm"
                variant={collection === 'all' && !hasActiveFilters ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('all');
                  setSelectedFilters([]);
                  setSelectedAuthor(null);
                }}
                className="rounded-none shrink-0"
              >
                All
              </Button>
              {primaryCategories.slice(0, 3).map((cat) => (
                <Button
                  key={cat.slug}
                  size="sm"
                  variant={selectedFilters.some(f => f.name === cat.name) ? 'default' : 'outline'}
                  onClick={() => {
                    const isSelected = selectedFilters.some(f => f.name === cat.name);
                    if (isSelected) {
                      removeFilter(cat.name, 'primary');
                    } else {
                      addFilter(cat.name, 'primary');
                    }
                  }}
                  className="rounded-none shrink-0"
                >
                  <Star className="h-3 w-3 mr-1 fill-current" />
                  {cat.display_name}
                </Button>
              ))}
            </div>
          </div>

          {/* Active Filters Display */}
          {(hasActiveFilters || collection === 'ultra') && (
            <div className="px-6 lg:px-12 py-4 bg-white border-b border-neutral-200">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-neutral-500 mr-2">Active Filters:</span>

                {collection === 'ultra' && !hasActiveFilters && (
                  <Badge
                    variant="secondary"
                    className="rounded-none bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer px-3 py-1 flex items-center gap-2"
                    onClick={() => setCollection('all')}
                  >
                    <Sparkles className="h-3 w-3" />
                    Ultra Featured
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                )}

                {selectedAuthor && (
                  <Badge
                    variant="secondary"
                    className="rounded-none bg-neutral-900 text-white hover:bg-neutral-800 cursor-pointer px-3 py-1 flex items-center gap-2"
                    onClick={() => setSelectedAuthor(null)}
                  >
                    <User className="h-3 w-3" />
                    {selectedAuthor.name}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                )}

                {selectedFilters.map((filter) => (
                  <Badge
                    key={`${filter.type}-${filter.name}`}
                    variant="secondary"
                    className={`rounded-none cursor-pointer px-3 py-1 flex items-center gap-2 ${
                      filter.type === 'primary'
                        ? 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                        : 'bg-neutral-200 text-neutral-900 hover:bg-neutral-300'
                    }`}
                    onClick={() => removeFilter(filter.name, filter.type)}
                  >
                    {filter.type === 'primary' && (
                      <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                    )}
                    {filter.name}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}

                {(selectedFilters.length > 1 || (selectedFilters.length > 0 && selectedAuthor)) && (
                  <button
                    onClick={clearAllFilters}
                    className="text-xs text-neutral-500 hover:text-neutral-700 underline ml-2"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Collection Info Banner */}
          {collection === 'ultra' && !hasActiveFilters && (
            <div className="px-6 lg:px-12 py-3 bg-neutral-100 border-b border-neutral-200">
              <p className="text-sm text-neutral-600 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-neutral-500" />
                Hand-picked premium templates curated by our team
              </p>
            </div>
          )}

          {/* Template Grid */}
          <div className="p-6 lg:p-12">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="space-y-4">
                    <Skeleton className="aspect-[16/10] w-full rounded-none" />
                    <Skeleton className="h-6 w-3/4 rounded-none" />
                    <Skeleton className="h-4 w-1/2 rounded-none" />
                  </div>
                ))}
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-neutral-500 text-lg">No templates found matching your filters.</p>
                <Button
                  variant="outline"
                  className="mt-4 rounded-none"
                  onClick={clearAllFilters}
                >
                  Clear Filters
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {templates.map((template, index) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onPreview={setPreviewTemplate}
                    onAuthorClick={handleAuthorClick}
                    onCategoryClick={handleCategoryClick}
                    isAdmin={isAdmin}
                    onAdminTools={handleAdminTools}
                    index={index}
                  />
                ))}
              </div>
            )}

            {/* Infinite Scroll Trigger */}
            {templates.length > 0 && (
              <div
                ref={loadMoreRef}
                className="mt-12 flex flex-col items-center justify-center py-8"
              >
                {loadingMore ? (
                  <div className="flex items-center gap-3 text-neutral-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Loading more templates...</span>
                  </div>
                ) : pageInfo.hasNext ? (
                  <div className="text-center space-y-3">
                    <div className="flex items-center gap-2 text-neutral-400 text-sm">
                      <span>Scroll for more</span>
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-none"
                      onClick={() => fetchTemplates(pageRef.current, false)}
                    >
                      Load More
                    </Button>
                  </div>
                ) : (
                  <p className="text-neutral-400 text-sm">
                    Showing all {templates.length} templates
                  </p>
                )}
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
          onClick: (template) => {
            onTemplateSelect(template);
            setPreviewTemplate(null);
          },
        }}
      />

      {isAdmin ? (
        <>
          <AdminQueueWidget onTemplateScreenshotUpdated={handleTemplateScreenshotUpdated} />
          <AdminTemplateToolsDialog
            template={adminToolsTemplate}
            open={adminToolsOpen}
            onOpenChange={(next) => setAdminToolsOpen(next)}
          />
        </>
      ) : null}
    </div>
  );
}
