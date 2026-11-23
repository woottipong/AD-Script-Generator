import { Skeleton } from '@/components/ui/skeleton';

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
