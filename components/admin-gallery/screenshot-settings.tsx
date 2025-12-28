'use client';

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

function SliderRow({
  label,
  value,
  unit,
  sliderValue,
  onValueChange,
  min,
  max,
  step,
  disabled,
}: {
  label: string;
  value: string | number;
  unit?: string;
  sliderValue: number[];
  onValueChange: (value: number[]) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
}) {
  return (
    <div className="group/row space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground group-hover/row:text-foreground transition-colors">
          {label}
        </span>
        <span className="tabular-nums text-xs font-semibold text-foreground min-w-[4rem] text-right">
          {value}{unit}
        </span>
      </div>
      <Slider
        value={sliderValue}
        onValueChange={onValueChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
      />
    </div>
  );
}

function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/30 p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

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
    <div className="space-y-4">
      {/* Timing Section */}
      <SettingsSection title="Timing">
        <SliderRow
          label="Navigation timeout"
          value={(value.timeout / 1000).toFixed(0)}
          unit="s"
          sliderValue={[value.timeout]}
          onValueChange={([v]) => onChange({ timeout: v })}
          min={10_000}
          max={120_000}
          step={5_000}
          disabled={disabled}
        />
        <SliderRow
          label="Animation wait"
          value={(value.screenshotAnimationWaitMs / 1000).toFixed(1)}
          unit="s"
          sliderValue={[value.screenshotAnimationWaitMs]}
          onValueChange={([v]) => onChange({ screenshotAnimationWaitMs: v })}
          min={500}
          max={10_000}
          step={250}
          disabled={disabled}
        />
      </SettingsSection>

      {/* Scroll Behavior Section */}
      <SettingsSection title="Scroll Behavior">
        <SliderRow
          label="Nudge scroll amount"
          value={Math.round(value.screenshotNudgeScrollRatio * 100)}
          unit="%"
          sliderValue={[value.screenshotNudgeScrollRatio]}
          onValueChange={([v]) => onChange({ screenshotNudgeScrollRatio: v })}
          min={0}
          max={0.5}
          step={0.05}
          disabled={disabled}
        />
        <div className="grid grid-cols-2 gap-4">
          <SliderRow
            label="Wait after nudge"
            value={value.screenshotNudgeWaitMs}
            unit="ms"
            sliderValue={[value.screenshotNudgeWaitMs]}
            onValueChange={([v]) => onChange({ screenshotNudgeWaitMs: v })}
            min={0}
            max={3000}
            step={100}
            disabled={disabled}
          />
          <SliderRow
            label="Wait after return"
            value={value.screenshotNudgeAfterMs}
            unit="ms"
            sliderValue={[value.screenshotNudgeAfterMs]}
            onValueChange={([v]) => onChange({ screenshotNudgeAfterMs: v })}
            min={0}
            max={3000}
            step={100}
            disabled={disabled}
          />
        </div>
      </SettingsSection>

      {/* Stability Section */}
      <SettingsSection title="Stability Detection">
        <SliderRow
          label="Stable window"
          value={value.screenshotStabilityStableMs}
          unit="ms"
          sliderValue={[value.screenshotStabilityStableMs]}
          onValueChange={([v]) => onChange({ screenshotStabilityStableMs: v })}
          min={250}
          max={5000}
          step={250}
          disabled={disabled}
        />
        <div className="grid grid-cols-2 gap-4">
          <SliderRow
            label="Max wait"
            value={(value.screenshotStabilityMaxWaitMs / 1000).toFixed(1)}
            unit="s"
            sliderValue={[value.screenshotStabilityMaxWaitMs]}
            onValueChange={([v]) => onChange({ screenshotStabilityMaxWaitMs: v })}
            min={1000}
            max={20_000}
            step={500}
            disabled={disabled}
          />
          <SliderRow
            label="Check interval"
            value={value.screenshotStabilityCheckIntervalMs}
            unit="ms"
            sliderValue={[value.screenshotStabilityCheckIntervalMs]}
            onValueChange={([v]) => onChange({ screenshotStabilityCheckIntervalMs: v })}
            min={100}
            max={1000}
            step={50}
            disabled={disabled}
          />
        </div>
      </SettingsSection>

      {/* Quality Section */}
      <SettingsSection title="Output Quality">
        <div className="grid grid-cols-2 gap-4">
          <SliderRow
            label="JPEG quality"
            value={value.screenshotJpegQuality}
            unit="%"
            sliderValue={[value.screenshotJpegQuality]}
            onValueChange={([v]) => onChange({ screenshotJpegQuality: v })}
            min={50}
            max={95}
            step={5}
            disabled={disabled}
          />
          <SliderRow
            label="WebP quality"
            value={value.screenshotWebpQuality}
            unit="%"
            sliderValue={[value.screenshotWebpQuality]}
            onValueChange={([v]) => onChange({ screenshotWebpQuality: v })}
            min={40}
            max={95}
            step={5}
            disabled={disabled}
          />
        </div>
      </SettingsSection>
    </div>
  );
}

