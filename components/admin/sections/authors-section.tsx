'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdmin } from '../admin-context';
import { Search, Users, Star } from 'lucide-react';

export function AuthorsSection() {
  const { featuredAuthors, availableAuthors, toggleFeaturedAuthor } = useAdmin();
  const [authorSearch, setAuthorSearch] = useState('');

  const filteredAvailable = availableAuthors.filter(a =>
    a.author_name?.toLowerCase().includes(authorSearch.toLowerCase()) &&
    !featuredAuthors.find(f => f.author_id === a.author_id)
  );

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Star className="h-6 w-6 text-amber-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Featured Authors</h2>
            <p className="text-sm text-gray-500">Manage which template authors are featured in the gallery</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search authors..."
                value={authorSearch}
                onChange={(e) => setAuthorSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Star className="h-4 w-4 text-amber-500" />
                <h3 className="font-medium">Featured ({featuredAuthors.length})</h3>
              </div>
              <ScrollArea className="h-[400px] rounded-lg border bg-white">
                <div className="p-2 space-y-2">
                  {featuredAuthors.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">No featured authors yet</div>
                  ) : (
                    featuredAuthors.map((author) => (
                      <div key={author.author_id} className="flex items-center justify-between p-3 border rounded-lg bg-amber-50 border-amber-200">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-amber-200 flex items-center justify-center">
                            <Users className="h-4 w-4 text-amber-700" />
                          </div>
                          <span className="font-medium">{author.author_name}</span>
                        </div>
                        <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => toggleFeaturedAuthor(author, false)}>
                          Remove
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-gray-500" />
                <h3 className="font-medium">Available Authors ({filteredAvailable.length})</h3>
              </div>
              <ScrollArea className="h-[400px] rounded-lg border bg-white">
                <div className="p-2 space-y-2">
                  {filteredAvailable.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">
                      {authorSearch ? 'No authors match your search' : 'All authors are featured'}
                    </div>
                  ) : (
                    filteredAvailable.map((author) => (
                      <div key={author.author_id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                            <Users className="h-4 w-4 text-gray-500" />
                          </div>
                          <div>
                            <div className="font-medium">{author.author_name}</div>
                            <div className="text-xs text-gray-500">{author.template_count} templates</div>
                          </div>
                        </div>
                        <Button size="sm" onClick={() => toggleFeaturedAuthor(author, true)}>
                          Feature
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
