/** Random-access reads over a video, whether it is a local File or a remote URL read with HTTP Range. */
export interface ByteSource {
  name: string;
  size: number;
  type: string;
  /** Bytes in [start, end). */
  read(start: number, end: number): Promise<ArrayBuffer>;
}

/** Cloneable description of a video, so it can cross into the VAD Web Worker. */
export type ByteSourceInput = { kind: 'file'; file: File } | { kind: 'url'; url: string };

export class UrlNotReadableError extends Error {
  constructor() {
    super('ลิงก์นี้เปิดจากเบราว์เซอร์ไม่ได้ กรุณาดาวน์โหลดแล้วเลือกเป็นไฟล์แทน');
  }
}

export function isMp4Url(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.pathname.toLowerCase().endsWith('.mp4');
  } catch {
    return false;
  }
}

export function fileNameFromUrl(url: string): string {
  const segment = new URL(url).pathname.split('/').pop() || 'video.mp4';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function fileByteSource(file: File): ByteSource {
  return { name: file.name, size: file.size, type: file.type, read: (start, end) => file.slice(start, end).arrayBuffer() };
}

/**
 * Reads a remote MP4 range by range. `no-store` keeps the browser from caching the whole video on disk,
 * and the size comes from HEAD because cross-origin responses rarely expose Content-Range.
 */
async function urlByteSource(url: string, fetchImpl: typeof fetch): Promise<ByteSource> {
  let head: Response;
  try {
    head = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
  } catch {
    throw new UrlNotReadableError();
  }
  const size = Number(head.headers.get('content-length'));
  if (!head.ok || !Number.isSafeInteger(size) || size <= 0) throw new UrlNotReadableError();
  const name = fileNameFromUrl(url);
  return {
    name,
    size,
    type: 'video/mp4',
    async read(start, end) {
      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end - 1}` }, cache: 'no-store' });
      } catch {
        throw new UrlNotReadableError();
      }
      if (response.status !== 206) throw new UrlNotReadableError();
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== end - start) throw new UrlNotReadableError();
      return buffer;
    },
  };
}

export async function openByteSource(input: ByteSourceInput, fetchImpl: typeof fetch = fetch): Promise<ByteSource> {
  return input.kind === 'file' ? fileByteSource(input.file) : urlByteSource(input.url, fetchImpl);
}
