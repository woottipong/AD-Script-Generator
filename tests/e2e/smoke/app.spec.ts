import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, sealValue } from '../../../src/utils/session';

const SMOKE_PORT = 4174;
const DEFAULT_BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;
const SMOKE_SESSION_SECRET = process.env.SMOKE_SESSION_SECRET || '0123456789abcdef0123456789abcdef';

test.describe.configure({ mode: 'serial' });

let containerId: string | undefined;
let baseUrl = process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL;

async function waitForConfig(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/config`);
      if (res.status === 200) return;
    } catch {
      // Container still starting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}/api/config`);
}

test.beforeAll(async () => {
  if (process.env.SMOKE_BASE_URL) {
    baseUrl = process.env.SMOKE_BASE_URL.replace(/\/$/, '');
    await waitForConfig(baseUrl);
    return;
  }
  containerId = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '--init',
      '-p',
      `127.0.0.1:${SMOKE_PORT}:3000`,
      '-e',
      `APP_URL=${DEFAULT_BASE_URL}`,
      '-e',
      'KEYCLOAK_ISSUER_URL=https://accounts.rtt.in.th/auth/realms/rtt',
      '-e',
      'KEYCLOAK_CLIENT_ID=envisio-dev',
      '-e',
      `SESSION_SECRET=${SMOKE_SESSION_SECRET}`,
      '-e',
      'GEMINI_API_KEY=dummy',
      'envisio:latest',
    ],
    { encoding: 'utf8' }
  ).trim();
  await waitForConfig(baseUrl);
});

test.afterAll(() => {
  if (containerId) {
    try {
      execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
    } catch {
      // Container may already be stopped
    }
  }
});

test('production container serves config, auth gate, ONNX assets, and root page cleanly', async ({ page, context, request }) => {
  const configRes = await request.get(`${baseUrl}/api/config`);
  expect(configRes.status()).toBe(200);
  const configBody = await configRes.json();
  expect(configBody.config).toEqual(
    expect.objectContaining({
      geminiModel: expect.any(String),
      maxUploadSizeMb: expect.any(Number),
      vadThreshold: expect.any(Number),
    })
  );

  const jobsRes = await request.get(`${baseUrl}/api/jobs`);
  expect(jobsRes.status()).toBe(401);
  expect(await jobsRes.json()).toEqual(expect.objectContaining({ code: 'UNAUTHENTICATED' }));

  const modelRes = await request.get(`${baseUrl}/models/silero_vad.onnx`);
  expect(modelRes.status()).toBe(200);
  expect(modelRes.headers()['cross-origin-resource-policy']).toBe('cross-origin');

  const rootRedirectRes = await request.get(`${baseUrl}/`, {
    headers: { accept: 'text/html' },
    maxRedirects: 0,
  });
  expect(rootRedirectRes.status()).toBe(302);
  expect(rootRedirectRes.headers()['location']).toBe('/auth/login?returnTo=%2F');

  const sealedSession = sealValue(
    SMOKE_SESSION_SECRET,
    'session',
    { sub: 'smoke-user', email: 'smoke@example.com', allJobs: false },
    SESSION_MAX_AGE_MS
  );
  await context.addCookies([{ name: SESSION_COOKIE, value: sealedSession, url: baseUrl }]);

  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const response = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  expect(page.url()).toBe(`${baseUrl}/`);
  await expect(page.getByRole('button', { name: 'บัญชี smoke@example.com' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
