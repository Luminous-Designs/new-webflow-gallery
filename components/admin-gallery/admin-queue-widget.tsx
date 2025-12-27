'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-context';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { AdminGalleryJob } from '@/lib/admin/gallery-jobs';

type Snapshot = {
  active: AdminGalleryJob | null;
  queue: AdminGalleryJob[];
  history: AdminGalleryJob[];
};

export function AdminQueueWidget({
  onTemplateScreenshotUpdated,
}: {
  onTemplateScreenshotUpdated?: (templateId: number, screenshotPath: string) => void;
}) {
  const { isAdmin } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const completedToastIdsRef = useRef<Set<string>>(new Set());
  const seenScreenshotRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/admin/gallery-jobs', { cache: 'no-store' });
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
  }, [isAdmin]);

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
        toast.error(`Queue job failed: ${failed} failed${succeeded ? `, ${succeeded} succeeded` : ''}${skipped ? `, ${skipped} skipped` : ''}`);
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
  if (!snapshot?.active && (!snapshot?.queue || snapshot.queue.length === 0) && (!snapshot?.history || snapshot.history.length === 0)) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary" className="shadow-lg rounded-none">
            {counts.active ? (
              <>Processing ({counts.active.progress.processed}/{counts.active.progress.total})</>
            ) : (
              <>Queue ({counts.queuedJobs})</>
            )}
          </Button>
        </DialogTrigger>

        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Admin Screenshot Queue</DialogTitle>
          </DialogHeader>

          {activeJob ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">
                Running: {activeJob.type}
              </div>
              <Progress value={counts.activePercent} />
              <div className="text-xs text-muted-foreground">
                {activeJob.progress.processed}/{activeJob.progress.total} processed
              </div>
              <div className="max-h-48 overflow-auto border">
                {activeJob.items.map((i) => (
                  <div key={`${activeJob.id}-${i.templateId}`} className="border-b p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{i.name || i.slug}</div>
                      <div className="text-muted-foreground">{i.status}</div>
                    </div>
                    {i.error ? <div className="text-red-600 mt-1">{i.error}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {snapshot.queue.length ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Queued</div>
              <div className="max-h-64 overflow-auto border">
                {snapshot.queue.map((job) => (
                  <div key={job.id} className="border-b p-2 text-sm">
                    <div className="font-medium">{job.type}</div>
                    <div className="text-xs text-muted-foreground">
                      {job.items.length} item(s)
                    </div>
                    <div className="mt-2 max-h-36 overflow-auto border">
                      {job.items.map((i) => (
                        <div key={`${job.id}-${i.templateId}`} className="border-b p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium">{i.name || i.slug}</div>
                            <div className="text-muted-foreground">{i.status}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {snapshot.history.length ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Recent</div>
              <div className="max-h-64 overflow-auto border">
                {snapshot.history.slice(0, 20).map((job) => (
                  <div key={job.id} className="border-b p-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{job.type}</div>
                      <div className="text-xs text-muted-foreground">{job.status}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {job.items.filter((i) => i.status === 'succeeded').length} succeeded,{' '}
                      {job.items.filter((i) => i.status === 'skipped').length} skipped,{' '}
                      {job.items.filter((i) => i.status === 'failed').length} failed
                    </div>
                    {job.lastError ? (
                      <div className="text-xs text-red-600 mt-1">{job.lastError}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
