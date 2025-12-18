/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { toAssetUrl } from '@/lib/assets';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import TemplatePreview from '@/components/template-preview';
import { useAdmin } from '../admin-context';
import { Loader2, Search, Sparkles, Eye, ExternalLink, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Author = {
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  template_count?: number;
};

function normalizePosition(list: any[]): any[] {
  return list.map((item, index) => ({ ...item, position: index + 1 }));
}

export function UltraFeaturedSection() {
  const {
    availableAuthors,
    featuredAuthors,
    ultraFeaturedTemplates,
    isUltraSaving,
    setUltraFeaturedTemplates,
    persistUltraFeatured,
    resolveAuthToken,
  } = useAdmin();

  const [authorSearch, setAuthorSearch] = useState('');
  const [selectedAuthor, setSelectedAuthor] = useState<Author | null>(null);
  const [authorTemplates, setAuthorTemplates] = useState<any[]>([]);
  const [isAuthorLoading, setIsAuthorLoading] = useState(false);

  const [previewTemplate, setPreviewTemplate] = useState<any | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const featuredTemplateIds = useMemo(() => {
    return new Set(ultraFeaturedTemplates.map((t: any) => t.id));
  }, [ultraFeaturedTemplates]);

  const featuredAuthorIds = useMemo(() => {
    return new Set(featuredAuthors.map((a: any) => a.author_id));
  }, [featuredAuthors]);

  const allAuthors = useMemo(() => {
    const map = new Map<string, Author>();
    availableAuthors.forEach((author: any) => {
      if (!author?.author_id) return;
      map.set(author.author_id, author);
    });
    featuredAuthors.forEach((author: any) => {
      if (!author?.author_id) return;
      if (!map.has(author.author_id)) {
        map.set(author.author_id, {
          author_id: author.author_id,
          author_name: author.author_name || 'Unknown',
          author_avatar: author.author_avatar || null,
          template_count: 0,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const countA = a.template_count || 0;
      const countB = b.template_count || 0;
      if (countA !== countB) return countB - countA;
      return (a.author_name || '').localeCompare(b.author_name || '');
    });
  }, [availableAuthors, featuredAuthors]);

  const filteredAuthors = useMemo(() => {
    const q = authorSearch.trim().toLowerCase();
    if (!q) return allAuthors;
    return allAuthors.filter((author) => (author.author_name || '').toLowerCase().includes(q));
  }, [allAuthors, authorSearch]);

  const authorSuggestions = useMemo(() => {
    const q = authorSearch.trim().toLowerCase();
    if (!q) return [];
    return allAuthors
      .filter((author) => (author.author_name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [allAuthors, authorSearch]);

  const selectAuthor = useCallback((author: Author) => {
    setSelectedAuthor(author);
    setAuthorSearch(author.author_name || '');
  }, []);

  const openPreview = useCallback((template: any) => {
    setPreviewTemplate(template);
    setIsPreviewOpen(true);
  }, []);

  const addToFeatured = useCallback(async (template: any) => {
    const exists = ultraFeaturedTemplates.some((t: any) => t.id === template.id);
    if (exists) return;
    const next = normalizePosition([...ultraFeaturedTemplates, template]);
    setUltraFeaturedTemplates(next);
    await persistUltraFeatured(next, 'Marked as ultra featured');
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

  useEffect(() => {
    if (!selectedAuthor?.author_id) {
      setAuthorTemplates([]);
      return;
    }

    let active = true;
    const loadTemplates = async () => {
      setIsAuthorLoading(true);
      try {
        const res = await fetch(
          `/api/admin/ultra-featured/author?author_id=${encodeURIComponent(selectedAuthor.author_id)}`,
          { headers: { Authorization: `Bearer ${resolveAuthToken()}` } }
        );
        if (!res.ok) throw new Error('Failed to load author templates');
        const data = await res.json();
        if (!active) return;
        setAuthorTemplates(Array.isArray(data.templates) ? data.templates : []);
      } catch (err) {
        if (active) {
          toast.error(err instanceof Error ? err.message : 'Failed to load templates');
        }
      } finally {
        if (active) setIsAuthorLoading(false);
      }
    };

    void loadTemplates();
    return () => { active = false; };
  }, [selectedAuthor, resolveAuthToken]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              Ultra Featured Templates
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Select an author, preview their templates, and promote standouts to ultra featured.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6">
        <Card className="p-6">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Authors</h3>
              <p className="text-xs text-gray-500 mt-1">{allAuthors.length} total</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                value={authorSearch}
                onChange={(e) => setAuthorSearch(e.target.value)}
                placeholder="Search authors..."
                className="pl-9"
              />
            </div>

            {authorSuggestions.length > 0 && (
              <div className="mt-2 border rounded-lg bg-white shadow-sm">
                {authorSuggestions.map((author) => (
                  <button
                    key={author.author_id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                    onMouseDown={() => selectAuthor(author)}
                  >
                    <span className="font-medium truncate">{author.author_name || 'Unknown'}</span>
                    <span className="text-xs text-gray-500">{author.template_count || 0} templates</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-2">
                {filteredAuthors.map((author) => {
                  const isSelected = selectedAuthor?.author_id === author.author_id;
                  const isFeaturedAuthor = featuredAuthorIds.has(author.author_id);
                  return (
                    <button
                      key={author.author_id}
                      type="button"
                      onClick={() => selectAuthor(author)}
                      className={`w-full text-left border rounded-lg px-3 py-2 transition ${
                        isSelected ? 'border-purple-500 bg-purple-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{author.author_name || 'Unknown'}</div>
                          <div className="text-xs text-gray-500">{author.template_count || 0} templates</div>
                        </div>
                        {isFeaturedAuthor && (
                          <Badge variant="secondary" className="text-[10px]">Featured</Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filteredAuthors.length === 0 && (
                  <div className="text-sm text-gray-500">No authors match your search.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">
                {selectedAuthor ? `Templates by ${selectedAuthor.author_name}` : 'Author Templates'}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {selectedAuthor ? `${authorTemplates.length} templates` : 'Select an author to view templates'}
              </p>
            </div>
            {isAuthorLoading && (
              <Badge variant="secondary" className="gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading
              </Badge>
            )}
          </div>

          <div className="mt-4">
            <ScrollArea className="h-[520px] pr-3">
              <div className="space-y-3">
                {selectedAuthor && authorTemplates.map((template: any) => {
                  const isUltra = featuredTemplateIds.has(template.id);
                  return (
                    <div key={template.id} className="flex flex-col xl:flex-row xl:items-center gap-3 border rounded-lg p-3">
                      <div className="relative h-16 w-24 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                        {toAssetUrl(template.screenshot_path) ? (
                          <Image
                            src={toAssetUrl(template.screenshot_path)!}
                            alt={template.name || template.slug}
                            fill
                            className="object-contain object-top"
                            unoptimized
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{template.name || template.slug}</div>
                        <div className="text-xs text-gray-500 truncate">{template.slug}</div>
                        {isUltra && (
                          <Badge variant="secondary" className="mt-2 text-[10px]">Ultra Featured</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => openPreview(template)}>
                          <Eye className="h-4 w-4 mr-1" />
                          Live Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(template.storefront_url, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Buy Now
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void addToFeatured(template)}
                          disabled={isUltraSaving || isUltra}
                        >
                          {isUltra ? 'Ultra Featured' : 'Mark Template as Ultra Featured'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {selectedAuthor && !isAuthorLoading && authorTemplates.length === 0 && (
                  <div className="text-sm text-gray-500">No templates found for this author.</div>
                )}
                {!selectedAuthor && (
                  <div className="text-sm text-gray-500">Choose an author to see their templates.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Current Ultra Featured</h3>
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

      <TemplatePreview
        template={previewTemplate}
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        primaryAction={previewTemplate ? {
          label: featuredTemplateIds.has(previewTemplate.id)
            ? 'Already Ultra Featured'
            : 'Mark Template as Ultra Featured',
          disabled: featuredTemplateIds.has(previewTemplate.id),
          onClick: async (template) => {
            if (featuredTemplateIds.has(template.id)) return;
            await addToFeatured(template);
          }
        } : undefined}
      />
    </div>
  );
}
