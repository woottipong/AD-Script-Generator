import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';

test('chunk retries preserve bytes and reject conflicting offsets', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-upload-test-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const root = process.cwd();
  fs.symlinkSync(path.join(root, 'src'), path.join(dir, 'src'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(dir, 'server.ts'), fs.readFileSync(path.join(root, 'server.ts'), 'utf8').replace('const PORT = 3000;', `const PORT = ${port};`));
  const child = spawn(process.execPath, [path.join(dir, 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/api/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready);
    const init = await fetch(`${base}/api/upload/init`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: 'fixture.mp4', fileSize: 6 }) });
    const { uploadId } = await init.json() as { uploadId: string };
    const upload = (offset: string, body: string) => fetch(`${base}/api/upload/chunk?uploadId=${uploadId}&offset=${offset}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
    assert.equal((await upload('0', 'abc')).status, 200);
    assert.equal((await upload('0', 'abc')).status, 200);
    assert.equal((await upload('0', 'abd')).status, 409);
    assert.equal((await upload('4', 'def')).status, 409);
    assert.equal((await upload('-1', 'def')).status, 400);
    assert.equal((await upload('2', 'cdef')).status, 200);
    assert.equal(fs.readFileSync(path.join(dir, '.data/jobs', uploadId, 'source_video.mp4'), 'utf8'), 'abcdef');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
