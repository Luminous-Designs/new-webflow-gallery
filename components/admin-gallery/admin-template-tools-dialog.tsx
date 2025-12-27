'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Template } from '@/types/template';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScreenshotSettingsPanel, DEFAULT_SCREENSHOT_SETTINGS, type ScreenshotSettings } from '@/components/admin-gallery/screenshot-settings';

const STORAGE_KEY = 'admin_screenshot_settings_v1';

function readStoredSettings(): ScreenshotSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScreenshotSettings>;
    return { ...DEFAULT_SCREENSHOT_SETTINGS, ...parsed };
  } catch {
    return null;
  }
}

function persistSettings(next: ScreenshotSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function AdminTemplateToolsDialog({
  template,
  open,
  onOpenChange,
}: {
  template: Template | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<ScreenshotSettings>(DEFAULT_SCREENSHOT_SETTINGS);

  const [selector, setSelector] = useState('');
  const [selectorValidation, setSelectorValidation] = useState<
    | { state: 'idle' }
    | { state: 'validating' }
    | { state: 'valid'; matchCount: number; normalizedSelector: string }
    | { state: 'invalid'; error: string; normalizedSelector?: string }
  >({ state: 'idle' });

  const [homepageLinks, setHomepageLinks] = useState<Array<{ url: string; path: string; text: string }>>([]);
  const [homepageLoading, setHomepageLoading] = useState(false);
  const [selectedHomepageUrl, setSelectedHomepageUrl] = useState<string>('');

  const [templateFeatured, setTemplateFeatured] = useState<{ loading: boolean; isUltraFeatured: boolean; position: number | null }>({
    loading: false,
    isUltraFeatured: false,
    position: null,
  });
  const [authorFeatured, setAuthorFeatured] = useState(false);

  useEffect(() => {
    setAuthorFeatured(Boolean(template?.is_featured_author));
  }, [template?.id, template?.is_featured_author]);

  useEffect(() => {
    if (!open) return;
    const stored = readStoredSettings();
    if (stored) setSettings(stored);
  }, [open]);

  useEffect(() => {
    if (!open || !template?.id) return;
    setTemplateFeatured((s) => ({ ...s, loading: true }));
    fetch(`/api/admin/gallery-featured-template?templateId=${template.id}`)
      .then((r) => r.json())
      .then((data) => {
        setTemplateFeatured({
          loading: false,
          isUltraFeatured: Boolean(data?.isUltraFeatured),
          position: typeof data?.position === 'number' ? data.position : null,
        });
      })
      .catch(() => setTemplateFeatured((s) => ({ ...s, loading: false })));
  }, [open, template?.id]);

  useEffect(() => {
    if (!open) return;
    persistSettings(settings);
  }, [open, settings]);

  const canFeatureAuthor = Boolean(template?.author_id && template?.author_name);

  const enqueue = async (type: string, extra: Record<string, unknown>) => {
    if (!template) return;
    try {
      const res = await fetch('/api/admin/gallery-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          templateId: template.id,
          config: settings,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to enqueue job');
      }
      toast.success('Added to queue');
      return data?.job;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to enqueue job';
      toast.error(msg);
      return null;
    }
  };

  const validateSelector = async () => {
    if (!template) return;
    const raw = selector.trim();
    if (!raw) {
      toast.error('Enter a selector first');
      return;
    }
    setSelectorValidation({ state: 'validating' });
    try {
      const res = await fetch('/api/admin/gallery-selector-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id, selector: raw }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || 'Selector validation failed');
      }
      if (data?.exists) {
        setSelectorValidation({ state: 'valid', matchCount: data.matchCount || 1, normalizedSelector: data.normalizedSelector || raw });
        toast.success('Selector found on page');
      } else {
        setSelectorValidation({ state: 'invalid', error: 'Selector not found on page', normalizedSelector: data.normalizedSelector || raw });
        toast.error('Selector not found on page');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Selector validation failed';
      setSelectorValidation({ state: 'invalid', error: msg });
      toast.error(msg);
    }
  };

  const loadHomepageLinks = async () => {
    if (!template) return;
    setHomepageLoading(true);
    try {
      const res = await fetch(`/api/admin/gallery-homepage-links?templateId=${template.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load links');
      const links = Array.isArray(data?.links) ? data.links : [];
      const baseUrl = typeof data?.baseUrl === 'string' ? data.baseUrl : '';
      const nextLinks = [...links];
      if (baseUrl && !nextLinks.some((l) => l?.url === baseUrl)) {
        nextLinks.unshift({ url: baseUrl, path: new URL(baseUrl).pathname || '/', text: '(index)' });
      }
      setHomepageLinks(nextLinks);
      if (!selectedHomepageUrl && baseUrl) setSelectedHomepageUrl(baseUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load links';
      toast.error(msg);
    } finally {
      setHomepageLoading(false);
    }
  };

  const toggleTemplateFeatured = async () => {
    if (!template) return;
    setTemplateFeatured((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch('/api/admin/gallery-featured-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: template.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update');
      setTemplateFeatured({
        loading: false,
        isUltraFeatured: Boolean(data?.isUltraFeatured),
        position: typeof data?.position === 'number' ? data.position : null,
      });
      toast.success(Boolean(data?.isUltraFeatured) ? 'Template marked as featured' : 'Template unfeatured');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      toast.error(msg);
      setTemplateFeatured((s) => ({ ...s, loading: false }));
    }
  };

  const toggleAuthorFeatured = async () => {
    if (!template?.author_id) return;
    try {
      const res = await fetch('/api/admin/gallery-featured-author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: template.author_id,
          authorName: template.author_name || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to update');
      const next = Boolean(data?.isFeaturedAuthor);
      setAuthorFeatured(next);
      toast.success(next ? 'Author marked as featured' : 'Author unfeatured');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update';
      toast.error(msg);
    }
  };

  const selectorSummary = useMemo(() => {
    if (selectorValidation.state === 'valid') {
      return `Found (${selectorValidation.matchCount})`;
    }
    if (selectorValidation.state === 'invalid') {
      return selectorValidation.normalizedSelector ? `Not found: ${selectorValidation.normalizedSelector}` : selectorValidation.error;
    }
    if (selectorValidation.state === 'validating') return 'Validating…';
    return 'Not validated';
  }, [selectorValidation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Admin Tools</DialogTitle>
          <DialogDescription>
            {template ? (
              <span className="inline-flex items-center gap-2">
                <span className="font-medium text-foreground">{template.name}</span>
                <Badge variant="secondary">{template.slug}</Badge>
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {!template ? null : (
          <Tabs defaultValue="screenshot" className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="screenshot">Screenshot</TabsTrigger>
              <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
              <TabsTrigger value="homepage">Homepage</TabsTrigger>
              <TabsTrigger value="featured">Featured</TabsTrigger>
            </TabsList>

            <TabsContent value="screenshot" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    Re-takes the screenshot using the existing homepage detection and overwrites the R2 object.
                  </div>
                  <Button onClick={() => enqueue('retake_screenshot', {})}>
                    Queue Screenshot Re-take
                  </Button>
                </div>

                <ScrollArea className="h-[420px] pr-4">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="artifacts" className="mt-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">CSS selector or element ID</div>
                  <div className="flex gap-2">
                    <Input
                      value={selector}
                      onChange={(e) => {
                        setSelector(e.target.value);
                        setSelectorValidation({ state: 'idle' });
                      }}
                      placeholder="e.g. .cookie-banner, #chat-widget, div[data-testid='banner']"
                    />
                    <Button variant="outline" onClick={validateSelector} disabled={selectorValidation.state === 'validating'}>
                      Validate
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">{selectorSummary}</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectorValidation.state === 'valid' ? (
                    <>
                      <Button onClick={() => enqueue('retake_screenshot_remove_selector', { selector: selector.trim() })}>
                        Re-take This Template (remove)
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => enqueue('retake_author_remove_selector', { selector: selector.trim() })}
                        disabled={!template.author_id}
                      >
                        Re-take All by Author (remove)
                      </Button>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Validate a selector first to enable re-screenshot options.
                    </div>
                  )}
                </div>

                <ScrollArea className="h-[360px] pr-4">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="homepage" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Choose a homepage URL from internal links (same domain) and re-take the screenshot.
                  </div>
                  <Button variant="outline" onClick={loadHomepageLinks} disabled={homepageLoading}>
                    {homepageLoading ? 'Loading…' : 'Load Pages'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">Homepage selection</div>
                  <Select value={selectedHomepageUrl} onValueChange={setSelectedHomepageUrl}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a page…" />
                    </SelectTrigger>
                    <SelectContent>
                      {homepageLinks.map((l) => (
                        <SelectItem key={l.url} value={l.url}>
                          {l.path}{l.text ? ` — ${l.text}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => enqueue('change_homepage', { homepageUrl: selectedHomepageUrl })}
                    disabled={!selectedHomepageUrl}
                  >
                    Queue Homepage Re-screenshot
                  </Button>
                </div>

                <ScrollArea className="h-[320px] pr-4">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="featured" className="mt-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Featured template (Ultra)</div>
                    <div className="text-xs text-muted-foreground">
                      {templateFeatured.isUltraFeatured ? (
                        <>Currently featured{templateFeatured.position ? ` (position ${templateFeatured.position})` : ''}.</>
                      ) : (
                        <>Not featured.</>
                      )}
                    </div>
                  </div>
                  <Button onClick={toggleTemplateFeatured} disabled={templateFeatured.loading}>
                    {templateFeatured.isUltraFeatured ? 'Unfeature' : 'Mark as Featured'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Featured author</div>
                    <div className="text-xs text-muted-foreground">
                      {authorFeatured ? 'Currently featured.' : 'Not featured.'}
                    </div>
                  </div>
                  <Button onClick={toggleAuthorFeatured} disabled={!canFeatureAuthor}>
                    {authorFeatured ? 'Unfeature Author' : 'Mark Author as Featured'}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
