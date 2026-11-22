import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { authTestEnv, signedInFetch } from './helpers/auth';

async function freePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

test('POST /api/review/fetch-srt requires a session and rejects missing or non-Drive URLs with 400', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-gdrive-srt-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], {
    cwd: dir,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port) },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  const authFetch = signedInFetch({ sub: 'sub-gdrive-author', email: 'author@example.com', allJobs: false });

  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = (await fetch(`${base}/config`)).ok;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.ok(ready, 'server is ready');

    const unauth = await fetch(`${base}/review/fetch-srt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view' }),
    });
    assert.equal(unauth.status, 401);
    assert.equal((await unauth.json() as { code: string }).code, 'UNAUTHENTICATED');

    const emptyUrl = await authFetch(`${base}/review/fetch-srt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '   ' }),
    });
    assert.equal(emptyUrl.status, 400);
    assert.match((await emptyUrl.json() as { error: string }).error, /Google Drive/);

    const nonDriveUrl = await authFetch(`${base}/review/fetch-srt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:8080/internal.srt' }),
    });
    assert.equal(nonDriveUrl.status, 400);
    assert.match((await nonDriveUrl.json() as { error: string }).error, /drive\.google\.com/);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
