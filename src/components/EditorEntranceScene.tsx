/**
 * Full-screen scene shown on every way into the editor (checked intake, `เปิดงาน`, a `/jobs/…` reload).
 * The brand mark (same geometry as public/logo.svg) performs the slogan: the viewfinder frames the
 * picture, the sound bars rise, the narration bar lights last, then the bars idle like a quiet meter.
 * Leaving takes two beats: `clearing` fades the mark and words off a plain stage, then the reveal
 * dissolves that stage off the finished editor (motion in index.css, timing in App.tsx).
 */
export function EditorEntranceScene({ title, status, clearing = false }: { title?: string | null; status: string; clearing?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-stage px-6 pb-[6vh] text-center">
      <div
        className={`flex max-w-full flex-col items-center transition-[opacity,transform] duration-200 ease-in motion-reduce:transition-none ${
          clearing ? 'scale-[0.97] opacity-0' : ''
        }`}
      >
        <svg viewBox="0 0 64 64" aria-hidden="true" className="entrance-mark size-20 sm:size-22">
          <rect width="64" height="64" rx="16" fill="#0369a1" />
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
            <path className="entrance-frame" stroke="#fff" d="M13 22v-5a4 4 0 0 1 4-4h5M42 13h5a4 4 0 0 1 4 4v5M51 42v5a4 4 0 0 1-4 4h-5M22 51h-5a4 4 0 0 1-4-4v-5" />
            <path className="entrance-bar [--bar:0]" stroke="#fff" d="M22 27v10" />
            <path className="entrance-bar [--bar:1]" stroke="#fff" d="M27 23v18" />
            <path className="entrance-bar [--bar:2]" stroke="#fff" d="M37 23v18" />
            <path className="entrance-bar [--bar:3]" stroke="#fff" d="M42 27v10" />
            <path className="entrance-narration" stroke="#7dd3fc" d="M32 19v26" />
          </g>
        </svg>
        <p role="status" className="entrance-copy mt-7 flex max-w-full flex-col items-center gap-1.5">
          {title && (
            <span className="block max-w-[min(32rem,84vw)] truncate text-base font-semibold text-stage-foreground sm:text-lg" title={title}>
              {title}
            </span>
          )}
          <span className="block text-sm text-stage-foreground/70">{status}</span>
        </p>
      </div>
    </div>
  );
}
