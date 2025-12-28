'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, XCircle, ListChecks, CircleDot, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AdminGalleryJob } from '@/lib/admin/gallery-jobs';

type Snapshot = {
  active: AdminGalleryJob | null;
  queue: AdminGalleryJob[];
  history: AdminGalleryJob[];
};

const OPEN_KEY = 'admin_queue_popup_open_v1';

function statusBadgeVariant(status: string): { label: string; className: string; icon: ReactNode } {
  switch (status) {
    case 'running':
      return { label: 'Running', className: 'bg-blue-100 text-blue-700 border-blue-200', icon: <CircleDot className="h-3.5 w-3.5" /> };
    case 'queued':
      return { label: 'Queued', className: 'bg-neutral-100 text-neutral-700 border-neutral-200', icon: <Clock className="h-3.5 w-3.5" /> };
    case 'succeeded':
      return { label: 'Succeeded', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    case 'failed':
      return { label: 'Failed', className: 'bg-red-100 text-red-700 border-red-200', icon: <AlertTriangle className="h-3.5 w-3.5" /> };
    case 'canceled':
      return { label: 'Canceled', className: 'bg-amber-100 text-amber-800 border-amber-200', icon: <XCircle className="h-3.5 w-3.5" /> };
    case 'skipped':
      return { label: 'Skipped', className: 'bg-zinc-100 text-zinc-700 border-zinc-200', icon: <ListChecks className="h-3.5 w-3.5" /> };
    default:
      return { label: status, className: 'bg-neutral-100 text-neutral-700 border-neutral-200', icon: <ListChecks className="h-3.5 w-3.5" /> };
  }
}

function extractApiError(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  return typeof record.error === 'string' ? record.error : null;
}

export function AdminQueueWidget({
  onTemplateScreenshotUpdated,
}: {
  onTemplateScreenshotUpdated?: (templateId: number, screenshotPath: string) => void;
}) {
  const { isAdmin, session } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const completedToastIdsRef = useRef<Set<string>>(new Set());
  const seenScreenshotRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (!isAdmin) return;
    try {
      const stored = window.localStorage.getItem(OPEN_KEY);
      if (stored === '1') setOpen(true);
    } catch {
      // ignore
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    try {
      window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // ignore
    }
  }, [isAdmin, open]);

  useEffect(() => {
    if (!open) setConfirmCancel(false);
  }, [open]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const token = session?.access_token;
        const headers: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
        const res = await fetch('/api/admin/gallery-jobs', { cache: 'no-store', headers, credentials: 'same-origin' });
        if (res.status === 401) {
          // If admin UI thinks you're logged in but API disagrees, surface it.
          console.warn('[AdminQueue] Unauthorized (401) polling /api/admin/gallery-jobs');
          return;
        }
        const data = (await res.json()) as Snapshot;
        if (!cancelled) setSnapshot(data);
      } catch {
        // ignore transient errors
      }
    };

    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isAdmin, session?.access_token]);

  useEffect(() => {
    if (!snapshot) return;
    const allJobs = [
      ...(snapshot.active ? [snapshot.active] : []),
      ...snapshot.queue,
      ...snapshot.history,
    ];

    for (const job of allJobs) {
      for (const item of job.items || []) {
        if (!item.screenshotPath) continue;
        const prev = seenScreenshotRef.current.get(item.templateId);
        if (prev === item.screenshotPath) continue;
        seenScreenshotRef.current.set(item.templateId, item.screenshotPath);
        onTemplateScreenshotUpdated?.(item.templateId, item.screenshotPath);
      }
    }
  }, [snapshot, onTemplateScreenshotUpdated]);

  useEffect(() => {
    if (!snapshot) return;
    for (const job of snapshot.history || []) {
      if (completedToastIdsRef.current.has(job.id)) continue;
      if (job.status !== 'succeeded' && job.status !== 'failed') continue;

      completedToastIdsRef.current.add(job.id);

      const items = job.items || [];
      const succeeded = items.filter((i) => i.status === 'succeeded').length;
      const skipped = items.filter((i) => i.status === 'skipped').length;
      const failed = items.filter((i) => i.status === 'failed').length;

      if (items.length === 1 && succeeded === 1) {
        toast.success('Screenshot Successfully Retaken');
      } else if (job.status === 'succeeded') {
        toast.success(`Queue job completed: ${succeeded} succeeded${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}`);
      } else {
        const detail = job.lastError || items.find((i) => i.status === 'failed')?.error || '';
        toast.error(
          `Queue job failed: ${failed} failed${succeeded ? `, ${succeeded} succeeded` : ''}${skipped ? `, ${skipped} skipped` : ''}${detail ? ` — ${detail}` : ''}`
        );
      }
    }
  }, [snapshot]);

  const counts = useMemo(() => {
    const active = snapshot?.active;
    const queuedJobs = snapshot?.queue?.length || 0;
    const totalQueuedItems = (snapshot?.queue || []).reduce((sum, j) => sum + (j.items?.length || 0), 0);
    const activeTotal = active?.progress?.total || 0;
    const activeProcessed = active?.progress?.processed || 0;
    const activePercent = activeTotal ? Math.round((activeProcessed / activeTotal) * 100) : 0;
    return { active, queuedJobs, totalQueuedItems, activePercent };
  }, [snapshot]);

  const activeJob = snapshot?.active || null;

  if (!isAdmin) return null;
  // Persistently show the widget for admins while loading so it appears immediately after reload.
  if (!snapshot) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button variant="secondary" className="shadow-lg rounded-none flex items-center gap-2" disabled>
          <Loader2 className="h-4 w-4 animate-spin" />
          Queue…
        </Button>
      </div>
    );
  }

  // If nothing is happening, hide completely.
  if (!snapshot.active && snapshot.queue.length === 0 && snapshot.history.length === 0) {
    return null;
  }

  const runningItemName = activeJob?.items?.find((i) => i.status === 'running')?.name ||
    activeJob?.items?.find((i) => i.status === 'running')?.slug ||
    activeJob?.templateName ||
    activeJob?.templateSlug ||
    null;

  const cancelAll = async () => {
    try {
      const token = session?.access_token;
      const headers: HeadersInit | undefined = token ? { Authorization: `Bearer ${token}` } : undefined;
      const res = await fetch('/api/admin/gallery-jobs', { method: 'DELETE', headers, credentials: 'same-origin' });
      let data: unknown = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(extractApiError(data) || 'Failed to cancel queue');
      }
      setSnapshot(data as Snapshot);
      setConfirmCancel(false);
      toast.success('Canceled queue');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel queue';
      toast.error(msg);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            variant="secondary"
            className="shadow-lg rounded-none flex items-center gap-2 border border-neutral-200 bg-white/90 backdrop-blur hover:bg-white"
          >
            {counts.active ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="font-medium">Processing</span>
                <span className="text-xs text-neutral-500">
                  {counts.active.progress.processed}/{counts.active.progress.total}
                </span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-neutral-600" />
                <span className="font-medium">Queue</span>
                <span className="text-xs text-neutral-500">{counts.queuedJobs} job(s)</span>
              </>
            )}
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-5xl h-[85vh] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b bg-white/80 backdrop-blur flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <DialogTitle className="text-base">Admin Screenshot Queue</DialogTitle>
              <div className="text-xs text-neutral-500">
                {counts.active ? (
                  <>Now running: <span className="text-neutral-900 font-medium">{activeJob?.type}</span>{runningItemName ? ` — ${runningItemName}` : ''}</>
                ) : (
                  <>No active job — {counts.queuedJobs} queued</>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {confirmCancel ? (
                <>
                  <span className="text-xs text-neutral-600 mr-2">Cancel everything?</span>
                  <Button size="sm" variant="destructive" onClick={() => void cancelAll()}>
                    Confirm
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>
                    Keep
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setConfirmCancel(true)}
                  disabled={!snapshot.active && snapshot.queue.length === 0}
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel All
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="p-6 space-y-6 h-[calc(85vh-64px)] overflow-hidden bg-neutral-50">
            {activeJob ? (
              <div className="bg-white border border-neutral-200 shadow-sm">
                <div className="p-4 border-b flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {activeJob.type}
                    </Badge>
                    <div className="text-sm font-medium truncate">
                      {runningItemName ? runningItemName : 'Working…'}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500 shrink-0">
                    {activeJob.progress.processed}/{activeJob.progress.total} processed
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <Progress value={counts.activePercent} />
                  <ScrollArea className="h-56 border border-neutral-100">
                    <div className="divide-y">
                      {activeJob.items.map((i) => {
                        const badge = statusBadgeVariant(i.status);
                        return (
                          <div key={`${activeJob.id}-${i.templateId}`} className="px-3 py-2 text-sm flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium truncate">{i.name || i.slug}</div>
                              {i.error ? (
                                <div className="text-xs text-red-600 mt-0.5 break-words">{i.error}</div>
                              ) : null}
                            </div>
                            <Badge variant="outline" className={`shrink-0 flex items-center gap-1.5 ${badge.className}`}>
                              {badge.icon}
                              {badge.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : null}

            {snapshot.queue.length ? (
              <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between">
                  <div className="text-sm font-medium">Queued jobs</div>
                  <div className="text-xs text-neutral-500">
                    {snapshot.queue.length} job(s), {counts.totalQueuedItems} item(s)
                  </div>
                </div>
                <ScrollArea className="h-64">
                  <div className="divide-y">
                    {snapshot.queue.map((job) => (
                      <div key={job.id} className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {job.type}
                            </Badge>
                            <div className="text-sm font-medium truncate">
                              {job.templateName || job.templateSlug || `${job.items.length} item(s)`}
                            </div>
                          </div>
                          <div className="text-xs text-neutral-500 shrink-0">{job.items.length} item(s)</div>
                        </div>
                        <div className="mt-3 border border-neutral-100">
                          <div className="divide-y">
                            {job.items.slice(0, 10).map((i) => {
                              const badge = statusBadgeVariant(i.status);
                              return (
                                <div key={`${job.id}-${i.templateId}`} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                                  <div className="truncate">{i.name || i.slug}</div>
                                  <Badge variant="outline" className={`shrink-0 flex items-center gap-1.5 ${badge.className}`}>
                                    {badge.icon}
                                    {badge.label}
                                  </Badge>
                                </div>
                              );
                            })}
                            {job.items.length > 10 ? (
                              <div className="px-3 py-2 text-xs text-neutral-500">+ {job.items.length - 10} more…</div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : null}

            {snapshot.history.length ? (
              <div className="bg-white border border-neutral-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b flex items-center justify-between">
                  <div className="text-sm font-medium">Recent</div>
                  <div className="text-xs text-neutral-500">Last 20 jobs</div>
                </div>
                <ScrollArea className="h-48">
                  <div className="divide-y">
                    {snapshot.history.slice(0, 20).map((job) => {
                      const badge = statusBadgeVariant(job.status);
                      const succeeded = job.items.filter((i) => i.status === 'succeeded').length;
                      const skipped = job.items.filter((i) => i.status === 'skipped').length;
                      const failed = job.items.filter((i) => i.status === 'failed').length;
                      const canceled = job.items.filter((i) => i.status === 'canceled').length;
                      return (
                        <div key={job.id} className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <Badge variant="outline" className="font-mono text-[10px]">
                                {job.type}
                              </Badge>
                              <div className="text-sm font-medium truncate">
                                {job.templateName || job.templateSlug || job.id}
                              </div>
                            </div>
                            <Badge variant="outline" className={`shrink-0 flex items-center gap-1.5 ${badge.className}`}>
                              {badge.icon}
                              {badge.label}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {succeeded} succeeded{skipped ? `, ${skipped} skipped` : ''}{failed ? `, ${failed} failed` : ''}{canceled ? `, ${canceled} canceled` : ''}
                          </div>
                          {job.lastError ? <div className="mt-1 text-xs text-red-600 break-words">{job.lastError}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
