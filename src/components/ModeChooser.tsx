import { ArrowLeft, FileText, Sparkles } from 'lucide-react';
import type { JobMode } from '../types/ad';

const modes: { mode: JobMode; title: string; description: string; Icon: typeof Sparkles }[] = [
  { mode: 'generate', title: 'สร้างบทบรรยาย', description: 'หาช่วงว่างในวิดีโอ แล้วให้ Gemini เขียนบทบรรยายภาพใหม่ให้ตรวจแก้', Icon: Sparkles },
  { mode: 'review', title: 'แก้ไข SRT ที่มีอยู่', description: 'เปิดวิดีโอกับไฟล์ SRT ที่ทำไว้แล้ว เพื่อตรวจและแก้บทเทียบกับเสียงพูด', Icon: FileText },
];

export function ModeChooser({ onChoose, onBack }: {
  onChoose: (mode: JobMode) => void;
  onBack: () => void;
}) {
  return (
    <section className="w-[calc(100%_-_2rem)] max-w-4xl mx-auto my-8 sm:my-14 px-1 sm:px-0">
      <button type="button" onClick={onBack} className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 cursor-pointer">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />รายการงาน
      </button>
      <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 leading-tight">เริ่มงานบทบรรยายภาพ</h1>
      <p className="mt-3 text-base text-slate-600 leading-relaxed">เลือกว่าจะสร้างบทใหม่ หรือแก้บทที่มีอยู่แล้ว</p>
      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        {modes.map(({ mode, title, description, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChoose(mode)}
            className="flex flex-col items-start gap-3 rounded-lg border border-slate-300 bg-white p-5 text-left hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-brand-700 cursor-pointer"
          >
            <Icon className="h-6 w-6 text-brand-700" aria-hidden="true" />
            <span className="text-lg font-semibold text-slate-900">{title}</span>
            <span className="text-sm leading-relaxed text-slate-600">{description}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
