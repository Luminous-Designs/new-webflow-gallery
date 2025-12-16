'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Monitor, Smartphone, ExternalLink, Loader2, ArrowLeft, ArrowRight, Home } from 'lucide-react';
import type { Template } from '@/types/template';

interface TemplatePreviewProps {
  template: Template | null;
  isOpen: boolean;
  onClose: () => void;
  primaryAction?: {
    label: string;
    onClick: (template: Template, currentUrl: string) => Promise<void> | void;
  };
}

export default function TemplatePreview({ template, isOpen, onClose, primaryAction }: TemplatePreviewProps) {
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [iframeLoading, setIframeLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const navigationHistory = useRef<string[]>([]);
  const currentHistoryIndex = useRef(0);
  const allowedDomain = useRef<string>('');
  const loadStartTime = useRef<number>(0);

  // Extract domain from URL
  const getDomain = (url: string) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  };

  // Initialize when template changes
  useEffect(() => {
    setActionLoading(false);
    if (template?.live_preview_url) {
      const url = template.live_preview_url;
      setCurrentUrl(url);
      navigationHistory.current = [url];
      currentHistoryIndex.current = 0;
      setCanGoBack(false);
      setCanGoForward(false);
      allowedDomain.current = getDomain(url);
      setIframeLoading(true);
      loadStartTime.current = Date.now();

      console.log('📱 Preview initialized:', {
        url,
        domain: allowedDomain.current
      });
    }
  }, [template]);

  // Check if URL is allowed (same domain)
  const isUrlAllowed = useCallback((url: string): boolean => {
    const domain = getDomain(url);
    const isAllowed = domain === allowedDomain.current ||
                      domain.endsWith(`.${allowedDomain.current}`) ||
                      allowedDomain.current.endsWith(`.${domain}`);

    console.log('🔒 URL validation:', {
      url,
      domain,
      allowedDomain: allowedDomain.current,
      isAllowed
    });

    return isAllowed;
  }, []);

  // Navigate to a URL
  const navigateTo = useCallback((url: string, addToHistory = true) => {
    if (!isUrlAllowed(url)) {
      console.warn('❌ Navigation blocked - external domain:', url);
      return;
    }

    console.log('🧭 Navigating to:', url);
    setCurrentUrl(url);
    setIframeLoading(true);

    if (addToHistory) {
      // Remove any forward history
      navigationHistory.current = navigationHistory.current.slice(0, currentHistoryIndex.current + 1);
      // Add new URL
      navigationHistory.current.push(url);
      currentHistoryIndex.current = navigationHistory.current.length - 1;

      setCanGoBack(currentHistoryIndex.current > 0);
      setCanGoForward(false);
    }
  }, [isUrlAllowed]);

  // Navigation handlers
  const handleGoBack = () => {
    if (currentHistoryIndex.current > 0) {
      currentHistoryIndex.current--;
      const url = navigationHistory.current[currentHistoryIndex.current];
      setCurrentUrl(url);
      setCanGoBack(currentHistoryIndex.current > 0);
      setCanGoForward(true);
      setIframeLoading(true);
    }
  };

  const handleGoForward = () => {
    if (currentHistoryIndex.current < navigationHistory.current.length - 1) {
      currentHistoryIndex.current++;
      const url = navigationHistory.current[currentHistoryIndex.current];
      setCurrentUrl(url);
      setCanGoBack(true);
      setCanGoForward(currentHistoryIndex.current < navigationHistory.current.length - 1);
      setIframeLoading(true);
    }
  };

  const handleGoHome = () => {
    if (template?.live_preview_url) {
      console.log('🏠 Going home to:', template.live_preview_url);
      // Reset navigation history
      navigationHistory.current = [template.live_preview_url];
      currentHistoryIndex.current = 0;
      setCanGoBack(false);
      setCanGoForward(false);
      // Navigate to home
      setCurrentUrl(template.live_preview_url);
      setIframeLoading(true);
    }
  };

  const handlePrimaryActionClick = async () => {
    if (!template || iframeLoading || actionLoading || !primaryAction?.onClick) {
      return;
    }

    try {
      setActionLoading(true);
      await Promise.resolve(primaryAction.onClick(template, currentUrl));
      onClose();
    } catch (error) {
      console.error('Template preview primary action failed:', error);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle iframe load completion
  const handleIframeLoad = async () => {
    const loadEndTime = Date.now();
    setIframeLoading(false);

    // Track preview load time
    if (template) {
      const loadTime = loadEndTime - loadStartTime.current;
      try {
        await fetch('/api/metrics/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            templateId: template.id,
            sessionId: sessionStorage.getItem('session_id') || 'unknown',
            loadTimeMs: loadTime,
            deviceType: previewMode,
            errorOccurred: false
          })
        });
      } catch (error) {
        console.error('Failed to track preview metric:', error);
      }
    }

    // Try to inject navigation interceptor
    try {
      const iframe = iframeRef.current;
      if (iframe && iframe.contentWindow) {
        // Navigation interception for cross-origin previews is handled via the proxy and message listener below.
        // If the preview becomes same-origin, this is where additional interception logic could live.
      }
    } catch {
      console.log('⚠️ Could not inject navigation interceptor (cross-origin)');
    }
  };

  // Listen for navigation messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigation') {
        const url = event.data.url;
        console.log('📨 Navigation message received:', url);
        navigateTo(url);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigateTo, template]);

  if (!template || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="!max-w-[95vw] !w-[95vw] h-[95vh] p-0 flex flex-col"
        style={{ maxWidth: '95vw', width: '95vw' }}
      >
        {/* Header with navigation controls */}
        <DialogHeader className="p-4 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <DialogTitle>{template.name}</DialogTitle>

              {/* Navigation controls */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleGoBack}
                  disabled={!canGoBack}
                  title="Go back"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleGoForward}
                  disabled={!canGoForward}
                  title="Go forward"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleGoHome}
                  title="Go to template home"
                >
                  <Home className="h-4 w-4" />
                </Button>

                <div className="text-sm text-gray-500 ml-2 max-w-md truncate">
                  {currentUrl}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* View mode toggles */}
              <Button
                size="sm"
                variant={previewMode === 'desktop' ? 'default' : 'outline'}
                onClick={() => setPreviewMode('desktop')}
              >
                <Monitor className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant={previewMode === 'mobile' ? 'default' : 'outline'}
                onClick={() => setPreviewMode('mobile')}
              >
                <Smartphone className="h-4 w-4" />
              </Button>

              {/* External link - only opens template home */}
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(template.live_preview_url, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Open Original
              </Button>

              {primaryAction ? (
                <Button
                  size="sm"
                  onClick={handlePrimaryActionClick}
                  disabled={iframeLoading || actionLoading}
                  className="flex items-center gap-2"
                >
                  {actionLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {primaryAction.label}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogHeader>

        {/* Preview area */}
        <div className="flex-1 overflow-hidden bg-gray-100 p-4 relative">
          <div
            className={`mx-auto h-full bg-white rounded-lg shadow-lg overflow-hidden transition-all duration-300 relative ${
              previewMode === 'mobile' ? 'max-w-sm' : 'w-full'
            }`}
          >
            {/* Loading overlay */}
            {iframeLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-500" />
                  <p className="mt-4 text-gray-600">Loading preview...</p>
                </div>
              </div>
            )}

            {/* Iframe with proxy to handle cross-origin */}
            <iframe
              ref={iframeRef}
              src={`/api/proxy?url=${encodeURIComponent(currentUrl)}`}
              className="w-full h-full border-0"
              title="Template Preview"
              onLoad={handleIframeLoad}
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />

            {/* Invisible overlay to intercept clicks if iframe is cross-origin */}
            <div
              className="absolute inset-0 z-20 pointer-events-none"
              style={{ display: iframeLoading ? 'none' : 'none' }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
