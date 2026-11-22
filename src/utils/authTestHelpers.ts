import { SESSION_COOKIE, SESSION_MAX_AGE_MS, sealValue, type AuthorSession } from './session';

export const TEST_SESSION_SECRET = 'test-only-session-secret-0123456789';

/** Sign-in settings for a server started by a test; `.invalid` never resolves, so no Keycloak is reached. */
export function authTestEnv(port: number): Record<string, string> {
  return {
    KEYCLOAK_ISSUER_URL: 'https://keycloak.invalid/realms/test',
    KEYCLOAK_CLIENT_ID: 'envisio-test',
    SESSION_SECRET: TEST_SESSION_SECRET,
    APP_URL: `http://127.0.0.1:${port}`,
  };
}

/** A Cookie header carrying a session the test server accepts, without signing in through Keycloak. */
export function sessionCookie(author: Omit<AuthorSession, 'idToken'>): string {
  return `${SESSION_COOKIE}=${sealValue(TEST_SESSION_SECRET, 'session', { ...author, idToken: 'test-id-token' }, SESSION_MAX_AGE_MS)}`;
}

/** `fetch` that sends the Author's session cookie with every request. */
export function signedInFetch(author: Omit<AuthorSession, 'idToken'>): typeof fetch {
  const cookie = sessionCookie(author);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', cookie);
    return fetch(input, { ...init, headers });
  };
}
