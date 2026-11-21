import type { DragEvent, ReactNode } from 'react';
import { ArrowRight, FileText, FileVideo, X } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { Button } from '@/components/ui/button';

const INTAKE_MODES: ReadonlyArray<{
  mode: JobMode;
  label: string;
  Icon: typeof FileVideo;
}> = [
  { mode: 'generate', label: 'สร้างบทบรรยาย', Icon: FileVideo },
  { mode: 'review', label: 'ตรวจแก้ไฟล์ SRT', Icon: FileText },
];

/**
 * The frame every step before the workspace shares (Generate and Review intake): a page
 * header matching the Job List above a studio card with a 2-column mode switcher header.
 */
export function IntakeShell({ title, description, modeSwitch, children }: {
  title: string;
  description: string;
  modeSwitch: { mode: JobMode; onModeChange: (next: JobMode) => void };
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="intake-heading"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10"
    >
      <div className="flex flex-col gap-1">
        <h1 id="intake-heading" className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div
          role="group"
          aria-label="เลือกโหมดการทำงาน"
          className="grid grid-cols-2 border-b border-border bg-card"
        >
          {INTAKE_MODES.map(({ mode, label, Icon }) => {
            const active = modeSwitch.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                onClick={() => modeSwitch.onModeChange(mode)}
                className={`-mb-px flex min-h-12 cursor-pointer items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm leading-snug transition-colors focus-visible:-outline-offset-2 sm:px-5 sm:text-base ${
                  active
                    ? 'border-primary font-semibold text-brand-800'
                    : 'border-transparent font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                  aria-hidden="true"
                />
                {label}
              </button>
            );
          })}
        </div>
        <div className="p-5 sm:p-7">{children}</div>
      </div>
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
  emptySubtitle?: string;
  fileSubtitle: string;
  pickLabel: string;
  replaceLabel?: string;
  clearLabel: string;
  pickDescribedBy?: string;
}) {
  const subtitle = file ? fileSubtitle : emptySubtitle;

  return (
    <div
      onClick={(event) => {
        if (!(event.target instanceof Element && event.target.closest('button'))) {
          onPick();
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex min-h-20 cursor-pointer flex-col items-stretch justify-between gap-3 rounded-lg px-4 py-3.5 transition-colors outline-1 -outline-offset-1 sm:flex-row sm:items-center ${
        isDragging
          ? 'bg-brand-100/70 outline-dashed outline-brand-600'
          : file
          ? 'bg-brand-50 outline-solid outline-brand-400'
          : 'bg-brand-50/45 outline-dashed outline-brand-300 hover:bg-brand-50 hover:outline-brand-500'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <span
          aria-hidden="true"
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${
            file ? 'bg-primary text-primary-foreground' : 'bg-brand-100 text-brand-700'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <span className={`block text-sm font-semibold [overflow-wrap:anywhere] ${file ? 'text-brand-950' : 'text-foreground'}`}>
            {file ? file.name : emptyTitle}
          </span>
          {subtitle && (
            <span className={`block text-xs tabular-nums ${file ? 'text-brand-800' : 'text-muted-foreground'}`}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="outline-primary"
          size="sm"
          onClick={onPick}
          aria-describedby={pickDescribedBy}
          className="border-brand-200 text-brand-800"
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
            className="text-brand-800 hover:bg-brand-100 hover:text-brand-950"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Shared intake footer bar placing the cancel and primary cerulean action buttons on the right.
 */
export function IntakeFooter({ actionLabel, cancelLabel = 'ยกเลิก', disabled, onCancel, onAction }: {
  actionLabel: string;
  cancelLabel?: string;
  disabled: boolean;
  onCancel?: () => void;
  onAction: () => void;
}) {
  return (
    <div className="-mx-5 -mb-5 mt-2 flex items-center justify-end gap-2.5 border-t border-border bg-muted/35 px-5 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
      {onCancel && (
        <Button type="button" variant="outline" size="lg" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
      <Button type="button" size="lg" disabled={disabled} onClick={onAction}>
        {actionLabel}
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </div>
  );
}
