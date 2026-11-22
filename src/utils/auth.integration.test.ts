import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { authTestEnv, sessionCookie, TEST_SESSION_SECRET } from './authTestHelpers';
import { SESSION_COOKIE, sealValue } from './session';

async function freePort(): Promise<number> {
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  return port;
}

test('the server refuses to start without its sign-in settings', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-auth-config-test-'));
  const port = await freePort();
  const env = { ...authTestEnv(port), SESSION_SECRET: '' };
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.notEqual(code, 0);
    assert.match(stderr, /SESSION_SECRET/);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every API but config needs a session, and pages send signed-out Authors to sign in', { timeout: 20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-auth-test-'));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(process.cwd(), 'server.ts')], { cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), ...authTestEnv(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  const author = { sub: 'sub-author', email: 'author@example.com', allJobs: false };
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try { ready = (await fetch(`${base}/api/config`)).ok; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(ready, '/api/config answers without a session');

    const signedOut = await fetch(`${base}/api/jobs`);
    assert.equal(signedOut.status, 401);
    assert.equal((await signedOut.json() as { code: string }).code, 'UNAUTHENTICATED');
    assert.equal((await fetch(`${base}/api/me`)).status, 401);

    const signedOutMalformedJson = await fetch(`${base}/api/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(signedOutMalformedJson.status, 401);
    assert.equal((await signedOutMalformedJson.json() as { code: string }).code, 'UNAUTHENTICATED');

    const me = await fetch(`${base}/api/me`, { headers: { Cookie: sessionCookie(author) } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { email: 'author@example.com', allJobs: false });
    assert.equal((await fetch(`${base}/api/jobs`, { headers: { Cookie: sessionCookie(author) } })).status, 200);
    const named = await fetch(`${base}/api/me`, { headers: { Cookie: sessionCookie({ ...author, name: 'ผู้เขียน ทดสอบ' }) } });
    assert.deepEqual(await named.json(), { email: 'author@example.com', name: 'ผู้เขียน ทดสอบ', allJobs: false });
    const lead = await fetch(`${base}/api/me`, { headers: { Cookie: sessionCookie({ ...author, allJobs: true, accessGroups: ['admin'] }) } });
    assert.deepEqual(await lead.json(), { email: 'author@example.com', allJobs: true, accessGroups: ['admin'] });

    const expired = sealValue(TEST_SESSION_SECRET, 'session', { ...author, idToken: 'x' }, -1);
    assert.equal((await fetch(`${base}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${expired}` } })).status, 401, 'an expired session counts as signed out');
    const forged = sealValue('another-secret-that-is-long-enough!!', 'session', { ...author, idToken: 'x' }, 60_000);
    assert.equal((await fetch(`${base}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${forged}` } })).status, 401, 'a session sealed with another secret is rejected');

    const page = await fetch(`${base}/jobs/job_1?tab=2`, { headers: { Accept: 'text/html,application/xhtml+xml' }, redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), `/auth/login?returnTo=${encodeURIComponent('/jobs/job_1?tab=2')}`);
    const signedInPage = await fetch(`${base}/jobs/job_1`, { headers: { Accept: 'text/html', Cookie: sessionCookie(author) }, redirect: 'manual' });
    assert.notEqual(signedInPage.status, 302, 'a signed-in Author gets the page');
    assert.notEqual((await fetch(`${base}/ort/missing.wasm`, { redirect: 'manual' })).status, 302, 'static files are not redirected');

    const login = await fetch(`${base}/auth/login?returnTo=/jobs/job_1`, { redirect: 'manual' });
    assert.equal(login.status, 503, 'an unreachable Keycloak fails the sign-in, not the server');
    assert.match(login.headers.get('cache-control') ?? '', /\bno-store\b/);
    assert.ok((await fetch(`${base}/api/config`)).ok);

    const logout = await fetch(`${base}/auth/logout`, { headers: { Cookie: sessionCookie(author) }, redirect: 'manual' });
    assert.equal(logout.status, 302);
    assert.match(logout.headers.get('cache-control') ?? '', /\bno-store\b/);
    assert.match(logout.headers.get('set-cookie') ?? '', new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'), 'signing out clears the session even when Keycloak is unreachable');
  } finally {
    child.kill('SIGTERM');
    await Promise.race([new Promise<void>(resolve => child.once('exit', () => resolve())), new Promise(resolve => setTimeout(resolve, 1000))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
