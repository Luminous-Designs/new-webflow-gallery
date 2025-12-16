/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import { useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import { Image as ImageIcon, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';

interface MissingImagesData {
  missingCount: number;
  totalTemplates: number;
  withImages: number;
  alreadyQueued: number;
  templates: Array<{
    id: number;
    name: string;
    slug: string;
    live_preview_url: string;
    screenshot_path: string | null;
    screenshot_thumbnail_path: string | null;
    missing_screenshot?: boolean;
    missing_thumbnail?: boolean;
  }>;
}

export function ImagesSection() {
  const { resolveAuthToken, fetchThumbnailJobs } = useAdmin();

  const [missingImagesData, setMissingImagesData] = useState<MissingImagesData | null>(null);
  const [isLoadingMissingImages, setIsLoadingMissingImages] = useState(false);
  const [isEnqueuingMissingImages, setIsEnqueuingMissingImages] = useState(false);

  const loadMissingImages = useCallback(async () => {
    try {
      setIsLoadingMissingImages(true);
      const response = await fetch('/api/admin/missing-images', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });
      if (response.ok) {
        const data = await response.json();
        setMissingImagesData(data);
      }
    } catch (error) {
      console.error('Failed to load missing images data:', error);
    } finally {
      setIsLoadingMissingImages(false);
    }
  }, [resolveAuthToken]);

  const enqueueMissingImages = useCallback(async () => {
    try {
      setIsEnqueuingMissingImages(true);
      const response = await fetch('/api/admin/missing-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: JSON.stringify({})
      });

      const result = await response.json();

      if (response.ok && result.success) {
        toast.success(result.message);
        await loadMissingImages();
        await fetchThumbnailJobs({ emitNotifications: false });
      } else {
        toast.error(result.error || 'Failed to enqueue templates');
      }
    } catch (error) {
      toast.error('Failed to enqueue templates');
    } finally {
      setIsEnqueuingMissingImages(false);
    }
  }, [resolveAuthToken, loadMissingImages, fetchThumbnailJobs]);

  // Load on mount
  useState(() => {
    loadMissingImages();
  });

  return (
    <div className="space-y-6">
      <Card className="p-6 border-2 border-amber-100 bg-gradient-to-br from-amber-50/30 to-white">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <ImageIcon className="h-6 w-6 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Template Image Management</h2>
              <p className="text-sm text-gray-500">Checks actual file existence on disk, not just database paths</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadMissingImages} disabled={isLoadingMissingImages}>
            {isLoadingMissingImages ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
          </Button>
        </div>

        {/* Stats Grid */}
        {missingImagesData ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-gray-900">{missingImagesData.totalTemplates.toLocaleString()}</div>
              <div className="text-sm text-gray-500">Total Templates</div>
            </div>
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="text-2xl font-bold text-green-700">{missingImagesData.withImages.toLocaleString()}</div>
              <div className="text-sm text-green-600">Files Exist Locally</div>
            </div>
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <div className="text-2xl font-bold text-red-700">{missingImagesData.missingCount.toLocaleString()}</div>
              <div className="text-sm text-red-600">Files Missing Locally</div>
            </div>
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-2xl font-bold text-blue-700">{missingImagesData.alreadyQueued.toLocaleString()}</div>
              <div className="text-sm text-blue-600">Queued for Processing</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-4 bg-gray-50 rounded-lg border animate-pulse">
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        )}

        {/* Action Section */}
        {missingImagesData && missingImagesData.missingCount > 0 && (
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-amber-800">
                  {missingImagesData.missingCount} templates need screenshots
                </h3>
                <p className="text-sm text-amber-600 mt-1">
                  Click the button to queue all templates with missing images for screenshot generation.
                  {missingImagesData.alreadyQueued > 0 && (
                    <span className="block mt-1">{missingImagesData.alreadyQueued} are already in the queue.</span>
                  )}
                </p>
              </div>
              <Button onClick={enqueueMissingImages} disabled={isEnqueuingMissingImages} className="bg-amber-600 hover:bg-amber-700">
                {isEnqueuingMissingImages ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enqueueing...</>
                ) : (
                  <><ImageIcon className="h-4 w-4 mr-2" />Generate Missing Images</>
                )}
              </Button>
            </div>
          </div>
        )}

        {missingImagesData && missingImagesData.missingCount === 0 && (
          <div className="p-4 bg-green-50 rounded-lg border border-green-200 mb-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <h3 className="font-medium text-green-800">All templates have images</h3>
                <p className="text-sm text-green-600">Every template has both a screenshot and thumbnail.</p>
              </div>
            </div>
          </div>
        )}

        {/* Templates Missing Images List */}
        {missingImagesData && missingImagesData.templates.length > 0 && (
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Templates Missing Images ({missingImagesData.templates.length})</h3>
            <ScrollArea className="h-[300px] rounded-lg border bg-white">
              <div className="p-2 space-y-2">
                {missingImagesData.templates.map((template) => (
                  <div key={template.id} className="p-3 rounded-lg border bg-gray-50 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{template.name}</div>
                      <div className="text-xs text-gray-500 truncate">{template.slug}</div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {template.missing_screenshot && (
                        <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">No Screenshot</Badge>
                      )}
                      {template.missing_thumbnail && (
                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">No Thumbnail</Badge>
                      )}
                      <a href={template.live_preview_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Rsync Note */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg border">
          <h4 className="font-medium text-gray-700 mb-2">Deployment Note</h4>
          <p className="text-sm text-gray-600">After generating new screenshots locally, sync them to the VPS using rsync:</p>
          <code className="block mt-2 p-2 bg-gray-100 rounded text-xs text-gray-700 overflow-x-auto">
            rsync -avz --progress public/screenshots/ root@your-vps:/data/webflow-gallery/screenshots/
          </code>
        </div>
      </Card>
    </div>
  );
}
