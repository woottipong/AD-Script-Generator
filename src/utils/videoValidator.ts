import { createFile } from 'mp4box';
import { JobMode, VideoMetadata, VideoValidationIssue } from '../types/ad';

export interface BrowserCompatibilityResult {
  supported: boolean;
  hasWebCodecsAudioDecoder: boolean;
  hasAacSupport: boolean;
  hasWebWorker: boolean;
  hasWebAssembly: boolean;
  reason?: string;
}

/**
 * Verifies Browser Compatibility before running WebCodecs AudioDecoder and Silero VAD
 * as mandated in Section 04 & Section 13 Rule 11.
 */
export async function checkBrowserCompatibility(): Promise<BrowserCompatibilityResult> {
  const hasWebWorker = typeof Worker !== 'undefined';
  const hasWebAssembly = typeof WebAssembly !== 'undefined';
  const hasWebCodecsAudioDecoder = typeof window !== 'undefined' && 'AudioDecoder' in window;

  if (!hasWebWorker) {
    return {
      supported: false,
      hasWebCodecsAudioDecoder,
      hasAacSupport: false,
      hasWebWorker,
      hasWebAssembly,
      reason: 'เบราว์เซอร์นี้ไม่รองรับ Web Worker สำหรับประมวลผลเสียงเบื้องหลัง',
    };
  }

  if (!hasWebAssembly) {
    return {
      supported: false,
      hasWebCodecsAudioDecoder,
      hasAacSupport: false,
      hasWebWorker,
      hasWebAssembly,
      reason: 'เบราว์เซอร์นี้ไม่รองรับ WebAssembly (WASM) สำหรับรันโมเดล Silero VAD ONNX',
    };
  }

  if (!hasWebCodecsAudioDecoder) {
    return {
      supported: false,
      hasWebCodecsAudioDecoder: false,
      hasAacSupport: false,
      hasWebWorker,
      hasWebAssembly,
      reason:
        'เบราว์เซอร์นี้ไม่รองรับ WebCodecs AudioDecoder API กรุณาใช้งานผ่าน Google Chrome หรือ Microsoft Edge เวอร์ชันปัจจุบันบน Desktop',
    };
  }

  try {
    const support = await AudioDecoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 44100,
      numberOfChannels: 2,
    });

    if (!support.supported) {
      return {
        supported: false,
        hasWebCodecsAudioDecoder: true,
        hasAacSupport: false,
        hasWebWorker,
        hasWebAssembly,
        reason:
          'เบราว์เซอร์นี้ไม่รองรับการถอดรหัสเสียง AAC (mp4a.40.2) ผ่าน WebCodecs AudioDecoder กรุณาใช้ Chrome หรือ Edge บน Desktop',
      };
    }

    return {
      supported: true,
      hasWebCodecsAudioDecoder: true,
      hasAacSupport: true,
      hasWebWorker: true,
      hasWebAssembly: true,
    };
  } catch (err) {
    return {
      supported: false,
      hasWebCodecsAudioDecoder: true,
      hasAacSupport: false,
      hasWebWorker,
      hasWebAssembly,
      reason: `ไม่สามารถตรวจสอบการรองรับ AAC AudioDecoder ได้: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Inspects MP4 container metadata by streaming 1 MB chunks using mp4box.js
 * without loading the entire 2 GB file into memory.
 */
export async function validateAndInspectMp4File(
  file: File,
  options: {
    maxDurationSeconds?: number;
    maxFileSizeMb?: number;
    /** Review Mode skips the upload size, H.264, and 480p checks that Gemini analysis needs. */
    mode?: JobMode;
  } = {}
): Promise<{
  valid: boolean;
  metadata: VideoMetadata | null;
  issues: VideoValidationIssue[];
}> {
  const maxDurationSeconds = options.maxDurationSeconds ?? 1800; // 30 minutes
  const maxFileSizeMb = options.maxFileSizeMb ?? 2000; // 2 GB
  const issues: VideoValidationIssue[] = [];
  const checkGenerateFormat = (options.mode ?? 'generate') === 'generate';

  // 1. Validate file extension & MIME type
  const isMp4Name = file.name.toLowerCase().endsWith('.mp4');
  const isMp4Mime = file.type === 'video/mp4' || file.type === 'application/mp4' || (file.type === '' && isMp4Name);
  if (!isMp4Name && !isMp4Mime) {
    issues.push({
      field: 'format',
      severity: 'error',
      message: `รองรับเฉพาะไฟล์วิดีโอรูปแบบ MP4 เท่านั้น (พบ: ${file.type || file.name})`,
    });
    return { valid: false, metadata: null, issues };
  }

  // 2. Validate file size (<= 2 GB)
  const maxBytes = maxFileSizeMb * 1024 * 1024;
  if (checkGenerateFormat && file.size > maxBytes) {
    issues.push({
      field: 'size',
      severity: 'error',
      message: `ขนาดไฟล์เกินกำหนดสูงสุด ${maxFileSizeMb} MB (ขนาดไฟล์ปัจจุบัน: ${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
    });
  }

  if (file.size === 0) {
    issues.push({
      field: 'size',
      severity: 'error',
      message: 'ไฟล์วิดีโอมีขนาด 0 ไบต์ ไม่สามารถอ่านข้อมูลได้',
    });
    return { valid: false, metadata: null, issues };
  }

  // 3. Parse MP4 moov atom via chunked reads using mp4box.js
  try {
    const mp4Info = await parseMp4HeaderChunked(file);
    const videoTrack = mp4Info.videoTracks?.[0];
    const audioTrack = mp4Info.audioTracks?.[0];

    if (!videoTrack) {
      issues.push({
        field: 'format',
        severity: 'error',
        message: 'ไม่พบ Video Track ในไฟล์ MP4 นี้',
      });
      return { valid: false, metadata: null, issues };
    }

    const width = videoTrack.video?.width || videoTrack.track_width || 0;
    const height = videoTrack.video?.height || videoTrack.track_height || 0;
    const videoCodec = videoTrack.codec || 'unknown';
    const audioCodec = audioTrack?.codec || 'none';
    const hasAudioTrack = Boolean(audioTrack);

    const durationSeconds =
      mp4Info.duration && mp4Info.timescale
        ? mp4Info.duration / mp4Info.timescale
        : videoTrack.duration && videoTrack.timescale
        ? videoTrack.duration / videoTrack.timescale
        : 0;
    const durationMs = Math.round(durationSeconds * 1000);

    // Validate Video Codec (H.264 / avc1)
    if (checkGenerateFormat && !videoCodec.toLowerCase().startsWith('avc1') && !videoCodec.toLowerCase().startsWith('avc3')) {
      issues.push({
        field: 'codec',
        severity: 'error',
        message: `Video Codec ต้องเป็น H.264 (avc1) เท่านั้น (พบ: ${videoCodec})`,
      });
    }

    // Validate Resolution (480p height)
    if (checkGenerateFormat && height !== 480) {
      issues.push({
        field: 'resolution',
        severity: 'error',
        message: `ความละเอียดวิดีโอต้องเป็น 480p (ความสูง 480px) เท่านั้น (พบ: ${width} × ${height})`,
      });
    }

    // Validate Duration (<= 30 minutes)
    if (durationSeconds > maxDurationSeconds) {
      issues.push({
        field: 'duration',
        severity: 'error',
        message: `ความยาววิดีโอเกินกำหนดสูงสุด ${Math.floor(maxDurationSeconds / 60)} นาที (พบ: ${(durationSeconds / 60).toFixed(1)} นาที)`,
      });
    }

    // Validate Audio Track & AAC Codec
    if (!hasAudioTrack) {
      issues.push({
        field: 'audio',
        severity: 'error',
        message: 'ไม่พบ Audio Track ในไฟล์วิดีโอ วิดีโอต้องมีแทร็กเสียง AAC สำหรับตรวจจับเสียงพูดด้วย VAD',
      });
    } else {
      if (!audioCodec.toLowerCase().startsWith('mp4a')) {
        issues.push({
          field: 'audio',
          severity: 'error',
          message: `Audio Codec ต้องเป็น AAC (mp4a) เท่านั้น (พบ: ${audioCodec})`,
        });
      } else {
        // Also verify WebCodecs AudioDecoder supports this specific AAC codec and sampleRate
        const sampleRate = audioTrack.audio?.sample_rate || 44100;
        const channelCount = audioTrack.audio?.channel_count || 2;
        if (typeof AudioDecoder !== 'undefined') {
          const codecCheck = await AudioDecoder.isConfigSupported({
            codec: audioCodec.startsWith('mp4a.40.') ? audioCodec : 'mp4a.40.2',
            sampleRate,
            numberOfChannels: channelCount,
          });
          if (!codecCheck.supported) {
            issues.push({
              field: 'browser',
              severity: 'error',
              message: `WebCodecs AudioDecoder ไม่รองรับการตั้งค่าเสียงของไฟล์นี้ (${audioCodec}, ${sampleRate}Hz, ${channelCount}ch)`,
            });
          }
        }
      }
    }

    const metadata: VideoMetadata = {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || 'video/mp4',
      width,
      height,
      durationMs,
      videoCodec,
      audioCodec,
      hasAudioTrack,
      sampleRate: audioTrack?.audio?.sample_rate,
      channelCount: audioTrack?.audio?.channel_count,
    };

    const hasBlockingError = issues.some((issue) => issue.severity === 'error');
    return {
      valid: !hasBlockingError,
      metadata,
      issues,
    };
  } catch (err) {
    issues.push({
      field: 'format',
      severity: 'error',
      message: `ไม่สามารถอ่านโครงสร้างไฟล์ MP4 ได้: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { valid: false, metadata: null, issues };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseMp4HeaderChunked(file: File): Promise<any> {
  const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks
  const mp4boxfile = createFile();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resolvedInfo: any = null;
  let parseError: Error | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mp4boxfile.onReady = (info: any) => {
    resolvedInfo = info;
  };

  mp4boxfile.onError = (_module: string, message: string) => {
    parseError = new Error(message);
  };

  let offset = 0;
  let safetyCounter = 0;
  const maxChunksToInspect = 2500; // Supports up to 2.5GB if moov is at end of file

  while (offset < file.size && !resolvedInfo && !parseError && safetyCounter < maxChunksToInspect) {
    safetyCounter++;
    const end = Math.min(offset + CHUNK_SIZE, file.size);
    const slice = file.slice(offset, end);
    const arrayBuffer = await slice.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mp4Buffer = arrayBuffer as any;
    mp4Buffer.fileStart = offset;

    const nextOffset = mp4boxfile.appendBuffer(mp4Buffer);
    if (resolvedInfo) {
      break;
    }

    if (typeof nextOffset === 'number' && nextOffset > offset && nextOffset < file.size) {
      offset = nextOffset;
    } else {
      offset = end;
    }
  }

  if (parseError) {
    throw parseError;
  }
  if (!resolvedInfo) {
    throw new Error('ไม่พบข้อมูล Header (moov atom) ของไฟล์ MP4');
  }

  return resolvedInfo;
}
