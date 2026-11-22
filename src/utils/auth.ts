import type { Express, Request, Response } from 'express';
import * as oidc from 'openid-client';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, readCookie, sealValue, unsealValue, type AuthorSession } from './session';

export type AuthConfig = {
  issuerUrl: URL;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  /** Public origin of the app, without a trailing slash. */
  appUrl: string;
  secureCookies: boolean;
  allJobsGroups: string[];
};

const REQUIRED_SETTINGS = ['KEYCLOAK_ISSUER_URL', 'KEYCLOAK_CLIENT_ID', 'KEYCLOAK_CLIENT_SECRET', 'SESSION_SECRET', 'APP_URL'] as const;
const LOGIN_COOKIE = 'envisio_login';
const LOGIN_MAX_AGE_MS = 10 * 60 * 1000;

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
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
    clientSecret: env.KEYCLOAK_CLIENT_SECRET!,
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

/** Keycloak sends groups as `/admin` with "Full group path" on and `admin` without; both match `admin`. */
export function hasAllJobsAccess(groups: unknown, allJobsGroups: string[]): boolean {
  return Array.isArray(groups) && groups.some((group) => typeof group === 'string' && allJobsGroups.includes(group.replace(/^\//, '')));
}

/** The mapper may put `groups` in the access token only; it came straight from the token endpoint over TLS. */
function accessTokenGroups(accessToken: string): unknown {
  try {
    return (JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')) as { groups?: unknown }).groups;
  } catch {
    return undefined;
  }
}

function signInFailedPage(res: Response, status: number, message: string): void {
  res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><title>เข้าสู่ระบบไม่สำเร็จ</title><p>${message}</p><p><a href="/auth/login">ลองเข้าสู่ระบบอีกครั้ง</a></p>`);
}

/**
 * Mounts `/auth/login`, `/auth/callback` and `/auth/logout` and returns how to read the signed-in Author.
 * Keycloak is discovered on the first sign-in, so the server starts even while Keycloak is unreachable.
 */
export function mountAuth(app: Express, config: AuthConfig) {
  let discovered: Promise<oidc.Configuration> | null = null;
  const provider = () => {
    if (!discovered) {
      discovered = oidc.discovery(config.issuerUrl, config.clientId, undefined, oidc.ClientSecretBasic(config.clientSecret));
      discovered.catch(() => { discovered = null; });
    }
    return discovered;
  };
  const redirectUri = `${config.appUrl}/auth/callback`;
  const cookie = (name: string, value: string, maxAgeMs: number, path: string) =>
    `${name}=${value}; Path=${path}; Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`;

  function sessionOf(req: Request): AuthorSession | null {
    const sealed = readCookie(req.headers.cookie, SESSION_COOKIE);
    return sealed ? unsealValue<AuthorSession>(config.sessionSecret, 'session', sealed) : null;
  }

  app.get('/auth/login', async (req: Request, res: Response) => {
    let configuration: oidc.Configuration;
    try {
      configuration = await provider();
    } catch (err) {
      console.error('Could not reach Keycloak to sign in:', err);
      signInFailedPage(res, 503, 'เชื่อมต่อระบบเข้าสู่ระบบไม่ได้ กรุณาลองใหม่อีกครั้ง');
      return;
    }
    const pkceCodeVerifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const pending = { pkceCodeVerifier, state, returnTo: safeReturnTo(req.query.returnTo) };
    res.append('Set-Cookie', cookie(LOGIN_COOKIE, sealValue(config.sessionSecret, 'login', pending, LOGIN_MAX_AGE_MS), LOGIN_MAX_AGE_MS, '/auth'));
    res.redirect(oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: 'openid email profile',
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
      const email = typeof claims.email === 'string' ? claims.email : typeof claims.preferred_username === 'string' ? claims.preferred_username : claims.sub;
      const session: AuthorSession = {
        sub: claims.sub,
        email,
        allJobs: hasAllJobsAccess(claims.groups ?? accessTokenGroups(tokens.access_token), config.allJobsGroups),
        idToken: tokens.id_token!,
      };
      res.append('Set-Cookie', cookie(SESSION_COOKIE, sealValue(config.sessionSecret, 'session', session, SESSION_MAX_AGE_MS), SESSION_MAX_AGE_MS, '/'));
      res.redirect(pending.returnTo);
    } catch (err) {
      console.error('Sign-in callback failed:', err);
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
        ...(session ? { id_token_hint: session.idToken } : {}),
      });
      // Keycloak before release 18 (this realm still serves under `/auth`) reads `redirect_uri` instead.
      url.searchParams.set('redirect_uri', `${config.appUrl}/`);
      res.redirect(url.href);
    } catch (err) {
      console.error('Could not reach Keycloak to sign out:', err);
      res.redirect('/');
    }
  });

  return { sessionOf };
}
