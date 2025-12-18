/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
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
    total: number;
    screenshotCount: number;
  };
  recommendations: {
    maxConcurrency: number;
    suggestedBrowsers: number;
    suggestedPagesPerBrowser: number;
  };
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

  const withCacheBust = useCallback((url?: string, version?: number) => {
    if (!url) return '';
    if (!version) return url;
    return url.includes('?') ? `${url}&v=${version}` : `${url}?v=${version}`;
  }, []);

  const resolveAuthToken = useCallback(() => {
    return password || localStorage.getItem('admin_auth') || '';
  }, [password]);

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
    ]);

    toast.success('Authenticated');
  }, [password, loadStats, loadSystemStats, loadFeaturedAuthors, loadUltraFeatured]);

  const logout = useCallback(() => {
    localStorage.removeItem('admin_auth');
    setIsAuthenticated(false);
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
      ]);
    };

    attemptAutoLogin();
    return () => { cancelled = true; };
  }, [loadStats, loadFeaturedAuthors, loadSystemStats, loadUltraFeatured]);

  // Auto-refresh stats
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      loadStats();
      loadSystemStats();
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, loadStats, loadSystemStats]);

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
    withCacheBust,
    formatBytes,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
}
