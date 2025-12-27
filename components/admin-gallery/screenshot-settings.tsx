'use client';

import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import type { FreshScraperConfig } from '@/lib/scraper/fresh-scraper';

export type ScreenshotSettings = Pick<
  FreshScraperConfig,
  | 'timeout'
  | 'screenshotAnimationWaitMs'
  | 'screenshotNudgeScrollRatio'
  | 'screenshotNudgeWaitMs'
  | 'screenshotNudgeAfterMs'
  | 'screenshotStabilityStableMs'
  | 'screenshotStabilityMaxWaitMs'
  | 'screenshotStabilityCheckIntervalMs'
  | 'screenshotJpegQuality'
  | 'screenshotWebpQuality'
>;

export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  timeout: 60_000,
  screenshotAnimationWaitMs: 3000,
  screenshotNudgeScrollRatio: 0.2,
  screenshotNudgeWaitMs: 500,
  screenshotNudgeAfterMs: 500,
  screenshotStabilityStableMs: 1000,
  screenshotStabilityMaxWaitMs: 7000,
  screenshotStabilityCheckIntervalMs: 250,
  screenshotJpegQuality: 80,
  screenshotWebpQuality: 75,
};

export function ScreenshotSettingsPanel({
  value,
  onChange,
  disabled,
}: {
  value: ScreenshotSettings;
  onChange: (next: Partial<ScreenshotSettings>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Navigation timeout</span>
          <Badge variant="secondary">{value.timeout}ms</Badge>
        </div>
        <Slider
          value={[value.timeout]}
          onValueChange={([v]) => onChange({ timeout: v })}
          min={10_000}
          max={120_000}
          step={5_000}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Base animation wait</span>
          <Badge variant="secondary">{value.screenshotAnimationWaitMs}ms</Badge>
        </div>
        <Slider
          value={[value.screenshotAnimationWaitMs]}
          onValueChange={([v]) => onChange({ screenshotAnimationWaitMs: v })}
          min={500}
          max={10_000}
          step={250}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Nudge scroll amount</span>
          <Badge variant="secondary">{Math.round(value.screenshotNudgeScrollRatio * 100)}%</Badge>
        </div>
        <Slider
          value={[value.screenshotNudgeScrollRatio]}
          onValueChange={([v]) => onChange({ screenshotNudgeScrollRatio: v })}
          min={0}
          max={0.5}
          step={0.05}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Wait after nudge</span>
            <Badge variant="secondary">{value.screenshotNudgeWaitMs}ms</Badge>
          </div>
          <Slider
            value={[value.screenshotNudgeWaitMs]}
            onValueChange={([v]) => onChange({ screenshotNudgeWaitMs: v })}
            min={0}
            max={3000}
            step={100}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Wait after return</span>
            <Badge variant="secondary">{value.screenshotNudgeAfterMs}ms</Badge>
          </div>
          <Slider
            value={[value.screenshotNudgeAfterMs]}
            onValueChange={([v]) => onChange({ screenshotNudgeAfterMs: v })}
            min={0}
            max={3000}
            step={100}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="text-sm font-semibold">Stability</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Stable window</span>
            <Badge variant="secondary">{value.screenshotStabilityStableMs}ms</Badge>
          </div>
          <Slider
            value={[value.screenshotStabilityStableMs]}
            onValueChange={([v]) => onChange({ screenshotStabilityStableMs: v })}
            min={250}
            max={5000}
            step={250}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Max wait</span>
            <Badge variant="secondary">{value.screenshotStabilityMaxWaitMs}ms</Badge>
          </div>
          <Slider
            value={[value.screenshotStabilityMaxWaitMs]}
            onValueChange={([v]) => onChange({ screenshotStabilityMaxWaitMs: v })}
            min={1000}
            max={20_000}
            step={500}
            disabled={disabled}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Check interval</span>
            <Badge variant="secondary">{value.screenshotStabilityCheckIntervalMs}ms</Badge>
          </div>
          <Slider
            value={[value.screenshotStabilityCheckIntervalMs]}
            onValueChange={([v]) => onChange({ screenshotStabilityCheckIntervalMs: v })}
            min={100}
            max={1000}
            step={50}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border p-3">
        <div className="text-sm font-semibold">Quality</div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Capture JPEG quality</span>
            <Badge variant="secondary">{value.screenshotJpegQuality}</Badge>
          </div>
          <Slider
            value={[value.screenshotJpegQuality]}
            onValueChange={([v]) => onChange({ screenshotJpegQuality: v })}
            min={50}
            max={95}
            step={5}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Saved WebP quality</span>
            <Badge variant="secondary">{value.screenshotWebpQuality}</Badge>
          </div>
          <Slider
            value={[value.screenshotWebpQuality]}
            onValueChange={([v]) => onChange({ screenshotWebpQuality: v })}
            min={40}
            max={95}
            step={5}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

