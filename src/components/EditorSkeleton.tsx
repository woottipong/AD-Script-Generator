import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

const WAVEFORM_BAR_HEIGHTS = [
  24, 38, 18, 44, 30, 52, 22, 40, 28, 48, 20, 34, 46, 26, 36, 50, 20, 42, 30, 44,
  24, 38, 48, 22, 34, 42, 26, 36, 20, 40, 28, 46,
];

const SPEECH_CAPSULES = [
  { left: '4%', width: '12%', delay: 0 },
  { left: '22%', width: '16%', delay: 120 },
  { left: '44%', width: '10%', delay: 240 },
  { left: '61%', width: '18%', delay: 360 },
  { left: '84%', width: '11%', delay: 480 },
];

const AD_BLOCKS = [
  { left: '16%', width: '7%', delay: 80 },
  { left: '38%', width: '7%', delay: 220 },
  { left: '79%', width: '6%', delay: 360 },
];

const COLLAPSED_SPOT_WIDTHS = [74, 58, 82, 52, 68, 86, 60];

export function EditorHeaderTitleSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-1 items-center gap-2 pl-2">
      <Skeleton variant="shimmer" delay={0} className="h-6 w-44 rounded-md bg-muted sm:w-60" />
      <Skeleton variant="shimmer" delay={120} className="h-7 w-24 shrink-0 rounded-md bg-muted/80" />
    </div>
  );
}

export function EditorHeaderActionsSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
      <Skeleton variant="shimmer" delay={0} className="h-10 w-36 rounded-lg bg-muted/80" />
      <Skeleton variant="shimmer" delay={120} className="h-10 w-28 rounded-lg bg-brand-100/70" />
      <Skeleton variant="shimmer" delay={240} className="size-10 rounded-lg bg-muted/70" />
    </div>
  );
}

export function EditorWorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-12">
      {/* Left 6 cols: Video Stage, Transport Bar, Timeline Toolbar & Tracks */}
      <div className="flex min-h-0 flex-col bg-card lg:col-span-6">
        <div className="relative flex min-h-56 flex-1 flex-col items-center justify-center bg-stage px-6 py-10 text-center text-stage-foreground/80 sm:min-h-72">
          <div role="status" className="flex flex-col items-center">
            <Spinner className="mx-auto mb-2.5 size-5 text-brand-400" aria-hidden="true" />
            <p className="text-xs font-medium text-stage-foreground/85">{label}</p>
            <div aria-hidden="true" className="relative mt-3 h-1 w-36 overflow-hidden rounded-full bg-stage-foreground/15">
              <div className="progress-indeterminate-primary absolute inset-0" />
              <div className="progress-indeterminate-secondary absolute inset-0" />
            </div>
          </div>
        </div>

        <div aria-hidden="true" className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-3 py-2">
          <div className="flex items-center gap-1">
            <Skeleton variant="shimmer" delay={0} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={60} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={120} className="size-8 rounded-lg bg-brand-100/70" />
            <Skeleton variant="shimmer" delay={180} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={240} className="size-8 rounded-md bg-muted/70" />
          </div>
          <Separator orientation="vertical" className="h-5 self-center" />
          <div className="flex items-center gap-1">
            <Skeleton variant="shimmer" delay={280} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={320} className="size-8 rounded-md bg-muted/70" />
          </div>
          <Separator orientation="vertical" className="hidden h-5 self-center sm:block" />
          <div className="flex items-center gap-1">
            <Skeleton variant="shimmer" delay={360} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={400} className="size-8 rounded-md bg-muted/70" />
            <Skeleton variant="shimmer" delay={440} className="size-8 rounded-md bg-muted/70" />
          </div>
          <Skeleton variant="shimmer" delay={480} className="ml-auto h-6 w-28 rounded-md bg-muted" />
        </div>

        <div aria-hidden="true" className="flex items-center justify-between border-y border-border bg-muted/40 px-3 py-1.5">
          <Skeleton variant="shimmer" delay={0} className="h-4 w-16 rounded bg-muted" />
          <div className="flex h-7 w-28 items-center justify-between rounded-lg border border-border/70 bg-background px-1">
            <Skeleton variant="shimmer" delay={100} className="size-5 rounded bg-muted/70" />
            <Skeleton variant="shimmer" delay={160} className="h-3.5 w-10 rounded bg-muted" />
            <Skeleton variant="shimmer" delay={220} className="size-5 rounded bg-muted/70" />
          </div>
        </div>

        <div aria-hidden="true" className="flex bg-card">
          <div className="w-20 shrink-0 border-r border-border bg-muted/40 text-xs sm:w-24">
            <div className="flex h-7 items-center border-b border-border px-3 font-medium text-muted-foreground">เวลา</div>
            <div className="flex h-14 items-center border-b border-border px-3 text-muted-foreground">คลื่นเสียง</div>
            <div className="flex h-7 items-center border-b border-border px-3 text-muted-foreground">เสียงพูด</div>
            <div className="flex h-14 items-center px-3 font-medium text-secondary-foreground">บรรยาย</div>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="relative flex h-7 items-end justify-between border-b border-border bg-surface-subtle px-3 pb-1">
              {[0, 1, 2, 3, 4].map((tick) => (
                <div key={tick} className="flex flex-col items-center gap-0.5">
                  <div className="h-1.5 w-px bg-input" />
                  <Skeleton variant="shimmer" delay={tick * 90} className="h-2.5 w-8 rounded bg-border/80" />
                </div>
              ))}
            </div>
            <div className="flex h-14 items-center justify-between gap-1 border-b border-border px-3">
              {WAVEFORM_BAR_HEIGHTS.map((pct, idx) => (
                <Skeleton
                  key={idx}
                  variant="shimmer"
                  delay={(idx % 8) * 70}
                  className="w-1 flex-1 rounded-full bg-border/80"
                  style={{ height: `${pct}%` }}
                />
              ))}
            </div>
            <div className="relative h-7 border-b border-border bg-surface-subtle/40">
              {SPEECH_CAPSULES.map((capsule, idx) => (
                <Skeleton
                  key={idx}
                  variant="shimmer"
                  delay={capsule.delay}
                  className="absolute top-1 bottom-1 rounded-[4px] bg-muted"
                  style={{ left: capsule.left, width: capsule.width }}
                />
              ))}
            </div>
            <div className="relative h-14 bg-surface-subtle/40">
              {AD_BLOCKS.map((block, idx) => (
                <Skeleton
                  key={idx}
                  variant="shimmer"
                  delay={block.delay}
                  className="absolute top-1.5 bottom-1.5 rounded-sm border border-brand-200/70 bg-brand-100/75"
                  style={{ left: block.left, width: block.width }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right 6 cols: Script Editor Pane */}
      <div
        aria-hidden="true"
        className="flex min-h-0 flex-col border-t border-border bg-card lg:col-span-6 lg:border-t-0 lg:border-l"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Skeleton variant="shimmer" delay={0} className="h-9 flex-1 rounded-lg bg-muted/70" />
          <Skeleton variant="shimmer" delay={120} className="h-9 w-36 shrink-0 rounded-lg bg-muted/70 sm:w-40" />
        </div>

        <div className="border-b border-border bg-brand-50/40 px-4 py-3.5">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton variant="shimmer" delay={0} className="h-4 w-14 rounded bg-brand-100/80" />
              <Skeleton variant="shimmer" delay={70} className="h-8 w-28 rounded-lg border border-border/70 bg-card" />
              <Skeleton variant="shimmer" delay={140} className="h-8 w-28 rounded-lg border border-border/70 bg-card" />
              <Skeleton variant="shimmer" delay={210} className="h-6 w-12 rounded bg-muted/80" />
            </div>
            <Skeleton variant="shimmer" delay={260} className="h-8 w-28 rounded-lg bg-muted/80" />
          </div>
          <div className="flex h-24 w-full flex-col gap-2.5 rounded-lg border border-border/70 bg-card p-3">
            <Skeleton variant="shimmer" delay={100} className="h-3.5 w-11/12 rounded bg-muted" />
            <Skeleton variant="shimmer" delay={180} className="h-3.5 w-4/5 rounded bg-muted" />
            <Skeleton variant="shimmer" delay={260} className="h-3.5 w-2/5 rounded bg-muted/70" />
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <Skeleton variant="shimmer" delay={160} className="h-full w-2/3 rounded-full bg-brand-100/80" />
            </div>
            <Skeleton variant="shimmer" delay={220} className="h-3 w-36 rounded bg-muted/80" />
          </div>
        </div>

        <div className="min-h-0 flex-1 divide-y divide-border overflow-hidden bg-card [mask-image:linear-gradient(to_bottom,black_80%,transparent_100%)]">
          {COLLAPSED_SPOT_WIDTHS.map((secondLineWidth, idx) => {
            const baseDelay = idx * 140;
            return (
              <div key={idx} className="px-4 py-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Skeleton variant="shimmer" delay={baseDelay} className="h-4 w-12 rounded bg-border/80" />
                    <Skeleton variant="shimmer" delay={baseDelay + 40} className="h-3.5 w-28 rounded bg-muted" />
                    <Skeleton variant="shimmer" delay={baseDelay + 80} className="h-4 w-10 rounded bg-muted" />
                  </div>
                  <Skeleton variant="shimmer" delay={baseDelay + 100} className="h-5 w-16 rounded-md bg-brand-100/60" />
                </div>
                <div className="flex w-full flex-col gap-2">
                  <Skeleton variant="shimmer" delay={baseDelay + 60} className="h-3.5 w-full rounded bg-muted" />
                  <Skeleton
                    variant="shimmer"
                    delay={baseDelay + 120}
                    className="h-3.5 rounded bg-muted/70"
                    style={{ width: `${secondLineWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Skeleton variant="shimmer" delay={0} className="h-4 w-24 rounded bg-muted" />
            <Skeleton variant="shimmer" delay={100} className="h-4 w-20 rounded bg-muted" />
          </div>
          <Skeleton variant="shimmer" delay={180} className="h-4 w-32 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
