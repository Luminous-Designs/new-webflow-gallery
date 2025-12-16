'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import {
  Home,
  ArrowRight,
  RefreshCw,
  Loader2,
  ExternalLink,
  BarChart3,
  TrendingUp,
  FileSearch
} from 'lucide-react';

interface AlternateHomepageMetrics {
  totalTemplates: number;
  alternateHomepageCount: number;
  indexPageCount: number;
  alternatePercentage: number;
  topAlternatePaths: Array<{ path: string; count: number }>;
}

interface AlternateTemplate {
  id: number;
  name: string;
  slug: string;
  author_name: string;
  live_preview_url: string;
  screenshot_url: string;
  alternate_homepage_path: string;
  screenshot_thumbnail_path: string;
}

interface AlternateHomepageData {
  metrics: AlternateHomepageMetrics;
  templates: AlternateTemplate[];
  patterns: {
    slugPatterns: string[];
    pathPatterns: string[];
  };
}

export function AlternateHomepageMetricsSection() {
  const { resolveAuthToken } = useAdmin();
  const [data, setData] = useState<AlternateHomepageData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/alternate-homepage', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch alternate homepage metrics:', error);
    } finally {
      setIsLoading(false);
    }
  }, [resolveAuthToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (!data && !isLoading) {
    return null;
  }

  return (
    <Card className="p-6 border-2 border-indigo-100 bg-gradient-to-br from-indigo-50/50 to-white">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Home className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Alternate Homepage Detection</h2>
            <p className="text-sm text-gray-500">
              Templates where we scraped an alternate page instead of the index
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {data ? (
        <>
          {/* Metrics Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-white rounded-lg border text-center">
              <BarChart3 className="h-5 w-5 text-gray-400 mx-auto mb-1" />
              <div className="text-2xl font-bold text-gray-700">{data.metrics.totalTemplates}</div>
              <div className="text-xs text-gray-500">Total Templates</div>
            </div>
            <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200 text-center">
              <ArrowRight className="h-5 w-5 text-indigo-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-indigo-600">{data.metrics.alternateHomepageCount}</div>
              <div className="text-xs text-indigo-600">Alternate Pages</div>
            </div>
            <div className="p-4 bg-white rounded-lg border text-center">
              <Home className="h-5 w-5 text-gray-400 mx-auto mb-1" />
              <div className="text-2xl font-bold text-gray-600">{data.metrics.indexPageCount}</div>
              <div className="text-xs text-gray-500">Index Pages</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200 text-center">
              <TrendingUp className="h-5 w-5 text-green-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-green-600">{data.metrics.alternatePercentage}%</div>
              <div className="text-xs text-green-600">Detection Rate</div>
            </div>
          </div>

          {/* Top Alternate Paths */}
          {data.metrics.topAlternatePaths.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Top Detected Paths</h3>
              <div className="flex flex-wrap gap-2">
                {data.metrics.topAlternatePaths.map((item, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                  >
                    {item.path}
                    <span className="ml-1 text-indigo-500">({item.count})</span>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Toggle Templates List */}
          {data.templates.length > 0 && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="mb-2"
              >
                <FileSearch className="h-4 w-4 mr-2" />
                {isExpanded ? 'Hide' : 'Show'} Templates ({data.templates.length})
              </Button>

              {isExpanded && (
                <ScrollArea className="h-[300px] rounded-lg border bg-white">
                  <div className="p-2 space-y-2">
                    {data.templates.map((template) => (
                      <div
                        key={template.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 group"
                      >
                        {/* Thumbnail */}
                        <div className="relative w-16 h-16 rounded overflow-hidden bg-gray-100 flex-shrink-0">
                          {template.screenshot_thumbnail_path ? (
                            <Image
                              src={template.screenshot_thumbnail_path}
                              alt={template.name}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <Home className="h-6 w-6" />
                            </div>
                          )}
                          {/* Alternate indicator badge */}
                          <div className="absolute top-1 right-1">
                            <Badge className="bg-indigo-500 text-white text-[10px] px-1 py-0">
                              ALT
                            </Badge>
                          </div>
                        </div>

                        {/* Template Info */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-800 truncate">{template.name}</div>
                          <div className="text-xs text-gray-500 truncate">
                            by {template.author_name || 'Unknown'}
                          </div>
                          <div className="mt-1">
                            <Badge variant="outline" className="text-[10px] bg-indigo-50 border-indigo-200 text-indigo-700">
                              {template.alternate_homepage_path}
                            </Badge>
                          </div>
                        </div>

                        {/* External Link */}
                        <a
                          href={template.screenshot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="py-8 text-center text-gray-500">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>Loading metrics...</p>
        </div>
      )}
    </Card>
  );
}

/**
 * Small badge indicator for templates with alternate homepage screenshots
 * Use this in template lists/grids
 */
export function AlternateHomepageBadge({ path }: { path?: string | null }) {
  if (!path) return null;

  return (
    <Badge
      variant="secondary"
      className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 flex items-center gap-1"
      title={`Screenshot from: ${path}`}
    >
      <ArrowRight className="h-3 w-3" />
      <span className="hidden sm:inline">{path}</span>
      <span className="sm:hidden">ALT</span>
    </Badge>
  );
}
