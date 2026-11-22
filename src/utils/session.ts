import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** The signed-in Author, as the session cookie carries it. */
export type AuthorSession = { sub: string; email: string; name?: string; allJobs: boolean; idToken: string };

export const SESSION_COOKIE = 'envisio_session';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Each purpose gets its own key, so a value sealed for one cookie never opens as another. */
type Purpose = 'session' | 'login';

function keyFor(secret: string, purpose: Purpose): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, '', `envisio-${purpose}`, 32));
}

/** AES-256-GCM over `{ value, exp }`, encoded as base64url `iv.tag.ciphertext`. */
export function sealValue(secret: string, purpose: Purpose, value: unknown, maxAgeMs: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ value, exp: Date.now() + maxAgeMs }), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
}

/** The sealed value, or null when it was tampered with, sealed for another purpose or secret, or has expired. */
export function unsealValue<T>(secret: string, purpose: Purpose, sealed: string): T | null {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
    decipher.setAuthTag(tag);
    const opened = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')) as { value: T; exp: number };
    return opened.exp > Date.now() ? opened.value : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const pair of (header ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator).trim() === name) return pair.slice(separator + 1).trim();
  }
  return undefined;
}
