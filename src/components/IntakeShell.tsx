import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The frame every step before the workspace shares (mode choice, Generate and Review intake): the Job List's width so
 * the content lines up with the logo, a way back, and the step's heading.
 */
export function IntakeShell({ backLabel, onBack, title, description, children }: {
  backLabel: string;
  onBack: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6 lg:py-14">
      <div className="max-w-4xl">
        <Button variant="ghost" className="-ml-3 mb-4 text-muted-foreground" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          {backLabel}
        </Button>
        <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">{title}</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground leading-relaxed">{description}</p>
        {children}
      </div>
    </section>
  );
}
