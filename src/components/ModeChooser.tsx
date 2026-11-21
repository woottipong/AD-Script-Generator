import { FileText, Sparkles } from 'lucide-react';
import type { JobMode } from '../types/ad';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { IntakeShell } from './IntakeShell';

const modes: { mode: JobMode; title: string; description: string; Icon: typeof Sparkles }[] = [
  { mode: 'generate', title: 'สร้างบทบรรยาย', description: 'หาช่วงว่างในวิดีโอ แล้วให้ Gemini เขียนบทบรรยายภาพใหม่ให้ตรวจแก้', Icon: Sparkles },
  { mode: 'review', title: 'แก้ไข SRT ที่มีอยู่', description: 'เปิดวิดีโอกับไฟล์ SRT ที่ทำไว้แล้ว เพื่อตรวจและแก้บทเทียบกับเสียงพูด', Icon: FileText },
];

export function ModeChooser({ onChoose, onBack }: {
  onChoose: (mode: JobMode) => void;
  onBack: () => void;
}) {
  return (
    <IntakeShell backLabel="รายการงาน" onBack={onBack} title="เริ่มงานบทบรรยายภาพ" description="เลือกว่าจะสร้างบทใหม่ หรือแก้บทที่มีอยู่แล้ว">
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {modes.map(({ mode, title, description, Icon }) => (
          // The title's button stretches over the whole card, so the card is one control and its ring shows hover and focus.
          <Card key={mode} className="relative transition-shadow hover:ring-2 hover:ring-brand-300 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring">
            <CardHeader className="gap-3">
              <Icon className="size-6 text-primary" aria-hidden="true" />
              <CardTitle>
                <button
                  type="button"
                  onClick={() => onChoose(mode)}
                  aria-describedby={`mode-${mode}-description`}
                  className="cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-none"
                >
                  {title}
                </button>
              </CardTitle>
              <CardDescription id={`mode-${mode}-description`} className="leading-relaxed">{description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </IntakeShell>
  );
}
