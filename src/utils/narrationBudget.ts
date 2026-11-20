export const NARRATION_PACE_CHARS_PER_SEC = 11.5;
export const SPEECH_ONSET_MARGIN_MS = 350;

/**
 * Estimates Thai Audio Description speaking duration in milliseconds.
 * Excludes combining Thai vowel/tone marks so the phonetic character count is accurate.
 * Standard Thai AD narration pace is ~11.5 base characters per second.
 */
export function estimateThaiSpeechDurationMs(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  // Strip Thai combining marks (above/below vowels and tone marks: U+0E31, U+0E34..U+0E3A, U+0E47..U+0E4E) and whitespace
  const baseChars = cleaned.replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\s]/g, '');
  if (baseChars.length === 0) return 0;
  return Math.round((baseChars.length * 1000) / NARRATION_PACE_CHARS_PER_SEC + SPEECH_ONSET_MARGIN_MS);
}

/**
 * Character budget Gemini is asked to stay within for a spot: the gap minus the safety buffer at
 * both ends and the onset margin, at the narration pace with 85% headroom for LLM overshoot.
 */
export function narrationCharBudget(durationMs: number, paceCharsPerSec: number, safetyBufferMs: number) {
  const usableDurationMs = Math.max(500, durationMs - safetyBufferMs * 2);
  const speakableDurationSec = Math.max(0.5, (usableDurationMs - SPEECH_ONSET_MARGIN_MS) / 1000);
  const maxChars = Math.max(8, Math.floor(speakableDurationSec * paceCharsPerSec * 0.85));
  return { usableDurationMs, maxChars, maxWords: Math.max(3, Math.round(maxChars / 4.5)) };
}
