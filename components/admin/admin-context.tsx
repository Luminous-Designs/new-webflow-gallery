/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';

// Types
export interface AdminStats {
  templates: number;
  subcategories: number;
  styles: number;
  features: number;
  featuredAuthors: number;
  scrapeJobs: number;
  activeVisitors: any[];
  activeVisitorsCount?: number;
  completedPurchases: number;
  databaseSize: number;
  recentJobs?: any[];
  featuredAuthorsList?: any[];
  visitorStats?: any[];
  recentPurchases?: any[];
}

export interface SystemStats {
  system: {
    platform: string;
    architecture: string;
    hostname: string;
    uptime: number;
    nodeVersion: string;
  };
  environment: {
    type: 'local' | 'vps';
    name: string;
    description: string;
    persistentVolume: boolean;
    storagePath: string;
  };
  cpu: {
    cores: number;
    model: string;
    usage: any[];
    loadAverage: {
      '1min': string;
      '5min': string;
      '15min': string;
    };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
    process: any;
  };
  storage: {
    screenshots: number;
    thumbnails: number;
    database: number;
    total: number;
    screenshotCount: number;
    thumbnailCount: number;
  };
  recommendations: {
    maxConcurrency: number;
    suggestedBrowsers: number;
    suggestedPagesPerBrowser: number;
  };
}

export interface ThumbnailJobSummary {
  id: number;
  template_id: number;
  template_name: string;
  template_slug: string;
  target_url: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  error_message?: string | null;
  screenshot_path?: string | null;
  screenshot_thumbnail_path?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  requested_by?: string | null;
}

export interface ThumbnailQueueCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
}

interface AdminContextType {
  // Authentication
  isAuthenticated: boolean;
  password: string;
  setPassword: (password: string) => void;
  authenticate: () => Promise<void>;
  logout: () => void;
  resolveAuthToken: () => string;

  // Stats
  stats: AdminStats | null;
  systemStats: SystemStats | null;
  loadStats: (tokenOverride?: string) => Promise<boolean>;
  loadSystemStats: (tokenOverride?: string) => Promise<boolean>;

  // Featured Authors
  featuredAuthors: any[];
  availableAuthors: any[];
  loadFeaturedAuthors: (tokenOverride?: string) => Promise<boolean>;
  toggleFeaturedAuthor: (author: any, feature: boolean) => Promise<void>;

  // Ultra Featured
  ultraPool: any[];
  ultraFeaturedTemplates: any[];
  isUltraLoading: boolean;
  isUltraSaving: boolean;
  loadUltraFeatured: (tokenOverride?: string) => Promise<boolean>;
  setUltraFeaturedTemplates: React.Dispatch<React.SetStateAction<any[]>>;
  setUltraPool: React.Dispatch<React.SetStateAction<any[]>>;
  persistUltraFeatured: (templates: any[], successMessage?: string) => Promise<void>;

  // Thumbnail Jobs
  thumbnailJobs: ThumbnailJobSummary[];
  thumbnailQueueCounts: ThumbnailQueueCounts;
  fetchThumbnailJobs: (options?: { emitNotifications?: boolean }, tokenOverride?: string) => Promise<boolean>;
  queueThumbnailJob: (templateId: number, targetUrl: string, options?: { successMessage?: string; suppressSuccessToast?: boolean }) => Promise<boolean>;
  pendingThumbnailMap: Map<number, { status: ThumbnailJobSummary['status']; jobId: number; error?: string | null }>;

  // Utilities
  withCacheBust: (url?: string, version?: number) => string;
  formatBytes: (bytes: number, decimals?: number) => string;
}

const AdminContext = createContext<AdminContextType | null>(null);

export function useAdmin() {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
}

// Helper function to format bytes
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

interface AdminProviderProps {
  children: ReactNode;
}

export function AdminProvider({ children }: AdminProviderProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [featuredAuthors, setFeaturedAuthors] = useState<any[]>([]);
  const [availableAuthors, setAvailableAuthors] = useState<any[]>([]);
  const [ultraPool, setUltraPool] = useState<any[]>([]);
  const [ultraFeaturedTemplates, setUltraFeaturedTemplates] = useState<any[]>([]);
  const [isUltraLoading, setIsUltraLoading] = useState(false);
  const [isUltraSaving, setIsUltraSaving] = useState(false);
  const [thumbnailJobs, setThumbnailJobs] = useState<ThumbnailJobSummary[]>([]);
  const [thumbnailQueueCounts, setThumbnailQueueCounts] = useState<ThumbnailQueueCounts>({ pending: 0, running: 0, completed: 0, failed: 0 });
  const jobStatusRef = useRef<Map<number, ThumbnailJobSummary['status']>>(new Map());

  const withCacheBust = useCallback((url?: string, version?: number) => {
    if (!url) return '';
    if (!version) return url;
    return url.includes('?') ? `${url}&v=${version}` : `${url}?v=${version}`;
  }, []);

  const resolveAuthToken = useCallback(() => {
    return password || localStorage.getItem('admin_auth') || '';
  }, [password]);

  const pendingThumbnailMap = React.useMemo(() => {
    const map = new Map<number, { status: ThumbnailJobSummary['status']; jobId: number; error?: string | null }>();
    for (const job of thumbnailJobs) {
      if (map.has(job.template_id)) continue;
      if (job.status !== 'completed') {
        map.set(job.template_id, { status: job.status, jobId: job.id, error: job.error_message });
      }
    }
    return map;
  }, [thumbnailJobs]);

  // Load stats
  const loadStats = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? resolveAuthToken();
    if (!token) return false;

    try {
      const response = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;
      const data = await response.json();
      setStats(data);
      return true;
    } catch (error) {
      console.error('Failed to load stats:', error);
      return false;
    }
  }, [resolveAuthToken]);

  // Load system stats
  const loadSystemStats = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? resolveAuthToken();
    if (!token) return false;

    try {
      const response = await fetch('/api/admin/system', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;
      const data = await response.json();
      setSystemStats(data);
      return true;
    } catch (error) {
      console.error('Failed to load system stats:', error);
      return false;
    }
  }, [resolveAuthToken]);

  // Load featured authors
  const loadFeaturedAuthors = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? resolveAuthToken();
    if (!token) return false;

    try {
      const response = await fetch('/api/admin/featured-authors', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;
      const data = await response.json();
      setFeaturedAuthors(data.featured);
      setAvailableAuthors(data.available);
      return true;
    } catch (error) {
      console.error('Failed to load featured authors:', error);
      return false;
    }
  }, [resolveAuthToken]);

  // Toggle featured author
  const toggleFeaturedAuthor = useCallback(async (author: any, feature: boolean) => {
    const token = resolveAuthToken();
    try {
      if (feature) {
        const response = await fetch('/api/admin/featured-authors', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ author_id: author.author_id, author_name: author.author_name })
        });
        if (response.ok) {
          toast.success('Author featured successfully');
          loadFeaturedAuthors();
        }
      } else {
        const response = await fetch(`/api/admin/featured-authors?id=${author.author_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          toast.success('Author unfeatured successfully');
          loadFeaturedAuthors();
        }
      }
    } catch (error) {
      console.error('Failed to toggle featured author:', error);
      toast.error('Operation failed');
    }
  }, [resolveAuthToken, loadFeaturedAuthors]);

  // Load ultra featured
  const loadUltraFeatured = useCallback(async (tokenOverride?: string) => {
    const token = tokenOverride ?? resolveAuthToken();
    if (!token) return false;

    try {
      setIsUltraLoading(true);
      const response = await fetch('/api/admin/ultra-featured', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;

      const data = await response.json();
      const baseTime = Date.now();
      const ultraList: any[] = Array.isArray(data.ultraFeatured) ? data.ultraFeatured : [];
      const poolList: any[] = Array.isArray(data.pool) ? data.pool : [];

      setUltraFeaturedTemplates(ultraList.map((item: any, index: number) => ({
        ...item,
        position: index + 1,
        _thumbUpdated: baseTime + index
      })));

      setUltraPool(poolList.map((item: any, idx: number) => ({
        ...item,
        _thumbUpdated: baseTime + ultraList.length + idx
      })));
      return true;
    } catch (error) {
      console.error('Failed to load ultra featured templates:', error);
      return false;
    } finally {
      setIsUltraLoading(false);
    }
  }, [resolveAuthToken]);

  // Persist ultra featured
  const persistUltraFeatured = useCallback(async (templates: any[], successMessage?: string) => {
    try {
      setIsUltraSaving(true);
      const response = await fetch('/api/admin/ultra-featured', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ templateIds: templates.map((item: any) => item.id) })
      });

      if (!response.ok) throw new Error('Failed to update ultra featured templates');

      const data = await response.json().catch(() => null);
      if (data?.ultraFeatured) {
        const baseTime = Date.now();
        setUltraFeaturedTemplates((data.ultraFeatured as any[]).map((item: any, index: number) => ({
          ...item,
          position: index + 1,
          _thumbUpdated: baseTime + index
        })));
      }

      if (successMessage) toast.success(successMessage);
    } catch (error) {
      console.error('Persist ultra featured error:', error);
      toast.error('Failed to update ultra featured templates');
      await loadUltraFeatured();
    } finally {
      setIsUltraSaving(false);
    }
  }, [resolveAuthToken, loadUltraFeatured]);

  // Fetch thumbnail jobs
  const fetchThumbnailJobs = useCallback(async (
    options: { emitNotifications?: boolean } = {},
    tokenOverride?: string
  ) => {
    const { emitNotifications = false } = options;
    const token = tokenOverride ?? resolveAuthToken();
    if (!token) return false;

    try {
      const response = await fetch('/api/admin/thumbnail-jobs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) return false;

      const data = await response.json();
      const jobs: ThumbnailJobSummary[] = Array.isArray(data.jobs) ? data.jobs : [];
      setThumbnailJobs(jobs);

      const counts: ThumbnailQueueCounts = {
        pending: data.counts?.pending ?? data.pending ?? 0,
        running: data.counts?.running ?? data.running ?? 0,
        completed: data.counts?.completed ?? data.completed ?? 0,
        failed: data.counts?.failed ?? data.failed ?? 0
      };
      setThumbnailQueueCounts(counts);

      const currentIds = new Set<number>();
      let shouldRefreshFeatured = false;
      const failureMessages: string[] = [];

      for (const job of jobs) {
        currentIds.add(job.id);
        const previousStatus = jobStatusRef.current.get(job.id);
        if (previousStatus !== job.status) {
          jobStatusRef.current.set(job.id, job.status);
          if (job.status === 'completed') {
            shouldRefreshFeatured = true;
            if (emitNotifications) toast.success(`Thumbnail updated for ${job.template_name}`);
          }
          if (job.status === 'failed') {
            const message = job.error_message
              ? `${job.template_name}: ${job.error_message}`
              : `${job.template_name}: Failed to generate thumbnail`;
            failureMessages.push(message);
          }
        }
      }

      jobStatusRef.current.forEach((_, id) => {
        if (!currentIds.has(id)) jobStatusRef.current.delete(id);
      });

      if (shouldRefreshFeatured) await loadUltraFeatured();
      failureMessages.slice(0, 3).forEach((message) => toast.error(`Thumbnail job failed – ${message}`));
      return true;
    } catch (error) {
      console.error('Failed to fetch thumbnail jobs:', error);
      return false;
    }
  }, [resolveAuthToken, loadUltraFeatured]);

  // Queue thumbnail job
  const queueThumbnailJob = useCallback(async (
    templateId: number,
    targetUrl: string,
    options: { successMessage?: string; suppressSuccessToast?: boolean } = {}
  ) => {
    try {
      const response = await fetch(`/api/admin/templates/${templateId}/thumbnail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({ targetUrl })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || 'Thumbnail job could not be queued');
      if (!options.suppressSuccessToast) toast.success(options.successMessage || 'Screenshot queued in background');
      await fetchThumbnailJobs({ emitNotifications: false });
      return true;
    } catch (error) {
      console.error('Thumbnail queue error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to queue thumbnail');
      return false;
    }
  }, [resolveAuthToken, fetchThumbnailJobs]);

  // Authentication
  const authenticate = useCallback(async () => {
    const token = password.trim();
    if (!token) {
      toast.error('Enter the admin password');
      return;
    }

    const verified = await loadStats(token);
    if (!verified) {
      toast.error('Invalid admin password');
      localStorage.removeItem('admin_auth');
      setIsAuthenticated(false);
      setStats(null);
      setPassword('');
      return;
    }

    localStorage.setItem('admin_auth', token);
    setPassword(token);
    setIsAuthenticated(true);

    await Promise.allSettled([
      loadSystemStats(token),
      loadFeaturedAuthors(token),
      loadUltraFeatured(token),
      fetchThumbnailJobs({ emitNotifications: false }, token),
    ]);

    toast.success('Authenticated');
  }, [password, loadStats, loadSystemStats, loadFeaturedAuthors, loadUltraFeatured, fetchThumbnailJobs]);

  const logout = useCallback(() => {
    localStorage.removeItem('admin_auth');
    setIsAuthenticated(false);
    setThumbnailJobs([]);
    setThumbnailQueueCounts({ pending: 0, running: 0, completed: 0, failed: 0 });
    jobStatusRef.current.clear();
  }, []);

  // Auto-login on mount
  useEffect(() => {
    const savedAuth = localStorage.getItem('admin_auth');
    if (!savedAuth) return;

    let cancelled = false;

    const attemptAutoLogin = async () => {
      const verified = await loadStats(savedAuth);
      if (!verified || cancelled) {
        if (!cancelled) {
          localStorage.removeItem('admin_auth');
          setPassword('');
          setIsAuthenticated(false);
        }
        return;
      }

      if (cancelled) return;

      setPassword(savedAuth);
      setIsAuthenticated(true);

      await Promise.allSettled([
        loadFeaturedAuthors(savedAuth),
        loadSystemStats(savedAuth),
        loadUltraFeatured(savedAuth),
        fetchThumbnailJobs({ emitNotifications: false }, savedAuth),
      ]);
    };

    attemptAutoLogin();
    return () => { cancelled = true; };
  }, [loadStats, loadFeaturedAuthors, loadSystemStats, loadUltraFeatured, fetchThumbnailJobs]);

  // Auto-refresh stats
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      loadStats();
      loadSystemStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadStats, loadSystemStats]);

  // Auto-refresh thumbnail jobs
  useEffect(() => {
    if (!isAuthenticated) {
      jobStatusRef.current.clear();
      setThumbnailJobs([]);
      setThumbnailQueueCounts({ pending: 0, running: 0, completed: 0, failed: 0 });
      return;
    }

    fetchThumbnailJobs();
    const interval = setInterval(() => fetchThumbnailJobs(), 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchThumbnailJobs]);

  const value: AdminContextType = {
    isAuthenticated,
    password,
    setPassword,
    authenticate,
    logout,
    resolveAuthToken,
    stats,
    systemStats,
    loadStats,
    loadSystemStats,
    featuredAuthors,
    availableAuthors,
    loadFeaturedAuthors,
    toggleFeaturedAuthor,
    ultraPool,
    ultraFeaturedTemplates,
    isUltraLoading,
    isUltraSaving,
    loadUltraFeatured,
    setUltraFeaturedTemplates,
    setUltraPool,
    persistUltraFeatured,
    thumbnailJobs,
    thumbnailQueueCounts,
    fetchThumbnailJobs,
    queueThumbnailJob,
    pendingThumbnailMap,
    withCacheBust,
    formatBytes,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}
