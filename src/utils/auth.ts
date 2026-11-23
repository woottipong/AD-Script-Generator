import type { Express, Request, Response } from 'express';
import * as oidc from 'openid-client';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, readCookie, sealValue, unsealValue, type AuthorSession } from './session';

export type AuthConfig = {
  issuerUrl: URL;
  clientId: string;
  sessionSecret: string;
  /** Public origin of the app, without a trailing slash. */
  appUrl: string;
  secureCookies: boolean;
  allJobsGroups: string[];
};

const REQUIRED_SETTINGS = ['KEYCLOAK_ISSUER_URL', 'KEYCLOAK_CLIENT_ID', 'SESSION_SECRET', 'APP_URL'] as const;
const LOGIN_COOKIE = 'envisio_login';
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_SESSION_COOKIE_BYTES = 3800;
const SAFE_ERROR_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/** Extracts only allowlisted non-secret metadata from OIDC/network errors before logging. */
export function summarizeAuthError(err: unknown): string {
  if (typeof err !== 'object' || err === null) return `NonError(${typeof err})`;
  const record = err as Record<string, unknown>;
  const rawName = err instanceof Error ? err.name || err.constructor?.name : err.constructor?.name;
  const name = typeof rawName === 'string' && SAFE_ERROR_TOKEN.test(rawName) ? rawName : 'Error';
  const parts = [name];
  for (const field of ['code', 'error'] as const) {
    const value = record[field];
    if (typeof value === 'string' && SAFE_ERROR_TOKEN.test(value)) parts.push(`${field}=${value}`);
  }
  if (typeof record.status === 'number' && Number.isInteger(record.status) && record.status >= 100 && record.status <= 599) {
    parts.push(`status=${record.status}`);
  }
  return parts.join(' ');
}

/** `new URL('localhost:3003')` parses with `localhost:` as the scheme, so the scheme is checked too. */
function parseUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${name} must start with http:// or https://`);
  return url;
}

/** Reads the sign-in settings; throws naming every missing or invalid one so the server can refuse to start. */
export function readAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const missing = REQUIRED_SETTINGS.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing sign-in settings: ${missing.join(', ')}`);
  if (env.SESSION_SECRET!.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const appUrl = parseUrl('APP_URL', env.APP_URL!);
  return {
    issuerUrl: parseUrl('KEYCLOAK_ISSUER_URL', env.KEYCLOAK_ISSUER_URL!),
    clientId: env.KEYCLOAK_CLIENT_ID!,
    sessionSecret: env.SESSION_SECRET!,
    appUrl: appUrl.origin,
    secureCookies: appUrl.protocol === 'https:',
    allJobsGroups: (env.AUTH_ALL_JOBS_GROUPS ?? 'admin,supervisor').split(',').map((group) => group.trim()).filter(Boolean),
  };
}

/** A path on this site to return to after signing in; anything that could leave the site becomes `/`. */
export function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}

/**
 * Keycloak sends groups as `/admin` with "Full group path" on and `admin` without; both match `admin`. A mapper
 * with "Multivalued" off sends one group as a string.
 */
export function allJobsGroupsOf(groups: unknown, allJobsGroups: string[]): string[] {
  const list = typeof groups === 'string' ? [groups] : groups;
  if (!Array.isArray(list)) return [];
  const names = list.filter((group): group is string => typeof group === 'string').map((group) => group.replace(/^\//, ''));
  return [...new Set(names.filter((group) => allJobsGroups.includes(group)))];
}

/** The Group Membership mapper's claim name is whatever was typed in Keycloak; the `rtt` realm uses `group`. */
function groupsClaim(claims: Record<string, unknown>): unknown {
  return claims.groups ?? claims.group;
}

/** The mapper may put the groups in the access token only; it came straight from the token endpoint over TLS. */
function accessTokenGroups(accessToken: string): unknown {
  try {
    return groupsClaim(JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')));
  } catch {
    return undefined;
  }
}

/** The groups that grant All-Jobs Access are kept so the account menu can say where the access comes from. */
function accessFrom(accessGroups: string[]): Pick<AuthorSession, 'allJobs' | 'accessGroups'> {
  return accessGroups.length > 0 ? { allJobs: true, accessGroups } : { allJobs: false };
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function authorEmailFromClaims(claims: { email?: unknown; preferred_username?: unknown; sub: string }): string {
  return trimmedString(claims.email) ?? trimmedString(claims.preferred_username) ?? (trimmedString(claims.sub) ?? claims.sub);
}

/** Omits `idToken` when sealing with it would exceed the 4 KB browser cookie budget. */
export function sealSession(secret: string, session: AuthorSession, maxAgeMs = SESSION_MAX_AGE_MS): string {
  const sealed = sealValue(secret, 'session', session, maxAgeMs);
  if (!session.idToken || Buffer.byteLength(`${SESSION_COOKIE}=${sealed}`, 'utf8') <= MAX_SESSION_COOKIE_BYTES) {
    return sealed;
  }
  const { idToken: _omitted, ...withoutIdToken } = session;
  return sealValue(secret, 'session', withoutIdToken, maxAgeMs);
}

function signInFailedPage(res: Response, status: number, message: string): void {
  res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><title>เข้าสู่ระบบไม่สำเร็จ</title><p>${message}</p><p><a href="/auth/login">ลองเข้าสู่ระบบอีกครั้ง</a></p>`);
}

/**
 * Mounts `/auth/login`, `/auth/callback` and `/auth/logout` and returns how to read the signed-in Author.
 * Keycloak is discovered on the first sign-in, so the server starts even while Keycloak is unreachable.
 */
export function mountAuth(app: Express, config: AuthConfig, onSignIn: (author: AuthorSession) => void) {
  let discovered: Promise<oidc.Configuration> | null = null;
  const provider = () => {
    if (!discovered) {
      // `envisio-dev` is a public client: PKCE, not a client secret, protects the code exchange.
      discovered = oidc.discovery(config.issuerUrl, config.clientId, undefined, oidc.None());
      discovered.catch(() => { discovered = null; });
    }
    return discovered;
  };
  const redirectUri = `${config.appUrl}/auth/callback`;
  const cookie = (name: string, value: string, maxAgeMs: number, path: string) =>
    `${name}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`;

  function sessionOf(req: Request): AuthorSession | null {
    const sealed = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = sealed ? unsealValue<AuthorSession>(config.sessionSecret, 'session', sealed) : null;
    // Sessions sealed before AI Generation Access existed lack `canGenerateAi`; treat them as signed out so Keycloak re-issues the entitlement.
    return session && typeof session.canGenerateAi === 'boolean' ? session : null;
  }

  app.use('/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  app.get('/auth/login', async (req: Request, res: Response) => {
    let configuration: oidc.Configuration;
    try {
      configuration = await provider();
    } catch (err) {
      console.error('Could not reach Keycloak to sign in:', summarizeAuthError(err));
      signInFailedPage(res, 503, 'เชื่อมต่อระบบเข้าสู่ระบบไม่ได้ กรุณาลองใหม่อีกครั้ง');
      return;
    }
    const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const pending = { pkceCodeVerifier, state, returnTo: safeReturnTo(req.query.returnTo) };
    res.append('Set-Cookie', cookie(LOGIN_COOKIE, sealValue(config.sessionSecret, 'login', pending, LOGIN_MAX_AGE_MS), LOGIN_MAX_AGE_MS, '/auth'));
    res.redirect(oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      // Only `openid`: this realm rejects scopes not assigned to the client, and its default scopes already add email.
      scope: 'openid',
      code_challenge: await oidc.calculatePKCECodeChallenge(pkceCodeVerifier),
      code_challenge_method: 'S256',
      state,
    }).href);
  });

  app.get('/auth/callback', async (req: Request, res: Response) => {
    const sealed = readCookie(req.headers.cookie, LOGIN_COOKIE);
    const pending = sealed ? unsealValue<{ pkceCodeVerifier: string; state: string; returnTo: string }>(config.sessionSecret, 'login', sealed) : null;
    res.append('Set-Cookie', cookie(LOGIN_COOKIE, '', 0, '/auth'));
    // A sign-in older than ten minutes, or a reused callback link, starts over.
    if (!pending) {
      res.redirect('/auth/login');
      return;
    }
    try {
      const tokens = await oidc.authorizationCodeGrant(await provider(), new URL(req.originalUrl, config.appUrl), {
        pkceCodeVerifier: pending.pkceCodeVerifier,
        expectedState: pending.state,
        idTokenExpected: true,
      });
      const claims = tokens.claims()!;
      const name = trimmedString(claims.name);
      const groups = groupsClaim(claims) ?? accessTokenGroups(tokens.access_token);
      const session: AuthorSession = {
        sub: claims.sub,
        email: authorEmailFromClaims(claims),
        ...(name ? { name } : {}),
        ...accessFrom(allJobsGroupsOf(groups, config.allJobsGroups)),
        canGenerateAi: allJobsGroupsOf(groups, ['admin', 'supervisor']).length > 0,
        ...(tokens.id_token ? { idToken: tokens.id_token } : {}),
      };
      onSignIn(session);
      res.append('Set-Cookie', cookie(SESSION_COOKIE, sealSession(config.sessionSecret, session), SESSION_MAX_AGE_MS, '/'));
      res.redirect(pending.returnTo);
    } catch (err) {
      console.error('Sign-in callback failed:', summarizeAuthError(err));
      signInFailedPage(res, 400, 'เข้าสู่ระบบไม่สำเร็จ');
    }
  });

  app.get('/auth/logout', async (req: Request, res: Response) => {
    const session = sessionOf(req);
    res.append('Set-Cookie', cookie(SESSION_COOKIE, '', 0, '/'));
    try {
      const url = oidc.buildEndSessionUrl(await provider(), {
        client_id: config.clientId,
        post_logout_redirect_uri: `${config.appUrl}/`,
        ...(session?.idToken ? { id_token_hint: session.idToken } : {}),
      });
      // Keycloak before release 18 (this realm still serves under `/auth`) reads `redirect_uri` instead.
      url.searchParams.set('redirect_uri', `${config.appUrl}/`);
      res.redirect(url.href);
    } catch (err) {
      console.error('Could not reach Keycloak to sign out:', summarizeAuthError(err));
      res.redirect('/');
    }
  });

  return { sessionOf };
}
