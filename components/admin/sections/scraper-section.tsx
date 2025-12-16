/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import {
  Download,
  Loader2,
  Trash2,
  CheckCircle2,
  XCircle,
  Radar,
  Play,
  FileSearch,
  Database,
  Globe,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { AlternateHomepageMetricsSection } from './alternate-homepage-metrics';

interface ScrapeProgress {
  jobId: number | null;
  processed: number;
  successful: number;
  failed: number;
  total: number;
}

interface DiscoveryState {
  phase: 'idle' | 'discovering' | 'discovered' | 'confirming' | 'scraping';
  message: string;
  sitemapCount: number;
  existingCount: number;
  newTemplates: Array<{ url: string; slug: string; displayName: string }>;
  error: string | null;
}

export function ScraperSection() {
  const { stats, loadStats, resolveAuthToken } = useAdmin();

  const [isScrapingActive, setIsScrapingActive] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [singleScrapeUrl, setSingleScrapeUrl] = useState('');
  const [scrapeSpeed, setScrapeSpeed] = useState('5');
  const [scrapeAdvancedMode, setScrapeAdvancedMode] = useState(false);
  const [browserInstances, setBrowserInstances] = useState('2');
  const [pagesPerBrowser, setPagesPerBrowser] = useState('5');
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({
    phase: 'idle',
    message: '',
    sitemapCount: 0,
    existingCount: 0,
    newTemplates: [],
    error: null
  });

  const addConsoleLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 100));
  }, []);

  // Discover new templates
  const discoverNewTemplates = async () => {
    setDiscoveryState({
      phase: 'discovering',
      message: 'Fetching Webflow sitemap...',
      sitemapCount: 0,
      existingCount: 0,
      newTemplates: [],
      error: null
    });
    addConsoleLog('[INFO] Starting template discovery...');

    try {
      const response = await fetch('/api/admin/scrape/discover', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Discovery failed');
      }

      const data = await response.json();
      const { discovery } = data;

      setDiscoveryState({
        phase: 'discovered',
        message: discovery.newCount > 0
          ? `Found ${discovery.newCount} new template${discovery.newCount === 1 ? '' : 's'}!`
          : 'No new templates found. Your collection is up to date!',
        sitemapCount: discovery.totalInSitemap,
        existingCount: discovery.existingInDb,
        newTemplates: discovery.newTemplates,
        error: null
      });

      addConsoleLog(`[SUCCESS] Discovery complete: ${discovery.newCount} new templates found`);
      addConsoleLog(`[INFO] Sitemap: ${discovery.totalInSitemap} | Database: ${discovery.existingInDb}`);

      if (discovery.newCount > 0) {
        toast.success(`Found ${discovery.newCount} new templates!`);
      } else {
        toast.info('No new templates found');
      }
    } catch (error) {
      console.error('Discovery failed:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setDiscoveryState(prev => ({ ...prev, phase: 'idle', error: message }));
      addConsoleLog(`[ERROR] Discovery failed: ${message}`);
      toast.error(`Discovery failed: ${message}`);
    }
  };

  // Monitor scraping progress
  const monitorProgress = useCallback(async (jobId: number) => {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/admin/scrape/progress/${jobId}`, {
          headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
        });

        if (response.ok) {
          const progress = await response.json();
          setScrapeProgress(progress);

          if (progress.status === 'completed' || progress.status === 'failed') {
            clearInterval(interval);
            setIsScrapingActive(false);
            setDiscoveryState({
              phase: 'idle',
              message: '',
              sitemapCount: 0,
              existingCount: 0,
              newTemplates: [],
              error: null
            });
            loadStats();

            if (progress.status === 'completed') {
              toast.success('Scraping completed successfully');
              addConsoleLog('[SUCCESS] Scraping job completed');
            } else {
              toast.error('Scraping failed');
              addConsoleLog('[ERROR] Scraping job failed');
            }
          }
        }
      } catch (error) {
        console.error('Failed to get progress:', error);
      }
    }, 2000);
  }, [resolveAuthToken, loadStats, addConsoleLog]);

  // Start scraping discovered templates
  const startDiscoveredScrape = async () => {
    if (discoveryState.newTemplates.length === 0) return;

    const urls = discoveryState.newTemplates.map(t => t.url);
    setDiscoveryState(prev => ({
      ...prev,
      phase: 'scraping',
      message: `Scraping ${urls.length} new templates...`
    }));

    try {
      const body = {
        action: 'urls',
        urls,
        concurrency: scrapeAdvancedMode
          ? parseInt(browserInstances) * parseInt(pagesPerBrowser)
          : parseInt(scrapeSpeed),
        browserInstances: scrapeAdvancedMode ? parseInt(browserInstances) : 1,
        pagesPerBrowser: scrapeAdvancedMode ? parseInt(pagesPerBrowser) : parseInt(scrapeSpeed)
      };

      const response = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setIsScrapingActive(true);
        toast.success(`Scraping ${urls.length} new templates...`);
        addConsoleLog(`[INFO] Scrape job started with ID: ${data.jobId}`);
        monitorProgress(data.jobId);
      } else {
        throw new Error(data.error || 'Failed to start scrape');
      }
    } catch (error) {
      console.error('Failed to start scraping:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      setDiscoveryState(prev => ({ ...prev, phase: 'discovered', error: message }));
      toast.error(`Failed to start scraping: ${message}`);
    }
  };

  // Start scraping
  const startScraping = async (action: 'full' | 'update' | 'single') => {
    try {
      const body: any = {
        action,
        concurrency: scrapeAdvancedMode
          ? parseInt(browserInstances) * parseInt(pagesPerBrowser)
          : parseInt(scrapeSpeed),
        browserInstances: scrapeAdvancedMode ? parseInt(browserInstances) : 1,
        pagesPerBrowser: scrapeAdvancedMode ? parseInt(pagesPerBrowser) : parseInt(scrapeSpeed)
      };
      if (action === 'single') {
        if (!singleScrapeUrl) {
          toast.error('Please enter a URL');
          return;
        }
        body.url = singleScrapeUrl;
      }

      const response = await fetch('/api/admin/scrape', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (response.ok) {
        setIsScrapingActive(true);
        toast.success(`Scrape job started: ${data.jobId}`);
        addConsoleLog(`[INFO] Scrape job started with ID: ${data.jobId}`);
        monitorProgress(data.jobId);
      } else {
        toast.error(data.error);
      }
    } catch (error) {
      console.error('Failed to start scraping:', error);
      toast.error('Failed to start scraping');
    }
  };

  // Reset discovery state
  const resetDiscovery = () => {
    setDiscoveryState({
      phase: 'idle',
      message: '',
      sitemapCount: 0,
      existingCount: 0,
      newTemplates: [],
      error: null
    });
  };

  // Delete all templates
  const deleteAllTemplates = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch('/api/admin/delete-all', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (response.ok) {
        toast.success('All templates and screenshots have been deleted');
        loadStats();
      } else {
        const error = await response.json();
        toast.error(`Failed to delete: ${error.error}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      toast.error('Failed to delete templates');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Update Templates Section */}
      <Card className="p-6 border-2 border-blue-100 bg-gradient-to-br from-blue-50/50 to-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Radar className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Update Templates</h2>
            <p className="text-sm text-gray-500">Check for new templates and add them to your collection</p>
          </div>
        </div>

        {/* Step Progress Indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            {/* Step 1: Discover */}
            <div className={`flex items-center gap-2 ${
              discoveryState.phase === 'idle' ? 'text-gray-400' :
              discoveryState.phase === 'discovering' ? 'text-blue-600' :
              'text-green-600'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                discoveryState.phase === 'idle' ? 'border-gray-300 bg-white' :
                discoveryState.phase === 'discovering' ? 'border-blue-500 bg-blue-50' :
                'border-green-500 bg-green-50'
              }`}>
                {discoveryState.phase === 'discovering' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : discoveryState.phase !== 'idle' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <FileSearch className="h-4 w-4" />
                )}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Discover</span>
            </div>

            <div className={`flex-1 h-1 mx-2 rounded ${
              discoveryState.phase === 'idle' || discoveryState.phase === 'discovering' ? 'bg-gray-200' : 'bg-green-400'
            }`} />

            {/* Step 2: Review */}
            <div className={`flex items-center gap-2 ${
              discoveryState.phase === 'idle' || discoveryState.phase === 'discovering' ? 'text-gray-400' :
              discoveryState.phase === 'discovered' || discoveryState.phase === 'confirming' ? 'text-blue-600' :
              'text-green-600'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                discoveryState.phase === 'idle' || discoveryState.phase === 'discovering' ? 'border-gray-300 bg-white' :
                discoveryState.phase === 'discovered' || discoveryState.phase === 'confirming' ? 'border-blue-500 bg-blue-50' :
                'border-green-500 bg-green-50'
              }`}>
                {discoveryState.phase === 'scraping' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <FileSearch className="h-4 w-4" />
                )}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Review</span>
            </div>

            <div className={`flex-1 h-1 mx-2 rounded ${
              discoveryState.phase === 'scraping' || (discoveryState.phase === 'idle' && !isScrapingActive) ?
                (discoveryState.phase === 'scraping' ? 'bg-blue-400' : 'bg-gray-200') : 'bg-gray-200'
            }`} />

            {/* Step 3: Scrape */}
            <div className={`flex items-center gap-2 ${
              discoveryState.phase === 'scraping' || isScrapingActive ? 'text-blue-600' : 'text-gray-400'
            }`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                discoveryState.phase === 'scraping' || isScrapingActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white'
              }`}>
                {isScrapingActive ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </div>
              <span className="text-sm font-medium hidden sm:inline">Scrape</span>
            </div>
          </div>
        </div>

        {/* Discovery Phase Content */}
        {discoveryState.phase === 'idle' && !isScrapingActive && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
              <Globe className="h-8 w-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-medium mb-2">Check for New Templates</h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Scan the Webflow marketplace sitemap to discover new templates that have been added since your last update.
            </p>
            <Button size="lg" onClick={discoverNewTemplates} className="bg-blue-600 hover:bg-blue-700">
              <Radar className="h-5 w-5 mr-2" />
              Check for Updates
            </Button>
            {discoveryState.error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <XCircle className="h-4 w-4 inline mr-2" />
                {discoveryState.error}
              </div>
            )}
          </div>
        )}

        {/* Discovering Phase */}
        {discoveryState.phase === 'discovering' && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4 animate-pulse">
              <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
            <h3 className="text-lg font-medium mb-2">Discovering New Templates...</h3>
            <p className="text-gray-500 mb-4">{discoveryState.message}</p>
          </div>
        )}

        {/* Discovered Phase */}
        {discoveryState.phase === 'discovered' && (
          <div className="py-4">
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-white rounded-lg border text-center">
                <Globe className="h-5 w-5 text-gray-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-gray-700">{discoveryState.sitemapCount}</div>
                <div className="text-xs text-gray-500">In Sitemap</div>
              </div>
              <div className="p-4 bg-white rounded-lg border text-center">
                <Database className="h-5 w-5 text-green-500 mx-auto mb-1" />
                <div className="text-2xl font-bold text-green-600">{discoveryState.existingCount}</div>
                <div className="text-xs text-gray-500">In Database</div>
              </div>
              <div className="p-4 bg-white rounded-lg border text-center">
                <Sparkles className="h-5 w-5 text-blue-500 mx-auto mb-1" />
                <div className="text-2xl font-bold text-blue-600">{discoveryState.newTemplates.length}</div>
                <div className="text-xs text-gray-500">New Templates</div>
              </div>
            </div>

            {discoveryState.newTemplates.length > 0 ? (
              <>
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-700">New Templates Found</h4>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                      {discoveryState.newTemplates.length} template{discoveryState.newTemplates.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <ScrollArea className="h-[200px] rounded-lg border bg-white">
                    <div className="p-2 space-y-1">
                      {discoveryState.newTemplates.map((template, index) => (
                        <div key={template.url} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 group">
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-medium">
                              {index + 1}
                            </span>
                            <span className="text-sm font-medium text-gray-700">{template.displayName}</span>
                          </div>
                          <a href={template.url} target="_blank" rel="noopener noreferrer"
                            className="text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={resetDiscovery} className="flex-1">
                    Cancel
                  </Button>
                  <Button onClick={startDiscoveredScrape} className="flex-1 bg-green-600 hover:bg-green-700">
                    <Play className="h-4 w-4 mr-2" />
                    Scrape {discoveryState.newTemplates.length} Template{discoveryState.newTemplates.length !== 1 ? 's' : ''}
                  </Button>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <h4 className="font-medium text-gray-700 mb-1">All Up to Date!</h4>
                <p className="text-sm text-gray-500 mb-4">Your collection is current with the Webflow marketplace.</p>
                <Button variant="outline" onClick={resetDiscovery}>Done</Button>
              </div>
            )}
          </div>
        )}

        {/* Scraping Phase */}
        {(discoveryState.phase === 'scraping' || isScrapingActive) && scrapeProgress && (
          <div className="py-4">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Scraping Progress</span>
                <span className="text-sm text-gray-500">{scrapeProgress.processed} / {scrapeProgress.total}</span>
              </div>
              <Progress value={(scrapeProgress.processed / Math.max(scrapeProgress.total, 1)) * 100} className="h-3" />
              <div className="flex justify-between mt-2 text-xs text-gray-500">
                <span>{Math.round((scrapeProgress.processed / Math.max(scrapeProgress.total, 1)) * 100)}% complete</span>
                <span>{scrapeProgress.total - scrapeProgress.processed} remaining</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-white rounded-lg border text-center">
                <div className="text-xl font-bold text-gray-700">{scrapeProgress.processed}</div>
                <div className="text-xs text-gray-500">Processed</div>
              </div>
              <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
                <div className="text-xl font-bold text-green-600">{scrapeProgress.successful}</div>
                <div className="text-xs text-green-600">Successful</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
                <div className="text-xl font-bold text-red-600">{scrapeProgress.failed}</div>
                <div className="text-xs text-red-600">Failed</div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-center gap-2 text-blue-700 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Scraping in progress... This may take a few minutes.</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions Card */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={() => startScraping('full')} disabled={isScrapingActive || discoveryState.phase !== 'idle'}
                className="flex-1" variant="outline">
                {isScrapingActive ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
                Full Scrape
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Single Template URL</label>
              <div className="flex gap-2">
                <Input placeholder="https://templates.webflow.com/html/..."
                  value={singleScrapeUrl} onChange={(e) => setSingleScrapeUrl(e.target.value)}
                  disabled={isScrapingActive || discoveryState.phase !== 'idle'} />
                <Button onClick={() => startScraping('single')} disabled={isScrapingActive || discoveryState.phase !== 'idle'}>
                  Scrape
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Scraping Configuration</label>
                <Button variant="outline" size="sm" onClick={() => setScrapeAdvancedMode(!scrapeAdvancedMode)}>
                  {scrapeAdvancedMode ? 'Simple Mode' : 'Advanced Mode'}
                </Button>
              </div>

              {!scrapeAdvancedMode ? (
                <Select value={scrapeSpeed} onValueChange={setScrapeSpeed}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Slow (1 concurrent)</SelectItem>
                    <SelectItem value="3">Medium (3 concurrent)</SelectItem>
                    <SelectItem value="5">Fast (5 concurrent)</SelectItem>
                    <SelectItem value="10">Very Fast (10 concurrent)</SelectItem>
                    <SelectItem value="20">Extreme (20 concurrent)</SelectItem>
                    <SelectItem value="50">Ultra (50 concurrent)</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Browser Instances</label>
                    <Select value={browserInstances} onValueChange={setBrowserInstances}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 8, 10, 15, 20].map(n => (
                          <SelectItem key={n} value={String(n)}>{n} Browser{n > 1 ? 's' : ''}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Pages per Browser</label>
                    <Select value={pagesPerBrowser} onValueChange={setPagesPerBrowser}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[5, 10, 15, 20, 25, 30, 40, 50].map(n => (
                          <SelectItem key={n} value={String(n)}>{n} Pages</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="p-2 bg-blue-50 rounded text-xs text-blue-700">
                    <strong>Total Concurrency: {parseInt(browserInstances) * parseInt(pagesPerBrowser)}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 border-t">
              <h3 className="text-sm font-medium text-red-600 mb-2">Danger Zone</h3>
              <Button variant="destructive" className="w-full"
                onClick={() => {
                  if (window.confirm('WARNING: This will delete ALL templates and screenshots.\n\nAre you sure?')) {
                    if (window.confirm('Are you ABSOLUTELY sure?')) {
                      deleteAllTemplates();
                    }
                  }
                }}
                disabled={isScrapingActive || isDeleting || discoveryState.phase !== 'idle'}>
                {isDeleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> :
                  <><Trash2 className="h-4 w-4 mr-2" />Delete All Templates & Screenshots</>}
              </Button>
            </div>
          </div>
        </Card>

        {/* Console Output */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Console Output</h2>
          <ScrollArea className="h-[400px] w-full rounded border p-4 font-mono text-xs bg-black text-green-400">
            {consoleLogs.length === 0 ? (
              <div className="text-gray-500">No logs yet...</div>
            ) : (
              consoleLogs.map((log, i) => <div key={i} className="mb-1">{log}</div>)
            )}
          </ScrollArea>
        </Card>
      </div>

      {/* Alternate Homepage Metrics */}
      <AlternateHomepageMetricsSection />

      {/* Recent Scrape Jobs */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Recent Scrape Jobs</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Templates</th>
                <th className="text-left p-2">Success/Failed</th>
                <th className="text-left p-2">Started</th>
                <th className="text-left p-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats?.recentJobs?.map((job) => (
                <tr key={job.id} className="border-b">
                  <td className="p-2">{job.id}</td>
                  <td className="p-2"><Badge variant="outline">{job.job_type}</Badge></td>
                  <td className="p-2">
                    <Badge variant={job.status === 'completed' ? 'default' : job.status === 'failed' ? 'destructive' : 'secondary'}>
                      {job.status}
                    </Badge>
                  </td>
                  <td className="p-2">{job.total_templates || 0}</td>
                  <td className="p-2">
                    <span className="text-green-600">{job.successful_templates || 0}</span>
                    {' / '}
                    <span className="text-red-600">{job.failed_templates || 0}</span>
                  </td>
                  <td className="p-2">{job.started_at ? new Date(job.started_at).toLocaleString() : '-'}</td>
                  <td className="p-2">
                    {job.started_at && job.completed_at
                      ? `${Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)}s`
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
