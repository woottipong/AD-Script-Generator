import { decodeSrtBytes, parseSrt } from './srtImport';

export const GOOGLE_DRIVE_SRT_MAX_BYTES = 5 * 1024 * 1024;

const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,128}$/;
const DRIVE_INPUT_HOSTS = new Set(['drive.google.com', 'drive.usercontent.google.com']);
const MAX_REDIRECTS = 2;
const DEFAULT_TIMEOUT_MS = 15_000;
const DRIVE_UNAVAILABLE_MESSAGE = 'ไม่สามารถดึงไฟล์จาก Google Drive ได้ในขณะนี้ กรุณาลองอีกครั้ง';

function fileTooLargeError(maxBytes: number): GoogleDriveSrtError {
  const mb = maxBytes / (1024 * 1024);
  const label = Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
  return new GoogleDriveSrtError(413, `ไฟล์ SRT มีขนาดใหญ่เกิน ${label} MB`);
}

export class GoogleDriveSrtError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'GoogleDriveSrtError';
    this.statusCode = statusCode;
  }
}

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!DRIVE_INPUT_HOSTS.has(parsed.hostname.toLowerCase())) return null;

  const filePathMatch = /^\/(?:u\/\d+\/)?file\/d\/([^/]+)/.exec(parsed.pathname);
  const candidate = filePathMatch
    ? filePathMatch[1]
    : /^\/(?:u\/\d+\/)?(?:open|uc|download)$/.test(parsed.pathname)
      ? parsed.searchParams.get('id')
      : null;

  if (!candidate || !DRIVE_FILE_ID_PATTERN.test(candidate)) return null;
  return candidate;
}

export function isGoogleDriveUrl(value: string): boolean {
  return extractGoogleDriveFileId(value) !== null;
}

function sanitizeFileName(raw: string): string | null {
  // Strip control characters and any directory segments supplied by the remote header.
  const withoutControls = raw.replace(/[\x00-\x1f\x7f]/g, '');
  const baseName = (withoutControls.split(/[/\\]/).pop() ?? '').trim();
  if (!baseName || baseName === '.' || baseName === '..') return null;
  return baseName;
}

function decodeHeaderUtf8IfMojibake(value: string): string {
  // Fetch exposes HTTP header bytes as Latin-1; Google Drive sends raw UTF-8 Thai filenames in Content-Disposition.
  let hasHighByte = false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0xff) return value;
    if (code >= 0x80) hasHighByte = true;
  }
  if (!hasHighByte) return value;
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

export function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null;

  const extMatch = /filename\*\s*=\s*(?:"([^"]*)"|([^;\r\n]+))/i.exec(header);
  if (extMatch) {
    const rawExtValue = (extMatch[1] ?? extMatch[2] ?? '').trim();
    const rfc5987 = /^[^']*'[^']*'(.*)$/.exec(rawExtValue);
    if (rfc5987) {
      try {
        const decoded = sanitizeFileName(decodeURIComponent(rfc5987[1]));
        if (decoded) return decoded;
      } catch {
        // Fall back to the plain filename parameter if percent-encoding is malformed.
      }
    }
  }

  const quotedMatch = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  if (quotedMatch) {
    const unescaped = decodeHeaderUtf8IfMojibake(quotedMatch[1].replace(/\\(["\\])/g, '$1'));
    return sanitizeFileName(unescaped);
  }

  const unquotedMatch = /filename\s*=\s*([^;\r\n]+)/i.exec(header);
  if (unquotedMatch) {
    return sanitizeFileName(decodeHeaderUtf8IfMojibake(unquotedMatch[1]));
  }

  return null;
}

function isAllowlistedRedirectTarget(url: URL): boolean {
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return (
    host === 'drive.google.com' ||
    host === 'drive.usercontent.google.com' ||
    host.endsWith('.googleusercontent.com')
  );
}

async function readResponseBytesCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw fileTooLargeError(maxBytes);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw fileTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof GoogleDriveSrtError) throw err;
    throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function fetchGoogleDriveSrt(
  rawUrl: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number }
): Promise<{ fileName: string; content: string; sizeBytes: number; cueCount: number }> {
  const fileId = extractGoogleDriveFileId(rawUrl);
  if (!fileId) {
    throw new GoogleDriveSrtError(400, 'กรุณาวางลิงก์ไฟล์ Google Drive เช่น https://drive.google.com/file/d/…/view');
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? GOOGLE_DRIVE_SRT_MAX_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);

  let currentUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
  let response: Response;

  for (let redirects = 0; ; redirects++) {
    try {
      response = await fetchImpl(currentUrl, { redirect: 'manual', signal });
    } catch {
      throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (!location) {
        throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
      }

      if (!isAllowlistedRedirectTarget(nextUrl)) {
        throw new GoogleDriveSrtError(400, 'ไฟล์นี้ไม่ได้ตั้งเป็นสาธารณะ กรุณาเปิดสิทธิ์ “ทุกคนที่มีลิงก์” ใน Google Drive');
      }
      if (redirects >= MAX_REDIRECTS) {
        throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
      }

      currentUrl = nextUrl.toString();
      continue;
    }

    break;
  }

  if (response.status === 404) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleDriveSrtError(404, 'ไม่พบไฟล์นี้ใน Google Drive กรุณาตรวจลิงก์อีกครั้ง');
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleDriveSrtError(400, 'ไม่สามารถเข้าถึงไฟล์นี้ได้ กรุณาเปิดสิทธิ์ “ทุกคนที่มีลิงก์” ใน Google Drive');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleDriveSrtError(502, DRIVE_UNAVAILABLE_MESSAGE);
  }

  const contentType = (response.headers.get('content-type') || '').trim().toLowerCase();
  if (contentType.startsWith('text/html')) {
    await response.body?.cancel().catch(() => {});
    throw new GoogleDriveSrtError(400, 'ลิงก์นี้ไม่ได้ส่งไฟล์ SRT โดยตรง กรุณาตรวจว่าเปิดสิทธิ์ “ทุกคนที่มีลิงก์” และเป็นไฟล์ .srt');
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const declaredSize = Number(contentLengthHeader);
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw fileTooLargeError(maxBytes);
    }
  }

  const bytes = await readResponseBytesCapped(response, maxBytes);
  const content = decodeSrtBytes(bytes);

  let cues;
  try {
    cues = parseSrt(content);
  } catch {
    throw new GoogleDriveSrtError(400, 'ไฟล์จากลิงก์นี้ไม่ใช่รูปแบบ SRT ที่อ่านได้ กรุณาตรวจไฟล์ใน Google Drive');
  }

  const parsedName = parseContentDispositionFileName(response.headers.get('content-disposition'));
  const baseFileName = parsedName || `drive-${fileId.slice(0, 8)}.srt`;
  const fileName = /\.srt$/i.test(baseFileName) ? baseFileName : `${baseFileName}.srt`;

  return {
    fileName,
    content,
    sizeBytes: bytes.byteLength,
    cueCount: cues.length,
  };
}
