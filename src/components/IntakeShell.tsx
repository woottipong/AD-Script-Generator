import type { DragEvent, ReactNode } from 'react';
import { FileText, Play, Sparkles, X } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { Button } from '@/components/ui/button';

/**
 * The frame every step before the workspace shares (Generate and Review intake): a centered
 * studio Card with the step heading, optional 2-column mode switcher header, and description strip.
 */
export function IntakeShell({ title, description, modeSwitch, children }: {
  backLabel?: string;
  onBack?: () => void;
  title: string;
  description: string;
  modeSwitch?: { mode: JobMode; onModeChange: (next: JobMode) => void };
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground leading-tight">{title}</h1>

      {modeSwitch ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-2 gap-1.5 border-b border-border bg-muted/70 p-1.5">
            <button
              type="button"
              aria-pressed={modeSwitch.mode === 'generate'}
              onClick={() => modeSwitch.onModeChange('generate')}
              className={`flex h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg px-4 text-sm sm:text-base transition-all ${
                modeSwitch.mode === 'generate'
                  ? 'bg-card font-semibold text-brand-950 shadow-xs ring-1 ring-brand-200'
                  : 'font-medium text-muted-foreground hover:bg-card/60 hover:text-foreground'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${
                  modeSwitch.mode === 'generate'
                    ? 'bg-brand-700 text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <Sparkles className="size-4" />
              </span>
              สร้างบทบรรยาย
            </button>
            <button
              type="button"
              aria-pressed={modeSwitch.mode === 'review'}
              onClick={() => modeSwitch.onModeChange('review')}
              className={`flex h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg px-4 text-sm sm:text-base transition-all ${
                modeSwitch.mode === 'review'
                  ? 'bg-card font-semibold text-brand-950 shadow-xs ring-1 ring-brand-200'
                  : 'font-medium text-muted-foreground hover:bg-card/60 hover:text-foreground'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md ${
                  modeSwitch.mode === 'review'
                    ? 'bg-brand-700 text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <FileText className="size-4" />
              </span>
              ตรวจแก้ไฟล์ SRT
            </button>
          </div>
          <div className="border-b border-border/80 bg-brand-50/45 px-5 py-3 sm:px-7">
            <p className="text-sm leading-relaxed text-brand-950">{description}</p>
          </div>
          <div className="p-5 sm:p-7">{children}</div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-base text-muted-foreground leading-relaxed">{description}</p>
          <div className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-7">{children}</div>
        </>
      )}
    </section>
  );
}

/**
 * Shared dropzone row used by both Generate and Review intake modes so file selection
 * keeps an identical shape, height, and control rhythm across mode switches.
 */
export function IntakeDropzone({
  file,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
  onClear,
  icon,
  emptyTitle,
  emptySubtitle,
  fileSubtitle,
  pickLabel,
  replaceLabel = 'เปลี่ยนไฟล์',
  clearLabel,
  pickDescribedBy,
}: {
  file: File | null;
  isDragging: boolean;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPick: () => void;
  onClear: () => void;
  icon: ReactNode;
  emptyTitle: string;
  emptySubtitle: string;
  fileSubtitle: string;
  pickLabel: string;
  replaceLabel?: string;
  clearLabel: string;
  pickDescribedBy?: string;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`min-h-20 rounded-lg border-2 transition-colors flex items-center justify-between gap-3 px-4 py-3.5 ${
        isDragging
          ? 'border-dashed border-brand-500 bg-brand-50'
          : file
          ? 'border-solid border-brand-200 bg-brand-50/40'
          : 'border-dashed border-input bg-canvas/60 hover:border-brand-300 hover:bg-brand-50/25'
      }`}
    >
      <div
        onClick={onPick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <span className="block text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
            {file ? file.name : emptyTitle}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {file ? fileSubtitle : emptySubtitle}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onPick}
          aria-describedby={pickDescribedBy}
        >
          {file ? replaceLabel : pickLabel}
        </Button>
        {file && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={clearLabel}
            onClick={onClear}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Shared single-line intake footer bar placing a concise processing note on the left
 * and the cancel + primary cerulean action buttons on the right.
 */
export function IntakeFooter({ note, actionLabel, cancelLabel = 'ยกเลิก', disabled, onCancel, onAction }: {
  note: string;
  actionLabel: string;
  cancelLabel?: string;
  disabled: boolean;
  onCancel?: () => void;
  onAction: () => void;
}) {
  return (
    <div className="-mx-5 -mb-5 mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/35 px-5 py-4 sm:-mx-7 sm:-mb-7 sm:flex-nowrap sm:px-7">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {onCancel && (
          <Button type="button" variant="outline" size="lg" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="button" size="lg" disabled={disabled} onClick={onAction}>
          <Play data-icon="inline-start" aria-hidden="true" />
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
