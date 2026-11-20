import {
  ADAnalysisSettings,
  AnalysisBatch,
  DEFAULT_AD_ANALYSIS_SETTINGS,
  GeminiBatchResponseSchema,
  PersistedJobState,
} from '../types/ad';
import { formatCompactTime, formatTimestampDisplay } from './formatters';
import { NARRATION_PACE_CHARS_PER_SEC, narrationCharBudget } from './narrationBudget';

export type BatchSpotResult = { decision: 'generate' | 'skip'; text: string; reason?: string };

/** Gemini answered, but the answer is unusable for this batch. Its message may quote spot IDs. */
export class BatchResponseError extends Error {}

/**
 * Builds the Gemini request for one Analysis Batch: the clip window, the system instruction,
 * and the prompt listing each Candidate Spot with its narration character budget.
 */
export function buildBatchPrompt(job: PersistedJobState, batch: AnalysisBatch) {
  const startOffsetSeconds = Math.max(0, Math.floor(batch.window_start_ms / 1000));
  const endOffsetSeconds = Math.max(
    startOffsetSeconds + 1,
    Math.ceil(batch.window_end_ms / 1000)
  );

  const adSettings: ADAnalysisSettings = job.ad_settings || DEFAULT_AD_ANALYSIS_SETTINGS;
  const paceCharsPerSec = adSettings.narrationPaceCharsPerSec || NARRATION_PACE_CHARS_PER_SEC;
  const safetyBufferMs = adSettings.safetyBufferMs ?? 250;

  const clipBaseMs = startOffsetSeconds * 1000;
  const clipEndBoundaryMs = endOffsetSeconds * 1000;

  const candidateListDescription = batch.candidate_spots
    .map((spot) => {
      const durationSec = (spot.duration_ms / 1000).toFixed(1);
      const { usableDurationMs, maxChars: maxRecommendedChars, maxWords: maxRecommendedWords } =
        narrationCharBudget(spot.duration_ms, paceCharsPerSec, safetyBufferMs);
      const usableDurationSec = usableDurationMs / 1000;
      const clipStartMs = Math.max(0, spot.start_ms - clipBaseMs);
      const clipEndMs = Math.max(clipStartMs, spot.end_ms - clipBaseMs);
      return `- spot_id: "${spot.spot_id}" | เวลาในคลิปนี้: ${formatCompactTime(clipStartMs)}–${formatCompactTime(clipEndMs)} (เวลาเต็ม: ${formatTimestampDisplay(spot.start_ms)}–${formatTimestampDisplay(spot.end_ms)} · ความยาวเต็ม ${durationSec}s · เวลาพูดจริง ${usableDurationSec.toFixed(1)}s · ห้ามเกิน ~${maxRecommendedChars} ตัวอักษร / ~${maxRecommendedWords} คำ)`;
    })
    .join('\n');

  // Include recent generated AD lines from earlier batches for character/scene continuity
  const previousGeneratedSpots = (job.spots || [])
    .filter(
      (s) =>
        s.decision === 'generate' &&
        s.text.trim().length > 0 &&
        s.start_ms < batch.batch_start_ms
    )
    .sort((a, b) => a.start_ms - b.start_ms)
    .slice(-5);

  const continuityContextSection =
    previousGeneratedSpots.length > 0
      ? `\n- บทบรรยายช่วงล่าสุดก่อนหน้า Batch นี้ (ใช้รักษาความต่อเนื่องของชื่อตัวละคร สถานที่ และไม่บรรยายซ้ำ):\n${previousGeneratedSpots
          .map((s) => `  • [${formatTimestampDisplay(s.start_ms)}] ${s.text.trim()}`)
          .join('\n')}`
      : '';

  const genreGuidanceMap: Record<ADAnalysisSettings['contentGenre'], string> = {
    auto_cinema:
      'วิเคราะห์ประเภทเนื้อหาอัตโนมัติจากภาพและเสียง โดยเน้นการกระทำของตัวละคร การเปลี่ยนฉาก วัตถุสำคัญ และข้อความบนหน้าจอ',
    drama_series:
      'เนื้อหาประเภทละคร/ภาพยนตร์: เน้นกิริยาท่าทาง สีหน้าที่เห็นได้ชัด การเคลื่อนไหวของตัวละคร และความสัมพันธ์เชิงพื้นที่โดยไม่สปอยล์หรือคาดเดาความรู้สึกภายใน',
    documentary:
      'เนื้อหาประเภทสารคดี/รายการ: เน้นสถานที่ วัตถุ ข้อมูลกราฟิก/ตัวอักษรบนหน้าจอ และกิจกรรมที่กำลังเกิดขึ้นอย่างตรงไปตรงมา',
    action_thriller:
      'เนื้อหาประเภทแอ็กชัน/ระทึกขวัญ: ใช้ประโยคสั้น กระชับ ฉับไว เน้นการเคลื่อนไหวหลักและทิศทางโดยไม่ทับเสียงเอฟเฟกต์สำคัญ',
  };

  const styleRulesExtra = [
    adSettings.avoidCameraJargon
      ? '- ห้ามใช้ศัพท์เทคนิคมุมกล้องหรือขนาดภาพ เช่น "กล้องแพน", "กล้องซูม", "ภาพตัดไปที่", "ระยะใกล้" ให้บรรยายสิ่งที่เกิดขึ้นตรง ๆ (เช่น "ในห้องครัว...", "มือของชายหนุ่มกำกุญแจแน่น")'
      : '',
    adSettings.prioritizeCharacterActions
      ? '- ใช้โครงสร้างประโยคกรรตุวาจก (ประธาน + กริยา + กรรม) ที่กระชับและเข้าใจง่ายในครั้งเดียวที่ฟัง'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const systemInstruction = `คุณคือผู้เชี่ยวชาญด้านการเขียนบทบรรยายภาพ (Audio Description - AD) ภาษาไทยสำหรับผู้พิการทางการมองเห็นตามมาตรฐานวิชาชีพ
หน้าที่ของคุณคือวิเคราะห์ภาพและเสียงของวิดีโอในช่วงเวลาที่กำหนด และตัดสินใจสำหรับ Candidate Spot แต่ละรายการว่าจะสร้างบทบรรยายภาพ ("generate") หรือข้าม ("skip")

แนวทางเฉพาะสำหรับงานนี้ (Pre-configured Optimal Profile):
- โหมดการวิเคราะห์เนื้อหา: ${genreGuidanceMap[adSettings.contentGenre]}
- ความเร็วการพูดมาตรฐาน: ${paceCharsPerSec} ตัวอักษร/วินาที (เว้นระยะปลอดภัยก่อน-หลังเสียงพูด ${safetyBufferMs} ms)
${styleRulesExtra}

กฎการวิเคราะห์ (AI Analysis Rules):
1. อ้างอิงตำแหน่งเหตุการณ์จาก "เวลาในคลิปนี้" เป็นหลัก โดยเข้าใจเหตุการณ์จากทั้งภาพและเสียง ก่อน ระหว่าง และหลัง Candidate Spot
2. บรรยายเฉพาะเหตุการณ์สำคัญทางภาพ (เช่น การกระทำของตัวละคร การเปลี่ยนฉาก สีหน้าท่าทางที่ชัดเจน วัตถุสำคัญ หรือข้อความบนหน้าจอ) ที่ผู้ฟังไม่สามารถรับรู้ได้จากเสียงเพียงอย่างเดียว
3. หลีกเลี่ยงการบรรยายซ้ำกับบทพูดหรือเสียงที่อธิบายเหตุการณ์อยู่แล้ว และห้ามทับเสียงดนตรีสำคัญหรือเสียงเอฟเฟกต์ที่ต้องฟังเพื่อเข้าใจเนื้อเรื่อง
4. ใช้ภาษาพูดภาษาไทยที่เป็นธรรมชาติสำหรับอ่านออกเสียง เล่าแบบกาลปัจจุบัน (เหตุการณ์ที่กำลังเกิดขึ้น) กระชับ ไม่ใช้คำขึ้นต้นฟุ่มเฟือย เช่น "ภาพแสดงให้เห็น...", "ปรากฏภาพ...", "ในฉากนี้...", "เราจะเห็น..."
5. ห้ามเดาความรู้สึกภายใน เจตนา หรือข้อมูลที่ไม่ปรากฏให้เห็นชัดเจน ห้ามสปอยล์เหตุการณ์ล่วงหน้า และหากข้อความบนหน้าจอเบลอหรือไม่ชัดจนอ่านได้ไม่ครบ ห้ามเดาคำ ให้ข้ามหรือบรรยายเฉพาะสิ่งที่เห็นชัดเจน
6. รักษาความสม่ำเสมอในการเรียกตัวละคร ใช้ชื่อตัวละครเฉพาะเมื่อได้ยินในบทพูดหรือเห็นบนหน้าจอชัดเจนแล้วเท่านั้น ก่อนหน้านั้นให้ใช้ลักษณะเด่นที่คงที่ (เช่น "ชายเสื้อเชิ้ตฟ้า") ไม่เปลี่ยนคำเรียกไปมา
7. คุมความยาวให้พูดจบก่อนหมดช่วงว่างเสมอ ห้ามเขียนเกินโควตาตัวอักษร/คำที่กำหนดในแต่ละ Spot หากช่วงว่างสั้นให้เลือกบรรยายเฉพาะใจความสำคัญที่สุด 1 อย่าง (สั้นกระชับดีกว่าพูดล้นไปทับบทพูดถัดไป)
8. ตอบ decision เป็น "skip" พร้อมระบุ reason ภาษาไทยสั้นๆ และให้ text เป็น "" หากไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย ภาพนิ่ง/ต่อเนื่องไม่เปลี่ยนสาระสำคัญ หรือเสียงอธิบายชัดเจนอยู่แล้ว
9. ห้ามสร้าง spot_id ใหม่เด็ดขาด และต้องส่งผลลัพธ์ครบทุก spot_id ที่กำหนดใน Batch นี้เท่านั้น

ตัวอย่างการตัดสินใจและสไตล์การเขียน (Few-shot Examples):
- ช่วงสั้น (เต็ม 3.0s · ห้ามเกิน ~21 ตัวอักษร / ~5 คำ):
  decision: "generate", text: "ชายเสื้อฟ้าเปิดประตูเข้าห้อง"
- ช่วงยาว (เต็ม 7.5s · ห้ามเกิน ~65 ตัวอักษร / ~14 คำ):
  decision: "generate", text: "หญิงสาววางแก้วน้ำลงบนโต๊ะ เธอหยิบซองจดหมายขึ้นมาพลิกดูแล้วชะงัก"
- ช่วงที่ไม่ควรบรรยาย (ภาพแช่/เสียงอธิบายแล้ว):
  decision: "skip", text: "", reason: "ภาพแช่ที่ตัวละครเดิม ไม่มีเหตุการณ์สำคัญใหม่"`;

  const promptText = `ข้อมูลการวิเคราะห์ Batch ที่ ${batch.batch_index}:
- คลิปวิดีโอที่แนบมาตัดจากช่วงเวลาเต็ม ${formatTimestampDisplay(clipBaseMs)} ถึง ${formatTimestampDisplay(clipEndBoundaryMs)} (เวลา 00:00 ของคลิปนี้ = เวลาเต็ม ${formatTimestampDisplay(clipBaseMs)})
- ช่วงเวลาหลักของ Batch: ${formatTimestampDisplay(batch.batch_start_ms)} ถึง ${formatTimestampDisplay(batch.batch_end_ms)}${continuityContextSection}

รายการ Candidate AD Spots ที่ต้องตัดสินใจและเขียนบทบรรยายภาพ (ต้องส่งคืนครบทั้ง ${batch.candidate_spots.length} รายการ):
${candidateListDescription}

ส่งผลลัพธ์เป็น JSON ตาม Schema ที่กำหนด โดยใส่เฉพาะ spot_id ที่ระบุไว้ข้างต้นครบทุกรายการ`;

  return { startOffsetSeconds, endOffsetSeconds, systemInstruction, promptText };
}

/**
 * Validates Gemini's JSON answer for one Analysis Batch. Ignores IDs outside the batch,
 * defaults a missing skip reason, and throws unless every Candidate Spot is answered.
 */
export function parseBatchResponse(responseText: string, batch: AnalysisBatch): Map<string, BatchSpotResult> {
  const rawText = responseText.trim();
  if (!rawText) {
    throw new BatchResponseError('Gemini ส่งผลลัพธ์ว่างเปล่า (Empty response)');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch {
    throw new BatchResponseError('ผลลัพธ์จาก Gemini ไม่ใช่รูปแบบ JSON ที่ถูกต้อง');
  }

  const validated = GeminiBatchResponseSchema.safeParse(parsedJson);
  if (!validated.success) {
    throw new BatchResponseError(`โครงสร้าง JSON ไม่ตรงตาม Schema: ${validated.error.message}`);
  }

  // Server Validation Rules (Section 06):
  // - Reject Spot IDs not in this Batch
  // - Ensure all Candidate Spot IDs in this Batch are present
  const expectedSpotIds = new Set(batch.candidate_spots.map((s) => s.spot_id));
  const resultMap = new Map<string, BatchSpotResult>();

  for (const item of validated.data.spots) {
    if (!expectedSpotIds.has(item.spot_id)) {
      continue;
    }
    const cleanedText = item.text.trim();
    if (item.decision === 'generate' && cleanedText.length === 0) {
      throw new BatchResponseError(`Spot ${item.spot_id} มีสถานะ generate แต่ไม่มีข้อความบรรยาย`);
    }
    resultMap.set(item.spot_id, {
      decision: item.decision,
      text: cleanedText,
      reason: item.decision === 'skip' ? item.reason || 'ไม่มีเหตุการณ์สำคัญที่ต้องบรรยาย' : item.reason,
    });
  }

  // Verify completeness: every candidate spot in the batch must be answered
  const missingIds = batch.candidate_spots
    .map((s) => s.spot_id)
    .filter((id) => !resultMap.has(id));

  if (missingIds.length > 0) {
    throw new BatchResponseError(
      `Gemini ตอบกลับไม่ครบทุก Spot ใน Batch (ขาด: ${missingIds.join(', ')})`
    );
  }

  return resultMap;
}

export function parseGeminiError(err: unknown): {
  isRateLimit: boolean;
  isHighDemand503: boolean;
  isTransient: boolean;
  statusCode: number;
  userMessage: string;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  if (err instanceof BatchResponseError) {
    return {
      isRateLimit: false,
      isHighDemand503: false,
      isTransient: false,
      statusCode: 500,
      userMessage: `เกิดข้อผิดพลาดจาก Gemini API: ${rawMessage}`,
    };
  }
  const lower = rawMessage.toLowerCase();

  const isRateLimit =
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit');

  const isHighDemand503 =
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded');

  const isAuthError =
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('permission_denied') ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid');

  const isTransient =
    isRateLimit ||
    isHighDemand503 ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('504') ||
    lower.includes('internal') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timeout') ||
    lower.includes('aborted') ||
    lower.includes('fetch failed');

  if (isRateLimit) {
    return {
      isRateLimit: true,
      isHighDemand503: false,
      isTransient: true,
      statusCode: 429,
      userMessage:
        'เกินโควตาการเรียกใช้งาน Gemini API (HTTP 429 / Quota Exhausted) กรุณารอสักครู่แล้วกดทำต่อ หรือตรวจสอบโควตา API Key ใน Settings > Secrets',
    };
  }

  if (isHighDemand503) {
    return {
      isRateLimit: false,
      isHighDemand503: true,
      isTransient: true,
      statusCode: 500,
      userMessage:
        'เซิร์ฟเวอร์โมเดล Gemini มีปริมาณการใช้งานหนาแน่นชั่วคราว (503 High Demand) กรุณากดดำเนินการสร้างต่อในอีกสักครู่',
    };
  }

  if (isAuthError) {
    return {
      isRateLimit: false,
      isHighDemand503: false,
      isTransient: false,
      statusCode: 401,
      userMessage:
        'ไม่สามารถยืนยันตัวตนกับ Gemini API ได้ (Invalid API Key / Permission Denied) กรุณาตรวจสอบ GEMINI_API_KEY ในแผง Settings > Secrets',
    };
  }

  return {
    isRateLimit: false,
    isHighDemand503: false,
    isTransient,
    statusCode: 500,
    userMessage: `เกิดข้อผิดพลาดจาก Gemini API: ${rawMessage}`,
  };
}
