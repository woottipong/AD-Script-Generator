import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UrlNotReadableError, fileByteSource, isMp4Url, openByteSource } from './byteSource';

const bytes = new TextEncoder().encode('0123456789');
const url = 'https://media.example/%E0%B8%95%E0%B8%AD%E0%B8%99%203.mp4?token=x';

function fakeFetch(options: { headStatus?: number; length?: string | null; rangeStatus?: number; truncate?: boolean } = {}) {
  const calls: { method: string; range: string | null; cache?: RequestCache }[] = [];
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method ?? 'GET', range: headers.get('Range'), cache: init?.cache });
    if (init?.method === 'HEAD') {
      const responseHeaders = new Headers({ 'content-type': 'video/mp4' });
      if (options.length !== null) responseHeaders.set('content-length', options.length ?? String(bytes.length));
      return new Response(null, { status: options.headStatus ?? 200, headers: responseHeaders });
    }
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(headers.get('Range') ?? '')!;
    return new Response(bytes.slice(Number(start), Number(end) + (options.truncate ? 0 : 1)), { status: options.rangeStatus ?? 206 });
  }) as typeof fetch;
  return { impl, calls };
}

test('accepts only http(s) links whose path ends in .mp4', () => {
  assert.equal(isMp4Url('https://a.example/v.MP4?x=1'), true);
  assert.equal(isMp4Url('http://a.example/folder/v.mp4'), true);
  for (const bad of ['ftp://a.example/v.mp4', 'https://a.example/v.mov', 'not a url', 'file:///v.mp4']) assert.equal(isMp4Url(bad), false, bad);
});

test('a URL source reads its size from HEAD and each range with an uncached Range request', async () => {
  const { impl, calls } = fakeFetch();
  const source = await openByteSource({ kind: 'url', url }, impl);
  assert.equal(source.size, 10);
  assert.equal(source.name, 'ตอน 3.mp4');
  assert.equal(new TextDecoder().decode(await source.read(2, 5)), '234');
  assert.deepEqual(calls, [
    { method: 'HEAD', range: null, cache: 'no-store' },
    { method: 'GET', range: 'bytes=2-4', cache: 'no-store' },
  ]);
});

test('a link that does not report its size or answer ranges cannot be read', async () => {
  await assert.rejects(openByteSource({ kind: 'url', url }, fakeFetch({ length: null }).impl), UrlNotReadableError);
  await assert.rejects(openByteSource({ kind: 'url', url }, fakeFetch({ headStatus: 403 }).impl), UrlNotReadableError);
  const source = await openByteSource({ kind: 'url', url }, fakeFetch({ rangeStatus: 200 }).impl);
  await assert.rejects(source.read(0, 4), UrlNotReadableError);
  const blocked = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
  await assert.rejects(openByteSource({ kind: 'url', url }, blocked), UrlNotReadableError);
});

test('a file source reads slices of the file', async () => {
  const source = fileByteSource(new File([bytes], 'clip.mp4', { type: 'video/mp4' }));
  assert.deepEqual([source.name, source.size, source.type], ['clip.mp4', 10, 'video/mp4']);
  assert.equal(new TextDecoder().decode(await source.read(7, 10)), '789');
});

test('a range answered with fewer bytes than requested is rejected', async () => {
  const source = await openByteSource({ kind: 'url', url }, fakeFetch({ truncate: true }).impl);
  await assert.rejects(source.read(0, 4), UrlNotReadableError);
});

test('a link whose file name has a broken percent-escape still opens', async () => {
  const source = await openByteSource({ kind: 'url', url: 'https://media.example/%E0%B8.mp4' }, fakeFetch().impl);
  assert.equal(source.name, '%E0%B8.mp4');
});
