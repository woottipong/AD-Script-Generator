import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

const SMOKE_PORT = 4174;
const DEFAULT_BASE_URL = `http://127.0.0.1:${SMOKE_PORT}`;

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
      'SESSION_SECRET=0123456789abcdef0123456789abcdef',
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

test('production container serves config, auth gate, ONNX assets, and root page cleanly', async ({ page, request }) => {
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

  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));
  const response = await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  expect(response).not.toBeNull();
  await expect(page.locator('body')).toBeVisible();
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
