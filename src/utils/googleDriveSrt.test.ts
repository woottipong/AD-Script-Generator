import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGoogleDriveFileId,
  fetchGoogleDriveSrt,
  GOOGLE_DRIVE_SRT_MAX_BYTES,
  GoogleDriveSrtError,
  isGoogleDriveUrl,
  parseContentDispositionFileName,
} from './googleDriveSrt';

const SAMPLE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const SAMPLE_SRT = '1\n00:00:01,000 --> 00:00:03,000\nชายเปิดประตู\n\n2\n00:00:05,000 --> 00:00:07,000\nหญิงเดินเข้ามา\n';

test('extractGoogleDriveFileId parses supported Google Drive URLs and rejects unsafe or invalid ones', () => {
  assert.equal(extractGoogleDriveFileId(`https://drive.google.com/file/d/${SAMPLE_ID}/view?usp=sharing`), SAMPLE_ID);
  assert.equal(extractGoogleDriveFileId(`https://drive.google.com/file/d/${SAMPLE_ID}`), SAMPLE_ID);
  assert.equal(extractGoogleDriveFileId(`https://drive.google.com/open?id=${SAMPLE_ID}`), SAMPLE_ID);
  assert.equal(extractGoogleDriveFileId(`https://drive.google.com/uc?id=${SAMPLE_ID}&export=download`), SAMPLE_ID);
  assert.equal(extractGoogleDriveFileId(`https://drive.usercontent.google.com/download?id=${SAMPLE_ID}&export=download`), SAMPLE_ID);

  assert.equal(isGoogleDriveUrl(`  https://drive.google.com/file/d/${SAMPLE_ID}/view  `), true);
  assert.equal(isGoogleDriveUrl(`ftp://drive.google.com/file/d/${SAMPLE_ID}/view`), false);
  assert.equal(isGoogleDriveUrl(`https://drive.google.com.evil.com/file/d/${SAMPLE_ID}/view`), false);
  assert.equal(isGoogleDriveUrl(`https://docs.google.com/document/d/${SAMPLE_ID}/edit`), false);
  assert.equal(isGoogleDriveUrl('https://drive.google.com/file/d/short/view'), false);
  assert.equal(isGoogleDriveUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'), false);
  assert.equal(isGoogleDriveUrl('not a url'), false);
});

test('parseContentDispositionFileName parses RFC 5987 UTF-8 Thai filenames, quoted/unquoted values, and strips unsafe paths', () => {
  assert.equal(parseContentDispositionFileName(null), null);
  assert.equal(
    parseContentDispositionFileName(`attachment; filename="fallback.srt"; filename*=UTF-8''%E0%B8%9A%E0%B8%97%E0%B8%9A%E0%B8%A3%E0%B8%A3%E0%B8%A2%E0%B8%B2%E0%B8%A2%20%E0%B8%95%E0%B8%AD%E0%B8%99%201.srt`),
    'บทบรรยาย ตอน 1.srt',
  );
  assert.equal(parseContentDispositionFileName('attachment; filename="lesson-01.srt"'), 'lesson-01.srt');
  assert.equal(parseContentDispositionFileName('attachment; filename=lesson-02.srt; size=12'), 'lesson-02.srt');
  const latin1Thai = Array.from(new TextEncoder().encode('การค้นหาข้อมูล 1.srt'), (b) => String.fromCharCode(b)).join('');
  assert.equal(parseContentDispositionFileName(`attachment; filename="${latin1Thai}"`), 'การค้นหาข้อมูล 1.srt');
  assert.equal(parseContentDispositionFileName('attachment; filename="../../secret\\clip\u0007.srt"'), 'clip.srt');
  assert.equal(parseContentDispositionFileName('attachment; filename=".."'), null);
});

test('fetchGoogleDriveSrt follows allowlisted redirects and returns UTF-8 Thai cues and filename', async () => {
  const seenUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (seenUrls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://doc-00-00-docs.googleusercontent.com/docs/securesc/abc/file' },
      });
    }
    return new Response(SAMPLE_SRT, {
      status: 200,
      headers: {
        'content-type': 'application/x-subrip; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''%E0%B8%95%E0%B8%AD%E0%B8%99%E0%B8%97%E0%B8%B5%E0%B9%88%201.srt`,
      },
    });
  };

  const result = await fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, { fetchImpl });
  assert.equal(seenUrls.length, 2);
  assert.equal(seenUrls[0], `https://drive.usercontent.google.com/download?id=${SAMPLE_ID}&export=download`);
  assert.equal(result.fileName, 'ตอนที่ 1.srt');
  assert.equal(result.cueCount, 2);
  assert.equal(result.sizeBytes, new TextEncoder().encode(SAMPLE_SRT).byteLength);
  assert.match(result.content, /ชายเปิดประตู/);
});

test('fetchGoogleDriveSrt decodes Windows-874 SRT bytes and falls back/normalizes .srt filename', async () => {
  const win874Bytes = new Uint8Array([
    ...new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n'),
    0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5, // สวัสดี in Windows-874
    0x0a,
  ]);
  const fetchImpl: typeof fetch = async () => new Response(win874Bytes, { status: 200 });

  const fallbackResult = await fetchGoogleDriveSrt(`https://drive.google.com/open?id=${SAMPLE_ID}`, { fetchImpl });
  assert.equal(fallbackResult.fileName, `drive-${SAMPLE_ID.slice(0, 8)}.srt`);
  assert.equal(fallbackResult.cueCount, 1);
  assert.match(fallbackResult.content, /สวัสดี/);

  const noExtFetch: typeof fetch = async () => new Response(SAMPLE_SRT, {
    status: 200,
    headers: { 'content-disposition': 'attachment; filename="script"' },
  });
  const appendedExt = await fetchGoogleDriveSrt(`https://drive.google.com/open?id=${SAMPLE_ID}`, { fetchImpl: noExtFetch });
  assert.equal(appendedExt.fileName, 'script.srt');
});

test('fetchGoogleDriveSrt blocks redirects to accounts.google.com, non-allowlisted hosts, and redirect loops', async () => {
  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin' } }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 400 && /ทุกคนที่มีลิงก์/.test(err.message),
  );

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 400,
  );

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://drive.google.com/uc?id=other' } }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 502,
  );
});

test('fetchGoogleDriveSrt classifies HTTP errors, text/html responses, >5MB payloads, and invalid SRT', async () => {
  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response('Not Found', { status: 404 }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 404,
  );

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response('Forbidden', { status: 403 }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 400 && /ทุกคนที่มีลิงก์/.test(err.message),
  );

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response('<html><body>Sign in</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 400 && /ไม่ได้ส่งไฟล์ SRT โดยตรง/.test(err.message),
  );

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response('1', {
        status: 200,
        headers: { 'content-length': String(GOOGLE_DRIVE_SRT_MAX_BYTES + 1) },
      }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 413,
  );

  // Stream exceeding maxBytes without Content-Length header
  const oversizedChunk = new Uint8Array(64);
  let chunksDelivered = 0;
  let cancelled = false;
  const oversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksDelivered++;
      controller.enqueue(oversizedChunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      maxBytes: 100,
      fetchImpl: async () => new Response(oversizedStream, { status: 200 }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 413,
  );
  assert.ok(chunksDelivered >= 2 && chunksDelivered <= 3, `Expected early stream stop, got ${chunksDelivered} chunks`);
  assert.equal(cancelled, true);

  await assert.rejects(
    () => fetchGoogleDriveSrt(`https://drive.google.com/file/d/${SAMPLE_ID}/view`, {
      fetchImpl: async () => new Response('not valid srt content', { status: 200 }),
    }),
    (err: unknown) => err instanceof GoogleDriveSrtError && err.statusCode === 400 && /ไม่ใช่รูปแบบ SRT/.test(err.message),
  );
});
