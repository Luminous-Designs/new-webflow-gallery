'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import {
  Ban,
  Trash2,
  Plus,
  Loader2,
  Search,
  ExternalLink,
  AlertCircle
} from 'lucide-react';

interface BlacklistEntry {
  id: number;
  domain_slug: string;
  storefront_url?: string;
  reason: string;
  created_at: string;
}

export function BlacklistSection() {
  const { resolveAuthToken } = useAdmin();

  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Load blacklist
  const loadBlacklist = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/blacklist', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (response.ok) {
        const data = await response.json();
        setBlacklist(data.blacklist);
      }
    } catch (error) {
      console.error('Failed to load blacklist:', error);
      toast.error('Failed to load blacklist');
    } finally {
      setIsLoading(false);
    }
  }, [resolveAuthToken]);

  useEffect(() => {
    loadBlacklist();
  }, [loadBlacklist]);

  // Add to blacklist
  const addToBlacklist = async () => {
    if (!newUrl.trim()) {
      toast.error('Please enter a URL');
      return;
    }

    setIsAdding(true);
    try {
      const response = await fetch('/api/admin/blacklist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveAuthToken()}`
        },
        body: JSON.stringify({
          livePreviewUrl: newUrl,
          reason: 'admin_blocked'
        })
      });

      if (response.ok) {
        toast.success('Template added to blacklist');
        setNewUrl('');
        loadBlacklist();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add';
      toast.error(message);
    } finally {
      setIsAdding(false);
    }
  };

  // Remove from blacklist
  const removeFromBlacklist = async (domainSlug: string) => {
    try {
      const response = await fetch(`/api/admin/blacklist?domainSlug=${encodeURIComponent(domainSlug)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (response.ok) {
        toast.success('Removed from blacklist');
        loadBlacklist();
      } else {
        throw new Error('Failed to remove');
      }
    } catch (error) {
      toast.error('Failed to remove from blacklist');
    }
  };

  // Filter blacklist
  const filteredBlacklist = blacklist.filter(entry =>
    entry.domain_slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (entry.storefront_url && entry.storefront_url.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Format reason
  const formatReason = (reason: string): { label: string; color: string } => {
    switch (reason) {
      case 'manual_skip':
        return { label: 'Skipped', color: 'bg-yellow-100 text-yellow-700' };
      case 'error_threshold':
        return { label: 'Too Many Errors', color: 'bg-red-100 text-red-700' };
      case 'admin_blocked':
        return { label: 'Blocked by Admin', color: 'bg-purple-100 text-purple-700' };
      default:
        return { label: reason, color: 'bg-gray-100 text-gray-700' };
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-red-100 rounded-lg">
            <Ban className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Template Blacklist</h2>
            <p className="text-sm text-gray-500">
              Blacklisted templates are excluded from future scrapes
            </p>
          </div>
        </div>

        {/* Add to Blacklist */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-medium text-gray-700 mb-3">Add Template to Blacklist</h3>
          <div className="flex gap-2">
            <Input
              placeholder="Enter live preview URL (e.g., https://template-name.webflow.io)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={isAdding}
            />
            <Button onClick={addToBlacklist} disabled={isAdding}>
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Enter the live preview URL of the template you want to blacklist.
            The domain slug will be extracted automatically.
          </p>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search blacklist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Blacklist */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : filteredBlacklist.length === 0 ? (
          <div className="text-center py-8">
            <AlertCircle className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500">
              {blacklist.length === 0
                ? 'No blacklisted templates'
                : 'No matching templates found'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {filteredBlacklist.map((entry) => {
                const { label, color } = formatReason(entry.reason);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-gray-50 group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Ban className="h-4 w-4 text-red-500 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-gray-700 truncate">
                          {entry.domain_slug}
                        </p>
                        {entry.storefront_url && (
                          <p className="text-xs text-gray-400 truncate">
                            {entry.storefront_url}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={color}>
                        {label}
                      </Badge>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.created_at).toLocaleDateString()}
                      </span>

                      {entry.storefront_url && (
                        <a
                          href={entry.storefront_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="View storefront"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFromBlacklist(entry.domain_slug)}
                        className="text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Stats */}
        <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-gray-500">
          <span>{blacklist.length} template{blacklist.length !== 1 ? 's' : ''} blacklisted</span>
          {searchQuery && (
            <span>
              Showing {filteredBlacklist.length} of {blacklist.length}
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
