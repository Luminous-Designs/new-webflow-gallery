/* eslint-disable @typescript-eslint/no-unused-vars, @next/next/no-img-element */
'use client';

import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdmin } from '../admin-context';
import { toast } from 'sonner';
import {
  Loader2,
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  Filter,
  Eye,
  ToggleLeft,
  ToggleRight,
  Clock,
  Pencil,
  Camera
} from 'lucide-react';

interface ScreenshotExclusion {
  id: number;
  selector: string;
  selector_type: 'class' | 'id' | 'selector';
  description?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface ScreenshotTestResult {
  success: boolean;
  screenshotBase64?: string;
  thumbnailBase64?: string;
  dimensions?: { width: number; height: number };
  timings?: { total: number; navigation: number; preparation: number; capture: number; processing: number };
  exclusionsApplied?: string[];
  error?: string;
}

export function ScreenshotsSection() {
  const { resolveAuthToken } = useAdmin();

  // Screenshot Exclusions state
  const [screenshotExclusions, setScreenshotExclusions] = useState<ScreenshotExclusion[]>([]);
  const [isLoadingExclusions, setIsLoadingExclusions] = useState(false);
  const [newExclusionSelector, setNewExclusionSelector] = useState('');
  const [newExclusionType, setNewExclusionType] = useState<'class' | 'id' | 'selector'>('class');
  const [newExclusionDescription, setNewExclusionDescription] = useState('');
  const [isAddingExclusion, setIsAddingExclusion] = useState(false);
  const [editingExclusionId, setEditingExclusionId] = useState<number | null>(null);
  const [editingExclusionDesc, setEditingExclusionDesc] = useState('');

  // Screenshot Test state
  const [screenshotTestUrl, setScreenshotTestUrl] = useState('');
  const [screenshotTestUseExclusions, setScreenshotTestUseExclusions] = useState(true);
  const [isTestingScreenshot, setIsTestingScreenshot] = useState(false);
  const [screenshotTestResult, setScreenshotTestResult] = useState<ScreenshotTestResult | null>(null);

  // Load exclusions on mount
  const loadScreenshotExclusions = useCallback(async () => {
    try {
      setIsLoadingExclusions(true);
      const response = await fetch('/api/admin/screenshot-exclusions', {
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });
      if (response.ok) {
        const data = await response.json();
        setScreenshotExclusions(data.exclusions || []);
      }
    } catch (error) {
      console.error('Failed to load screenshot exclusions:', error);
    } finally {
      setIsLoadingExclusions(false);
    }
  }, [resolveAuthToken]);

  // Add exclusion
  const addScreenshotExclusion = useCallback(async () => {
    if (!newExclusionSelector.trim()) {
      toast.error('Please enter a selector');
      return;
    }

    try {
      setIsAddingExclusion(true);
      const response = await fetch('/api/admin/screenshot-exclusions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: JSON.stringify({
          selector: newExclusionSelector.trim(),
          selector_type: newExclusionType,
          description: newExclusionDescription.trim() || undefined
        })
      });

      if (response.ok) {
        const data = await response.json();
        setScreenshotExclusions(prev => [data.exclusion, ...prev]);
        setNewExclusionSelector('');
        setNewExclusionDescription('');
        toast.success('Exclusion added');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to add exclusion');
      }
    } catch (error) {
      toast.error('Failed to add exclusion');
    } finally {
      setIsAddingExclusion(false);
    }
  }, [resolveAuthToken, newExclusionSelector, newExclusionType, newExclusionDescription]);

  // Toggle exclusion
  const toggleScreenshotExclusion = useCallback(async (id: number, currentActive: boolean) => {
    try {
      const response = await fetch('/api/admin/screenshot-exclusions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: JSON.stringify({ id, is_active: !currentActive })
      });

      if (response.ok) {
        setScreenshotExclusions(prev => prev.map(exc => exc.id === id ? { ...exc, is_active: !currentActive } : exc));
        toast.success(currentActive ? 'Exclusion disabled' : 'Exclusion enabled');
      } else {
        toast.error('Failed to toggle exclusion');
      }
    } catch (error) {
      toast.error('Failed to toggle exclusion');
    }
  }, [resolveAuthToken]);

  // Update description
  const updateExclusionDescription = useCallback(async (id: number, description: string) => {
    try {
      const response = await fetch('/api/admin/screenshot-exclusions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: JSON.stringify({ id, description })
      });

      if (response.ok) {
        setScreenshotExclusions(prev => prev.map(exc => exc.id === id ? { ...exc, description } : exc));
        setEditingExclusionId(null);
        toast.success('Description updated');
      } else {
        toast.error('Failed to update description');
      }
    } catch (error) {
      toast.error('Failed to update description');
    }
  }, [resolveAuthToken]);

  // Delete exclusion
  const deleteScreenshotExclusion = useCallback(async (id: number) => {
    try {
      const response = await fetch(`/api/admin/screenshot-exclusions?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${resolveAuthToken()}` }
      });

      if (response.ok) {
        setScreenshotExclusions(prev => prev.filter(exc => exc.id !== id));
        toast.success('Exclusion deleted');
      } else {
        toast.error('Failed to delete exclusion');
      }
    } catch (error) {
      toast.error('Failed to delete exclusion');
    }
  }, [resolveAuthToken]);

  // Run screenshot test
  const runScreenshotTest = useCallback(async () => {
    if (!screenshotTestUrl.trim()) {
      toast.error('Please enter a URL to test');
      return;
    }

    try {
      setIsTestingScreenshot(true);
      setScreenshotTestResult(null);

      const response = await fetch('/api/admin/screenshot-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveAuthToken()}` },
        body: JSON.stringify({ url: screenshotTestUrl.trim(), useExclusions: screenshotTestUseExclusions })
      });

      const result = await response.json();
      setScreenshotTestResult(result);

      if (result.success) {
        toast.success(`Screenshot captured in ${(result.timings?.total / 1000).toFixed(1)}s`);
      } else {
        toast.error(result.error || 'Screenshot test failed');
      }
    } catch (error) {
      setScreenshotTestResult({ success: false, error: error instanceof Error ? error.message : 'Screenshot test failed' });
      toast.error('Screenshot test failed');
    } finally {
      setIsTestingScreenshot(false);
    }
  }, [resolveAuthToken, screenshotTestUrl, screenshotTestUseExclusions]);

  // Load exclusions on mount
  useState(() => {
    loadScreenshotExclusions();
  });

  const activeExclusionsCount = useMemo(() => screenshotExclusions.filter(e => e.is_active).length, [screenshotExclusions]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Element Exclusions Card */}
      <Card className="p-6 border-2 border-purple-100 bg-gradient-to-br from-purple-50/30 to-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Filter className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Element Exclusions</h2>
            <p className="text-sm text-gray-500">Remove elements from screenshots (fixed banners, popups, etc.)</p>
          </div>
        </div>

        {/* Add New Exclusion */}
        <div className="p-4 bg-white border rounded-lg mb-4">
          <h3 className="font-medium mb-3 text-sm text-gray-700">Add New Exclusion</h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select value={newExclusionType} onValueChange={(v: 'class' | 'id' | 'selector') => setNewExclusionType(v)}>
                <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="class">Class</SelectItem>
                  <SelectItem value="id">ID</SelectItem>
                  <SelectItem value="selector">Selector</SelectItem>
                </SelectContent>
              </Select>
              <Input
                placeholder={newExclusionType === 'class' ? 'banner-popup' : newExclusionType === 'id' ? 'cookie-notice' : '[data-popup]'}
                value={newExclusionSelector}
                onChange={(e) => setNewExclusionSelector(e.target.value)}
                className="flex-1"
              />
            </div>
            <Input placeholder="Description (optional)" value={newExclusionDescription} onChange={(e) => setNewExclusionDescription(e.target.value)} />
            <Button onClick={addScreenshotExclusion} disabled={isAddingExclusion || !newExclusionSelector.trim()} className="w-full">
              {isAddingExclusion ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Add Exclusion
            </Button>
          </div>
        </div>

        {/* Exclusions List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-sm text-gray-700">Active Exclusions</h3>
            <Button variant="ghost" size="sm" onClick={loadScreenshotExclusions} disabled={isLoadingExclusions}>
              {isLoadingExclusions ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-xs">Refresh</span>}
            </Button>
          </div>

          <ScrollArea className="h-[300px] rounded-lg border bg-white">
            {screenshotExclusions.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">No exclusions configured yet.</div>
            ) : (
              <div className="p-2 space-y-2">
                {screenshotExclusions.map((exclusion) => (
                  <div key={exclusion.id} className={`p-3 rounded-lg border ${exclusion.is_active ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${
                            exclusion.selector_type === 'class' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            exclusion.selector_type === 'id' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            'bg-gray-50 text-gray-700 border-gray-200'
                          }`}>
                            {exclusion.selector_type}
                          </Badge>
                          <code className="text-sm font-mono truncate">{exclusion.selector}</code>
                        </div>
                        {editingExclusionId === exclusion.id ? (
                          <div className="flex gap-2 mt-2">
                            <Input value={editingExclusionDesc} onChange={(e) => setEditingExclusionDesc(e.target.value)}
                              placeholder="Enter description" className="text-xs h-7" />
                            <Button size="sm" variant="outline" className="h-7 px-2"
                              onClick={() => updateExclusionDescription(exclusion.id, editingExclusionDesc)}>Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingExclusionId(null)}>Cancel</Button>
                          </div>
                        ) : exclusion.description ? (
                          <p className="text-xs text-gray-500 mt-1 cursor-pointer hover:text-gray-700"
                            onClick={() => { setEditingExclusionId(exclusion.id); setEditingExclusionDesc(exclusion.description || ''); }}>
                            {exclusion.description}
                          </p>
                        ) : (
                          <button className="text-xs text-gray-400 mt-1 hover:text-gray-600 flex items-center gap-1"
                            onClick={() => { setEditingExclusionId(exclusion.id); setEditingExclusionDesc(''); }}>
                            <Pencil className="h-3 w-3" />Add description
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                          onClick={() => toggleScreenshotExclusion(exclusion.id, exclusion.is_active)}
                          title={exclusion.is_active ? 'Disable' : 'Enable'}>
                          {exclusion.is_active ? <ToggleRight className="h-4 w-4 text-green-600" /> : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => { if (confirm('Delete this exclusion?')) deleteScreenshotExclusion(exclusion.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          <div className="text-xs text-gray-500 mt-2 p-2 bg-gray-50 rounded">
            <strong>Tip:</strong> Use class names like <code className="bg-gray-200 px-1 rounded">cookie-banner</code> or IDs like <code className="bg-gray-200 px-1 rounded">popup-overlay</code>
          </div>
        </div>
      </Card>

      {/* Screenshot Test Card */}
      <Card className="p-6 border-2 border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <Camera className="h-6 w-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Screenshot Test</h2>
            <p className="text-sm text-gray-500">Test the screenshot engine with any template URL</p>
          </div>
        </div>

        {/* Test Configuration */}
        <div className="p-4 bg-white border rounded-lg mb-4">
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Template Preview URL</label>
              <Input placeholder="https://template-name.webflow.io" value={screenshotTestUrl}
                onChange={(e) => setScreenshotTestUrl(e.target.value)} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="useExclusions" checked={screenshotTestUseExclusions}
                  onChange={(e) => setScreenshotTestUseExclusions(e.target.checked)} className="rounded border-gray-300" />
                <label htmlFor="useExclusions" className="text-sm text-gray-600">Apply element exclusions</label>
              </div>
              <Badge variant="outline" className="text-xs">{activeExclusionsCount} active</Badge>
            </div>

            <Button onClick={runScreenshotTest} disabled={isTestingScreenshot || !screenshotTestUrl.trim()}
              className="w-full bg-emerald-600 hover:bg-emerald-700">
              {isTestingScreenshot ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Capturing...</> :
                <><Camera className="h-4 w-4 mr-2" />Test Screenshot</>}
            </Button>
          </div>
        </div>

        {/* Test Results */}
        {screenshotTestResult && (
          <div className="space-y-4">
            <div className={`p-3 rounded-lg border ${screenshotTestResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {screenshotTestResult.success ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <XCircle className="h-5 w-5 text-red-600" />}
                <span className={`font-medium ${screenshotTestResult.success ? 'text-green-700' : 'text-red-700'}`}>
                  {screenshotTestResult.success ? 'Screenshot Captured Successfully' : 'Screenshot Failed'}
                </span>
              </div>

              {screenshotTestResult.error && <p className="text-sm text-red-600">{screenshotTestResult.error}</p>}

              {screenshotTestResult.timings && (
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3 w-3 text-gray-400" />
                    <span className="text-gray-600">Total:</span>
                    <span className="font-medium">{(screenshotTestResult.timings.total / 1000).toFixed(1)}s</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">Navigation:</span>
                    <span className="font-medium">{(screenshotTestResult.timings.navigation / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              )}

              {screenshotTestResult.dimensions && (
                <div className="mt-2 text-xs text-gray-600">
                  Dimensions: {screenshotTestResult.dimensions.width} x {screenshotTestResult.dimensions.height}px
                </div>
              )}
            </div>

            {screenshotTestResult.success && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="text-sm font-medium mb-2 text-gray-700">Thumbnail Preview</h4>
                  <div className="border rounded-lg overflow-hidden bg-gray-100">
                    {screenshotTestResult.thumbnailBase64 && (
                      <img src={screenshotTestResult.thumbnailBase64} alt="Thumbnail preview" className="w-full h-auto" />
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium mb-2 text-gray-700">Full Screenshot</h4>
                  <div className="border rounded-lg overflow-hidden bg-gray-100 max-h-[300px] overflow-y-auto">
                    {screenshotTestResult.screenshotBase64 && (
                      <img src={screenshotTestResult.screenshotBase64} alt="Full screenshot preview" className="w-full h-auto" />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {!screenshotTestResult && !isTestingScreenshot && (
          <div className="text-center py-8 text-gray-500">
            <Eye className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p className="text-sm">Enter a template preview URL and click test to preview the screenshot</p>
          </div>
        )}
      </Card>
    </div>
  );
}
