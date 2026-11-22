import { useRef, type DragEvent, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, FileText, FileVideo, X } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';

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
export type GenerateDraft = { file: File | null; title: string | null };
export type ReviewDraft = {
  video: File | null;
  srt: File | null;
  link: string;
  linkProbe: { url: string; fileName: string; sizeBytes: number } | null;
  srtLink: string;
  srtLinkResult: { url: string; file: File; cueCount: number } | null;
  title: string | null;
};

export type IntakeControls = {
  canProcess: boolean;
  onInputChange: () => void;
  onCancelCheck: () => void;
  modeSwitch: {
    mode: JobMode;
    checking: boolean;
    switching?: boolean;
    onModeChange: (mode: JobMode) => void;
    activeButtonRef: (button: HTMLButtonElement | null) => void;
  };
};

export function focusIntakeFeedback(element: HTMLElement | null) {
  element?.focus();
}

export function selectIntakeFile(files: FileList | null, accepts: (file: File) => boolean, invalidMessage: string) {
  if (!files?.length) return null;
  if (files.length > 1) return { kind: 'invalid', message: 'เลือกหรือวางได้ครั้งละหนึ่งไฟล์' } as const;
  const file = files[0];
  return accepts(file) ? { kind: 'file', file } as const : { kind: 'invalid', message: invalidMessage } as const;
}

export function IntakeShell({ title, description, modeSwitch, children }: {
  title: string;
  description: string;
  modeSwitch: IntakeControls['modeSwitch'];
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

      <div className="@container overflow-hidden rounded-xl border border-border bg-card">
        <div
          role="group"
          aria-label="เลือกโหมดการทำงาน"
          aria-busy={modeSwitch.switching || undefined}
          className="grid grid-cols-1 border-b border-border bg-card @min-[17rem]:grid-cols-2"
        >
          {INTAKE_MODES.map(({ mode, label, Icon }) => {
            const active = modeSwitch.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                ref={active ? modeSwitch.activeButtonRef : undefined}
                aria-pressed={active}
                aria-disabled={modeSwitch.checking || undefined}
                onClick={() => { if (!modeSwitch.checking) modeSwitch.onModeChange(mode); }}
                className={`-mb-px flex min-w-0 min-h-12 cursor-pointer items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm leading-snug [overflow-wrap:anywhere] transition-colors focus-visible:-outline-offset-2 aria-disabled:cursor-wait sm:px-5 sm:text-base ${
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
  fileSubtitle: string;
  pickLabel: string;
  replaceLabel?: string;
  clearLabel: string;
  pickDescribedBy?: string;
}) {
  const pickButton = useRef<HTMLButtonElement>(null);
  const subtitle = file ? fileSubtitle : undefined;

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
      className={`relative flex min-h-20 cursor-pointer flex-col items-stretch justify-between gap-3 rounded-lg px-4 py-3.5 transition-colors outline-1 -outline-offset-1 @min-[19rem]:flex-row @min-[19rem]:items-center ${
        isDragging
          ? 'bg-brand-100/70 outline-dashed outline-brand-600'
          : file
          ? 'bg-success-surface/65 outline-solid outline-success-border'
          : 'bg-background outline-dashed outline-brand-300 hover:bg-brand-50/60 hover:outline-brand-500'
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3 @min-[17rem]:flex-row @min-[17rem]:items-center">
        <span
          aria-hidden="true"
          className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${
            file ? 'bg-success-accent/12 text-success-foreground' : 'bg-brand-100 text-brand-700'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {file && <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success-accent" />}
            <span className="block truncate text-sm font-semibold text-foreground" title={file ? file.name : undefined}>
              {file ? file.name : emptyTitle}
            </span>
          </div>
          {subtitle && (
            <span className={`mt-0.5 block text-xs tabular-nums ${file ? 'text-success-foreground/90' : 'text-muted-foreground'}`}>
              {subtitle}
            </span>
          )}
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          type="button"
          ref={pickButton}
          variant={file ? 'outline-success' : 'outline-primary'}
          size="sm"
          onClick={onPick}
          aria-describedby={pickDescribedBy}
          className={`h-auto min-h-8 max-w-full whitespace-normal py-1.5 [overflow-wrap:anywhere] pointer-coarse:min-h-11 ${
            file ? 'text-xs' : 'border-brand-200 text-brand-800'
          }`}
        >
          {file ? replaceLabel : pickLabel}
        </Button>
        {file && (
          <Button
            type="button"
            variant="ghost-success"
            size="icon-sm"
            aria-label={clearLabel}
            onClick={() => { onClear(); pickButton.current?.focus(); }}
            className="pointer-coarse:size-11"
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Shared optional Job Title field used by both Generate and Review intake modes.
 */
export function IntakeTitleField({ id, value, isAutoTitle, onChange }: {
  id: string;
  value: string;
  isAutoTitle: boolean;
  onChange: (title: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id} className="gap-1.5">
        <span>ชื่องาน</span>
        <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
      </FieldLabel>
      <InputGroup className="bg-background">
        <InputGroupInput
          id={id}
          type="text"
          value={value}
          maxLength={120}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ใช้ชื่อไฟล์วิดีโอเมื่อเว้นว่าง"
        />
        {value.trim() !== '' && (
          <InputGroupAddon align="inline-end">
            <CheckCircle2 aria-hidden="true" className="size-4 text-success-accent" />
          </InputGroupAddon>
        )}
      </InputGroup>
      {isAutoTitle && (
        <FieldDescription className="text-xs">
          ตั้งชื่ออัตโนมัติจากไฟล์วิดีโอ แก้ไขได้
        </FieldDescription>
      )}
    </Field>
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
    <div className="-mx-5 -mb-5 mt-2 flex flex-wrap items-center justify-end gap-2.5 border-t border-border bg-muted/35 px-5 py-4 sm:-mx-7 sm:-mb-7 sm:px-7">
      {onCancel && (
        <Button type="button" variant="outline" size="lg" onClick={onCancel} className="h-auto min-h-10 max-w-full whitespace-normal py-2 [overflow-wrap:anywhere] pointer-coarse:min-h-11">
          {cancelLabel}
        </Button>
      )}
      <Button type="button" size="lg" disabled={disabled} onClick={onAction} className="h-auto min-h-10 max-w-full flex-1 justify-center whitespace-normal py-2 text-start [overflow-wrap:anywhere] sm:flex-initial pointer-coarse:min-h-11">
        {actionLabel}
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </div>
  );
}

export function IntakeSkeleton() {
  return (
    <section
      aria-label="กำลังโหลดหน้าสร้างงาน"
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-10"
    >
      <span role="status" className="sr-only">กำลังโหลดหน้าสร้างงาน…</span>

      <div aria-hidden="true" className="flex flex-col gap-1.5">
        <Skeleton variant="shimmer" delay={0} className="h-7 w-52 max-w-full rounded-md bg-muted" />
        <Skeleton variant="shimmer" delay={60} className="h-4 w-72 max-w-full rounded bg-muted/80" />
      </div>

      <div aria-hidden="true" className="@container overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-1 border-b border-border bg-card @min-[17rem]:grid-cols-2">
          <div className="-mb-px flex min-h-12 items-center justify-center border-b-2 border-primary/40 px-3 py-3 sm:px-5">
            <Skeleton variant="shimmer" delay={100} className="h-5 w-32 rounded bg-muted" />
          </div>
          <div className="-mb-px flex min-h-12 items-center justify-center border-b-2 border-transparent px-3 py-3 sm:px-5">
            <Skeleton variant="shimmer" delay={160} className="h-5 w-32 rounded bg-muted/80" />
          </div>
        </div>

        <div className="flex flex-col gap-5 p-5 sm:p-7">
          <div className="flex h-20 w-full items-center justify-between gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Skeleton variant="shimmer" delay={180} className="size-10 shrink-0 rounded-lg bg-brand-100/70" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton variant="shimmer" delay={220} className="h-4 w-36 max-w-full rounded bg-muted" />
                <Skeleton variant="shimmer" delay={260} className="h-3 w-24 max-w-full rounded bg-muted/70" />
              </div>
            </div>
            <Skeleton variant="shimmer" delay={300} className="h-8 w-24 shrink-0 rounded-md bg-muted" />
          </div>

          <div className="flex flex-col gap-2">
            <Skeleton variant="shimmer" delay={280} className="h-4 w-16 rounded bg-muted" />
            <Skeleton variant="shimmer" delay={340} className="h-9 w-full rounded-lg bg-muted/70" />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-border bg-muted/35 px-5 py-4 sm:px-7">
          <Skeleton variant="shimmer" delay={440} className="h-10 w-20 rounded-lg bg-muted/80" />
          <Skeleton variant="shimmer" delay={480} className="h-10 w-44 rounded-lg bg-brand-100/70" />
        </div>
      </div>
    </section>
  );
}
