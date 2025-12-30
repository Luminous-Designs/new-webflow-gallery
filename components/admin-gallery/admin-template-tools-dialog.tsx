'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-context';
import type { Template } from '@/types/template';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScreenshotSettingsPanel, DEFAULT_SCREENSHOT_SETTINGS, type ScreenshotSettings } from '@/components/admin-gallery/screenshot-settings';
import { Switch } from '@/components/ui/switch';

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

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJsonResponse(res: Response): Promise<JsonObject> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (isJsonObject(parsed)) return parsed;
    return { value: parsed };
  } catch {
    return { error: text };
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
  const { session } = useAuth();
  const [settings, setSettings] = useState<ScreenshotSettings>(DEFAULT_SCREENSHOT_SETTINGS);

  const [selector, setSelector] = useState('');
  const [persistForAuthor, setPersistForAuthor] = useState(true);
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
    const token = session?.access_token;
    const headers: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
    fetch(`/api/admin/gallery-featured-template?templateId=${template.id}`, { headers, credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => {
        setTemplateFeatured({
          loading: false,
          isUltraFeatured: Boolean(data?.isUltraFeatured),
          position: typeof data?.position === 'number' ? data.position : null,
        });
      })
      .catch(() => setTemplateFeatured((s) => ({ ...s, loading: false })));
  }, [open, session?.access_token, template?.id]);

  useEffect(() => {
    if (!open) return;
    persistSettings(settings);
  }, [open, settings]);

  const canFeatureAuthor = Boolean(template?.author_id && template?.author_name);
  const canPersistAuthor = Boolean(template?.author_id);

  const enqueue = async (type: string, extra: Record<string, unknown>) => {
    if (!template) return;
    try {
      const token = session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      console.log('[AdminTools] enqueue', { type, templateId: template.id });
      const res = await fetch('/api/admin/gallery-jobs', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          type,
          templateId: template.id,
          config: settings,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('[AdminTools] enqueue failed', { status: res.status, data });
        throw new Error(data?.error || 'Failed to enqueue job');
      }
      toast.success('Added to queue');
      return data?.job;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to enqueue job';
      console.error('[AdminTools] enqueue error', e);
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
      const token = session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/admin/gallery-selector-validate', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ templateId: template.id, selector: raw }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok || data?.ok === false) {
        const serverError = typeof data.error === 'string' ? data.error : null;
        throw new Error(serverError || `Selector validation failed (HTTP ${res.status})`);
      }
      const exists = Boolean(data.exists);
      const matchCount = typeof data.matchCount === 'number' ? data.matchCount : 0;
      const normalizedSelector = typeof data.normalizedSelector === 'string' ? data.normalizedSelector : raw;
      if (exists) {
        setSelectorValidation({ state: 'valid', matchCount: matchCount || 1, normalizedSelector });
        toast.success('Selector found on page');
      } else {
        setSelectorValidation({ state: 'invalid', error: 'Selector not found on page', normalizedSelector });
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
      const token = session?.access_token;
      const headers: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch(`/api/admin/gallery-homepage-links?templateId=${template.id}`, { headers, credentials: 'same-origin' });
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
      const token = session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/admin/gallery-featured-template', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
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
      const token = session?.access_token;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('/api/admin/gallery-featured-author', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
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
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50 bg-muted/30">
          <DialogTitle className="text-base">Admin Tools</DialogTitle>
          <DialogDescription asChild>
            {template ? (
              <div className="flex items-center gap-2 pt-1">
                <span className="font-medium text-foreground text-sm">{template.name}</span>
                <Badge variant="secondary" className="text-xs font-mono">{template.slug}</Badge>
              </div>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {!template ? null : (
          <Tabs defaultValue="screenshot" className="flex flex-col">
            <div className="px-6 pt-4 pb-0">
              <TabsList className="w-full grid grid-cols-4 h-9">
                <TabsTrigger value="screenshot" className="text-xs">Screenshot</TabsTrigger>
                <TabsTrigger value="artifacts" className="text-xs">Artifacts</TabsTrigger>
                <TabsTrigger value="homepage" className="text-xs">Homepage</TabsTrigger>
                <TabsTrigger value="featured" className="text-xs">Featured</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="screenshot" className="mt-0 px-6 py-4 flex-1">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-muted/40 border border-border/50">
                  <div className="space-y-1 flex-1">
                    <div className="text-sm font-medium">Re-take Screenshot</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      Uses existing homepage detection and overwrites the R2 object with new capture.
                    </div>
                  </div>
                  <Button size="sm" onClick={() => enqueue('retake_screenshot', {})}>
                    Queue Re-take
                  </Button>
                </div>

                <ScrollArea className="h-[380px] pr-3">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="artifacts" className="mt-0 px-6 py-4 flex-1">
              <div className="space-y-4">
                <div className="space-y-3 p-4 rounded-lg bg-muted/40 border border-border/50">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Element Removal
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={selector}
                      onChange={(e) => {
                        setSelector(e.target.value);
                        setSelectorValidation({ state: 'idle' });
                      }}
                      placeholder="e.g. .cookie-banner, #chat-widget"
                      className="text-sm h-9"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={validateSelector}
                      disabled={selectorValidation.state === 'validating'}
                      className="shrink-0"
                    >
                      Validate
                    </Button>
                  </div>
                  <div className="text-xs text-muted-foreground">{selectorSummary}</div>
                </div>

                {canPersistAuthor ? (
                  <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border/50">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Persist for author</div>
                      <div className="text-xs text-muted-foreground leading-relaxed">
                        Automatically remove this element for all future scrapes from this author.
                      </div>
                    </div>
                    <Switch checked={persistForAuthor} onCheckedChange={setPersistForAuthor} />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground px-1">
                    No author ID — removal rule cannot be persisted.
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {selectorValidation.state === 'valid' ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => enqueue('retake_screenshot_remove_selector', { selector: selector.trim(), persistToAuthor: persistForAuthor && canPersistAuthor })}
                      >
                        Re-take This Template
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => enqueue('retake_author_remove_selector', { selector: selector.trim(), persistToAuthor: persistForAuthor && canPersistAuthor })}
                        disabled={!template.author_id}
                      >
                        Re-take All by Author
                      </Button>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground px-1">
                      Validate a selector to enable re-screenshot options.
                    </div>
                  )}
                </div>

                <ScrollArea className="h-[280px] pr-3">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="homepage" className="mt-0 px-6 py-4 flex-1">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 p-4 rounded-lg bg-muted/40 border border-border/50">
                  <div className="space-y-1 flex-1">
                    <div className="text-sm font-medium">Alternate Homepage</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      Select an internal page to use as the homepage for screenshots.
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadHomepageLinks} disabled={homepageLoading}>
                    {homepageLoading ? 'Loading…' : 'Load Pages'}
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                    Page Selection
                  </div>
                  <Select value={selectedHomepageUrl} onValueChange={setSelectedHomepageUrl}>
                    <SelectTrigger className="h-9">
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
                    size="sm"
                    onClick={() => enqueue('change_homepage', { homepageUrl: selectedHomepageUrl })}
                    disabled={!selectedHomepageUrl}
                  >
                    Queue Homepage Re-screenshot
                  </Button>
                </div>

                <ScrollArea className="h-[280px] pr-3">
                  <ScreenshotSettingsPanel
                    value={settings}
                    onChange={(next) => setSettings((s) => ({ ...s, ...next }))}
                  />
                </ScrollArea>
              </div>
            </TabsContent>

            <TabsContent value="featured" className="mt-0 px-6 py-4 flex-1">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border/50 transition-colors hover:bg-muted/30">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Featured Template</div>
                    <div className="text-xs text-muted-foreground">
                      {templateFeatured.isUltraFeatured ? (
                        <span className="text-foreground/80">
                          Currently featured{templateFeatured.position ? ` at position ${templateFeatured.position}` : ''}
                        </span>
                      ) : (
                        'Not currently featured'
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={templateFeatured.isUltraFeatured ? "secondary" : "default"}
                    onClick={toggleTemplateFeatured}
                    disabled={templateFeatured.loading}
                  >
                    {templateFeatured.isUltraFeatured ? 'Remove' : 'Feature'}
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-4 p-4 rounded-lg border border-border/50 transition-colors hover:bg-muted/30">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Featured Author</div>
                    <div className="text-xs text-muted-foreground">
                      {authorFeatured ? (
                        <span className="text-foreground/80">Currently featured</span>
                      ) : (
                        'Not currently featured'
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={authorFeatured ? "secondary" : "default"}
                    onClick={toggleAuthorFeatured}
                    disabled={!canFeatureAuthor}
                  >
                    {authorFeatured ? 'Remove' : 'Feature'}
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
