import type { AnalysisBatch, JobStatus } from '../types/ad';
import { formatCompactTime, formatFileSize } from './formatters';

export interface ProcessingProgress {
  stage: string;
  percent: number;
  processedMs?: number;
  totalMs?: number;
  loadedBytes?: number;
  totalBytes?: number;
}

export interface ProcessingFeedback {
  title: string;
  description: string;
  detail?: string;
  percent?: number;
}

export function getProcessingFeedback(
  status: JobStatus,
  progress: ProcessingProgress | null,
  batches: AnalysisBatch[],
  errorMessage: string | null,
): ProcessingFeedback | null {
  if (status === 'DETECTING') {
    if (progress?.stage.includes('คำนวณช่วงเสียงพูด')) {
      return { title: 'กำลังจัดช่วงสำหรับบรรยาย', description: 'ตรวจเสียงครบแล้ว กำลังจัดรายการช่วงว่างให้คุณตรวจและสร้างบทบรรยาย' };
    }
    if (progress?.processedMs !== undefined && progress.totalMs !== undefined && progress.totalMs > 0) {
      const processedMs = Math.min(progress.processedMs, progress.totalMs);
      return {
        title: 'กำลังหาช่วงสำหรับบรรยาย',
        description: 'เปิดดูวิดีโอระหว่างรอได้ รายการช่วงบรรยายจะแสดงเมื่อตรวจเสร็จ',
        detail: `ตรวจเสียงแล้ว ${formatCompactTime(processedMs)} จาก ${formatCompactTime(progress.totalMs)}`,
        percent: Math.round(processedMs / progress.totalMs * 100),
      };
    }
    return { title: 'กำลังเตรียมตรวจเสียง', description: 'กำลังเตรียมเครื่องมือตรวจเสียงบนเครื่องของคุณ ครั้งแรกอาจใช้เวลานานขึ้น' };
  }
  if (status !== 'ANALYZING') return null;
  if (errorMessage) {
    return { title: 'กำลังตรวจการเชื่อมต่ออีกครั้ง', description: 'ยังตรวจสถานะงานไม่ได้ ระบบกำลังลองเชื่อมต่อใหม่ ระหว่างนี้ยังแก้ไขบทบรรยายไม่ได้' };
  }
  if (progress?.loadedBytes !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0) {
    return {
      title: 'กำลังส่งวิดีโอ',
      description: 'กำลังส่งไฟล์ไปยังเซิร์ฟเวอร์เพื่อสร้างบทบรรยาย กรุณาเปิดหน้านี้ไว้จนส่งเสร็จ',
      detail: `ส่งแล้ว ${formatFileSize(progress.loadedBytes)} จาก ${formatFileSize(progress.totalBytes)}`,
      percent: Math.min(100, Math.round(progress.loadedBytes / progress.totalBytes * 100)),
    };
  }
  if (progress?.stage.includes('บันทึกการแก้ไข')) {
    return { title: 'กำลังบันทึกบทบรรยาย', description: 'รอให้บันทึกการแก้ไขสำเร็จก่อนดำเนินการต่อ' };
  }
  const activeBatch = batches.find((batch) => batch.status === 'processing');
  if (activeBatch) {
    const completed = batches.filter((batch) => batch.status === 'completed').length;
    return {
      title: 'กำลังสร้างบทบรรยาย',
      description: 'ผลที่เสร็จแล้วจะแสดงด้านล่าง แก้ไขได้เมื่อการวิเคราะห์สิ้นสุด',
      detail: `วิเคราะห์เสร็จ ${completed} จาก ${batches.length} ชุด · กำลังทำชุดที่ ${activeBatch.batch_index}`,
      percent: Math.round(completed / batches.length * 100),
    };
  }
  return { title: 'กำลังเตรียมวิดีโอสำหรับวิเคราะห์', description: 'เซิร์ฟเวอร์กำลังเตรียมไฟล์ก่อนเริ่มสร้างบทบรรยาย' };
}
