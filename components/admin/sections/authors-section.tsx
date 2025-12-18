'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAdmin } from '../admin-context';
import { Search, Users, Star } from 'lucide-react';

type Author = {
  author_id: string;
  author_name: string;
  author_avatar?: string | null;
  template_count?: number;
};

export function AuthorsSection() {
  const { featuredAuthors, availableAuthors, toggleFeaturedAuthor } = useAdmin();
  const [authorSearch, setAuthorSearch] = useState('');

  const featuredList = featuredAuthors as Author[];
  const availableList = availableAuthors as Author[];

  const featuredAuthorIds = useMemo(() => {
    return new Set(featuredList.map((author) => author.author_id));
  }, [featuredList]);

  const allAuthors = useMemo(() => {
    const map = new Map<string, Author>();
    availableList.forEach((author) => {
      if (!author?.author_id) return;
      map.set(author.author_id, author);
    });
    featuredList.forEach((author) => {
      if (!author?.author_id) return;
      if (!map.has(author.author_id)) {
        map.set(author.author_id, {
          author_id: author.author_id,
          author_name: author.author_name || 'Unknown',
          author_avatar: author.author_avatar || null,
          template_count: 0,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      const countA = a.template_count || 0;
      const countB = b.template_count || 0;
      if (countA !== countB) return countB - countA;
      return (a.author_name || '').localeCompare(b.author_name || '');
    });
  }, [availableList, featuredList]);

  const filteredAuthors = useMemo(() => {
    const q = authorSearch.trim().toLowerCase();
    if (!q) return allAuthors;
    return allAuthors.filter((author) => (author.author_name || '').toLowerCase().includes(q));
  }, [allAuthors, authorSearch]);

  const authorSuggestions = useMemo(() => {
    const q = authorSearch.trim().toLowerCase();
    if (!q) return [];
    return allAuthors
      .filter((author) => (author.author_name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [allAuthors, authorSearch]);

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Star className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Featured Authors</h2>
            <p className="text-sm text-gray-500">Highlight authors across the gallery by featuring them here</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search authors..."
              value={authorSearch}
              onChange={(e) => setAuthorSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          {authorSuggestions.length > 0 && (
            <div className="border rounded-lg bg-white shadow-sm">
              {authorSuggestions.map((author) => (
                <button
                  key={author.author_id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
                  onMouseDown={() => setAuthorSearch(author.author_name || '')}
                >
                  <span className="font-medium truncate">{author.author_name || 'Unknown'}</span>
                  <span className="text-xs text-gray-500">{author.template_count || 0} templates</span>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-gray-500" />
                <h3 className="font-medium">All Authors ({filteredAuthors.length})</h3>
              </div>
              <ScrollArea className="h-[420px] rounded-lg border bg-white">
                <div className="p-2 space-y-2">
                  {filteredAuthors.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">
                      {authorSearch ? 'No authors match your search' : 'No authors available'}
                    </div>
                  ) : (
                    filteredAuthors.map((author) => {
                      const isFeatured = featuredAuthorIds.has(author.author_id);
                      return (
                        <div key={author.author_id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="font-medium truncate">{author.author_name || 'Unknown'}</div>
                              {isFeatured && (
                                <Badge variant="secondary" className="text-[10px]">Featured</Badge>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">{author.template_count || 0} templates</div>
                          </div>
                          <Button
                            size="sm"
                            variant={isFeatured ? 'ghost' : 'default'}
                            className={isFeatured ? 'text-red-500 hover:text-red-700 hover:bg-red-50' : ''}
                            onClick={() => toggleFeaturedAuthor(author, !isFeatured)}
                          >
                            {isFeatured ? 'Remove' : 'Feature'}
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Star className="h-4 w-4 text-amber-500" />
                <h3 className="font-medium">Featured ({featuredAuthors.length})</h3>
              </div>
              <ScrollArea className="h-[420px] rounded-lg border bg-white">
                <div className="p-2 space-y-2">
                  {featuredAuthors.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">No featured authors yet</div>
                  ) : (
                    featuredAuthors.map((author) => (
                      <div key={author.author_id} className="flex items-center justify-between p-3 border rounded-lg bg-amber-50 border-amber-200">
                        <div className="font-medium">{author.author_name || 'Unknown'}</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => toggleFeaturedAuthor(author, false)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </Card>
          </div>
        </div>
      </Card>
    </div>
  );
}
