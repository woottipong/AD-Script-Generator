import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuesToSpots, decodeSrtBytes, parseSrt } from './srtImport';

const utf8 = (text: string) => new TextEncoder().encode(text);

test('decodes UTF-8 with or without a BOM', () => {
  assert.equal(decodeSrtBytes(utf8('1\n00:00:01,000 --> 00:00:02,000\nสวัสดี')), '1\n00:00:01,000 --> 00:00:02,000\nสวัสดี');
  assert.equal(decodeSrtBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('สวัสดี')])), 'สวัสดี');
});

test('falls back to Windows-874 when the bytes are not valid UTF-8', () => {
  assert.equal(decodeSrtBytes(new Uint8Array([0xca, 0xc7, 0xd1, 0xca, 0xb4, 0xd5])), 'สวัสดี');
});

test('parses cues with CRLF, multi-line text, dot milliseconds, and formatting tags', () => {
  const cues = parseSrt([
    '1', '00:00:01,000 --> 00:00:03,500', '<i>ชายเปิดประตู</i>', '<b>แล้วเดินเข้าห้อง</b>', '',
    '2', '00:01:02.250 --> 00:01:04.000 X1:0 X2:10', '<font color="#fff">หญิงยิ้ม</font>', '', '',
  ].join('\r\n'));
  assert.deepEqual(cues, [
    { start_ms: 1000, end_ms: 3500, text: 'ชายเปิดประตู\nแล้วเดินเข้าห้อง' },
    { start_ms: 62250, end_ms: 64000, text: 'หญิงยิ้ม' },
  ]);
});

test('keeps cues in time order even when the file lists them out of order', () => {
  const cues = parseSrt('2\n00:00:05,000 --> 00:00:06,000\nB\n\n1\n00:00:01,000 --> 00:00:02,000\nA\n');
  assert.deepEqual(cues.map((cue) => cue.text), ['A', 'B']);
});

test('rejects files with no readable cue', () => {
  assert.throws(() => parseSrt(''), /ไม่พบบรรทัดบรรยาย/);
  assert.throws(() => parseSrt('hello\nworld'), /ไม่พบบรรทัดบรรยาย/);
});

test('turns cues into AD Spots and leaves out cues that start after the video ends or have no duration', () => {
  const { spots, skipped } = cuesToSpots([
    { start_ms: 1000, end_ms: 3500, text: 'ก' },
    { start_ms: 9000, end_ms: 11000, text: 'ข' },
    { start_ms: 12000, end_ms: 13000, text: 'ค' },
    { start_ms: 5000, end_ms: 5000, text: 'ง' },
  ], 10000);
  assert.deepEqual(spots, [
    { spot_id: 'cue_001', start_ms: 1000, end_ms: 3500, duration_ms: 2500, decision: 'generate', text: 'ก', is_edited: false, original_start_ms: 1000, original_end_ms: 3500 },
    { spot_id: 'cue_002', start_ms: 9000, end_ms: 11000, duration_ms: 2000, decision: 'generate', text: 'ข', is_edited: false, original_start_ms: 9000, original_end_ms: 11000 },
  ]);
  assert.deepEqual(skipped, [
    { cue: { start_ms: 12000, end_ms: 13000, text: 'ค' }, reason: 'starts_after_video_end' },
    { cue: { start_ms: 5000, end_ms: 5000, text: 'ง' }, reason: 'no_duration' },
  ]);
});
