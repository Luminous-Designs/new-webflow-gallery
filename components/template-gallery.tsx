'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { motion } from 'framer-motion';
import { Eye, X, Loader2, Search, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { useInView } from '@/hooks/useInView';
import TemplatePreview from './template-preview';
import type { Template } from '@/types/template';
import { toAssetUrl } from '@/lib/assets';

interface TemplateCardProps {
  template: Template;
  onSelect: (template: Template) => void;
  onPreview: (template: Template) => void;
}

function TemplateCard({ template, onSelect, onPreview }: TemplateCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll on hover
  useEffect(() => {
    if (isHovered && scrollRef.current) {
      const element = scrollRef.current;
      const scrollHeight = element.scrollHeight;
      const clientHeight = element.clientHeight;
      const scrollDistance = scrollHeight - clientHeight;
      const duration = scrollDistance * 15; // Adjust speed here

      // Start scrolling animation
      element.style.transition = `transform ${duration}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
      element.style.transform = `translateY(-${scrollDistance}px)`;

      animationRef.current = setTimeout(() => {
        // Pause at bottom
        animationRef.current = setTimeout(() => {
          // Scroll back up
          if (element) {
            element.style.transition = `transform ${duration / 2}ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
            element.style.transform = 'translateY(0)';
          }
        }, 1000);
      }, duration);
    } else if (scrollRef.current) {
      // Reset scroll on hover out
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="overflow-hidden group hover:shadow-xl transition-all duration-300 p-0">
        <div
          className="relative aspect-[16/10] overflow-hidden bg-gray-100"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {template.screenshot_path && toAssetUrl(template.screenshot_path) ? (
            <div ref={scrollRef} className="w-full">
              <Image
                src={toAssetUrl(template.screenshot_path)!}
                alt={template.name}
                width={800}
                height={500}
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                className="w-full h-auto"
              />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-gray-400">No preview available</span>
            </div>
          )}

          {/* Overlay with actions */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="absolute bottom-4 left-4 right-4 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(template);
                }}
              >
                <Eye className="h-4 w-4 mr-1" />
                Preview
              </Button>
              <Button
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(template);
                }}
              >
                Select
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-lg line-clamp-1">{template.name}</h3>
            {template.is_featured_author && (
              <Badge variant="default" className="bg-purple-600 hover:bg-purple-700 shrink-0">
                Featured
              </Badge>
            )}
          </div>

          {template.price && (
            <Badge variant="secondary">{template.price}</Badge>
          )}

          <div className="flex gap-2 flex-wrap">
            {template.subcategories.map((cat, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {cat}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </motion.div>
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
  const [collection, setCollection] = useState<'ultra' | 'all'>('ultra');
  const [subcategories, setSubcategories] = useState<{id: number; name: string; slug: string; display_name: string; template_count: number}[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [allTags, setAllTags] = useState<{
    id: number;
    name: string;
    slug: string;
    display_name: string;
    template_count: number;
    type: 'style' | 'subcategory';
  }[]>([]);
  const { ref: loadMoreRef, inView } = useInView({ threshold: 0.1 });
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
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
    position: template.position
  });

  // Fetch subcategories and all tags
  useEffect(() => {
    // Fetch subcategories
    fetch('/api/subcategories')
      .then(res => res.json())
      .then(data => {
        setSubcategories(data);
        // Combine subcategories and styles for tag search
        setAllTags(data.map((cat: any) => ({ ...cat, type: 'subcategory' })));
      })
      .catch(console.error);

    // Fetch styles
    fetch('/api/styles')
      .then(res => res.json())
      .then(data => {
        setAllTags(prev => [...prev, ...data.map((style: any) => ({ ...style, type: 'style' }))]);
      })
      .catch(console.error);
  }, []);

  // Main fetch function
  const fetchTemplates = useCallback(async (page: number, isReset: boolean = false) => {
    // Prevent duplicate calls
    if (loadingRef.current) {
      console.log('⏸️ Already loading, skipping fetch');
      return;
    }

    if (!isReset && !hasMoreRef.current) {
      console.log('🛑 No more pages to load');
      return;
    }

    console.log(`📥 Fetching page ${page}, reset: ${isReset}, tag: ${selectedTag.slug || 'all'}, collection: ${collection}`);

    loadingRef.current = true;
    if (isReset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });

      if (collection === 'ultra') {
        params.append('collection', 'ultra');
      } else if (selectedTag.slug) {
        if (selectedTag.type === 'subcategory') {
          params.append('subcategory', selectedTag.slug);
        } else if (selectedTag.type === 'style') {
          params.append('style', selectedTag.slug);
        }
      }

      const url = `/api/templates?${params}`;
      console.log(`🌐 API URL: ${url}`);

      const response = await fetch(url);
      const data = await response.json();

      if (!data.templates || !data.pagination) {
        console.error('❌ Invalid API response structure:', data);
        return;
      }

      console.log(`✅ Received ${data.templates.length} templates, hasNext: ${data.pagination.hasNext}`);

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

    } catch (error) {
      console.error('❌ Fetch error:', error);
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [collection, selectedTag.slug, selectedTag.type]);

  // Reset and fetch when tag changes
  useEffect(() => {
    console.log('🔄 Tag changed, resetting...');
    setTemplates([]);
    pageRef.current = 1;
    hasMoreRef.current = true;
    fetchTemplates(1, true);
  }, [fetchTemplates]);

  // Handle infinite scroll
  useEffect(() => {
    if (inView && !loadingRef.current && hasMoreRef.current && templates.length > 0) {
      console.log(`👀 In view! Loading page ${pageRef.current}`);
      fetchTemplates(pageRef.current, false);
    }
  }, [fetchTemplates, inView, templates.length])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-12">
          <h1 className="text-4xl font-bold mb-4">Select Your Webflow Template</h1>
          <p className="text-lg text-gray-600">
            Choose from our curated collection of premium templates to kickstart your redesign
          </p>
        </div>
      </div>

      {/* Removed Featured Authors Section - templates from featured authors are now prioritized in the main grid */}

      {/* Tag Search and Subcategory Filters */}
      <div className="container mx-auto px-4 py-4 space-y-4">
        {/* Tag Search Box */}
        <div className="relative max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search tags (e.g. portfolio, agency, minimal)..."
              value={tagSearch}
              onChange={(e) => {
                setTagSearch(e.target.value);
                setShowSuggestions(e.target.value.length > 0);
              }}
              onFocus={() => setShowSuggestions(tagSearch.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              className="pl-10"
            />
          </div>

          {/* Tag Suggestions Dropdown */}
          {showSuggestions && (
            <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto">
              {allTags
                .filter(tag =>
                  tag.display_name.toLowerCase().includes(tagSearch.toLowerCase()) ||
                  tag.slug.toLowerCase().includes(tagSearch.toLowerCase())
                )
                .slice(0, 10)
                .map((tag) => (
                  <button
                    key={`${tag.type}-${tag.id}`}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between"
                    onClick={() => {
                      setCollection('all');
                      setSelectedTag({ slug: tag.slug, type: tag.type });
                      setTagSearch('');
                      setShowSuggestions(false);
                    }}
                  >
                    <span className="font-medium">{tag.display_name}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {tag.type}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {tag.template_count}
                      </Badge>
                    </div>
                  </button>
                ))}
              {allTags.filter(tag =>
                tag.display_name.toLowerCase().includes(tagSearch.toLowerCase()) ||
                tag.slug.toLowerCase().includes(tagSearch.toLowerCase())
              ).length === 0 && (
                <div className="px-4 py-3 text-gray-500 text-sm">
                  No tags found matching {tagSearch}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Subcategory Filter Chips */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-gray-600">Filter by category:</span>
            {selectedTag.slug && (
              <Badge
                variant="default"
                className="cursor-pointer"
                onClick={() => {
                  setCollection('all');
                  setSelectedTag({ slug: '', type: '' });
                }}
              >
                {allTags.find(t => t.slug === selectedTag.slug)?.display_name}
                <X className="h-3 w-3 ml-1" />
              </Badge>
            )}
          </div>
          {collection === 'ultra' && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-purple-100 bg-purple-50 px-3 py-2 text-sm text-purple-700">
              <Sparkles className="h-4 w-4" />
              Showing ultra-featured templates curated by our team.
            </div>
          )}
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 whitespace-nowrap pr-4">
              <Button
                size="sm"
                variant={collection === 'ultra' ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('ultra');
                  setSelectedTag({ slug: '', type: '' });
                }}
                className="whitespace-nowrap"
              >
                Ultra Featured
              </Button>
              <Button
                size="sm"
                variant={collection === 'all' && selectedTag.slug === '' ? 'default' : 'outline'}
                onClick={() => {
                  setCollection('all');
                  setSelectedTag({ slug: '', type: '' });
                }}
                className="whitespace-nowrap"
              >
                All
              </Button>
              {subcategories.map((cat) => (
                <Button
                  key={cat.id}
                  size="sm"
                  variant={selectedTag.slug === cat.slug && selectedTag.type === 'subcategory' ? 'default' : 'outline'}
                  onClick={() => {
                    setCollection('all');
                    setSelectedTag({ slug: cat.slug, type: 'subcategory' });
                  }}
                  className="whitespace-nowrap"
                >
                  {cat.display_name}
                  <Badge variant="secondary" className="ml-2">
                    {cat.template_count}
                  </Badge>
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Template Grid */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={onTemplateSelect}
              onPreview={setPreviewTemplate}
            />
          ))}
        </div>

        {/* Initial loading indicator */}
        {loading && templates.length === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
            {[...Array(8)].map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-square" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Load more indicator */}
        {loadingMore && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="aspect-square" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Load more trigger */}
        {pageInfo.hasNext && !loading && !loadingMore && templates.length > 0 && (
          <div ref={loadMoreRef} className="py-8 flex flex-col items-center justify-center gap-4">
            <div className="text-gray-500 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              <span>Scroll to load more templates...</span>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                console.log('🖱️ Manual load more clicked');
                fetchTemplates(pageRef.current, false);
              }}
              disabled={loadingMore}
            >
              Load More Templates
            </Button>
          </div>
        )}

        {!pageInfo.hasNext && templates.length > 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">
              {templates.length === 0
                ? 'No templates found'
                : `Showing all ${templates.length} templates`}
            </p>
          </div>
        )}

        {!loading && templates.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No templates found for the selected filters</p>
          </div>
        )}
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
