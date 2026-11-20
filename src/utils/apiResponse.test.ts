import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApiResponse } from './apiResponse';

const respond = (body: string, status: number, contentType: string) =>
  new Response(body, { status, statusText: status === 500 ? 'Internal Server Error' : '', headers: { 'content-type': contentType } });

test('JSON bodies are returned as data even for error statuses', async () => {
  assert.deepEqual(await parseApiResponse(respond('{"ok":true}', 200, 'application/json')), { ok: true });
  assert.deepEqual(await parseApiResponse(respond('{"error":"x"}', 409, 'application/json; charset=utf-8')), { error: 'x' });
});

test('non-JSON bodies become user-facing errors', async () => {
  await assert.rejects(parseApiResponse(respond('too big', 413, 'text/plain')), /413 Payload Too Large/);
  await assert.rejects(parseApiResponse(respond('<!DOCTYPE html><p>warming up</p>', 200, 'text/html')), /สลับการเชื่อมต่อชั่วคราว/);
  await assert.rejects(parseApiResponse(respond('oops', 500, 'text/plain')), /HTTP 500 \(Internal Server Error\)/);
  await assert.rejects(parseApiResponse(respond('plain text', 200, 'text/plain')), /รูปแบบข้อมูลที่ได้รับจากเซิร์ฟเวอร์ไม่ถูกต้อง: plain text/);
});
