import assert from 'node:assert/strict';
import test from 'node:test';
import { allJobsGroupsOf, authorEmailFromClaims, readAuthConfig, safeReturnTo, sealSession } from './auth';
import { SESSION_COOKIE, readCookie, sealValue, unsealValue, type AuthorSession } from './session';

const SECRET = 'test-session-secret-at-least-32-chars';

test('a sealed value opens only with the same secret and purpose, before it expires', () => {
  const sealed = sealValue(SECRET, 'session', { sub: 'a' }, 60_000);
  assert.deepEqual(unsealValue(SECRET, 'session', sealed), { sub: 'a' });
  assert.equal(unsealValue(`${SECRET}-other`, 'session', sealed), null);
  assert.equal(unsealValue(SECRET, 'login', sealed), null, 'a login-state cookie cannot pass as a session');
  assert.equal(unsealValue(SECRET, 'session', `${sealed.slice(0, -2)}xx`), null);
  assert.equal(unsealValue(SECRET, 'session', 'not-a-sealed-value'), null);
  assert.equal(unsealValue(SECRET, 'session', sealValue(SECRET, 'session', { sub: 'a' }, -1)), null, 'an expired value is rejected');
});

test('readCookie finds one cookie among several', () => {
  assert.equal(readCookie('a=1; envisio_session=abc.def; b=2', 'envisio_session'), 'abc.def');
  assert.equal(readCookie(undefined, 'envisio_session'), undefined);
  assert.equal(readCookie('envisio_session_old=x', 'envisio_session'), undefined);
});

test('returnTo stays on this site', () => {
  assert.equal(safeReturnTo('/jobs/job_1?x=1'), '/jobs/job_1?x=1');
  assert.equal(safeReturnTo('https://evil.example/'), '/');
  assert.equal(safeReturnTo('//evil.example/'), '/');
  assert.equal(safeReturnTo('/\\evil.example'), '/');
  assert.equal(safeReturnTo(undefined), '/');
});

test('All-Jobs Access comes from a configured group, with or without the group path slash', () => {
  assert.deepEqual(allJobsGroupsOf(['/admin'], ['admin', 'supervisor']), ['admin']);
  assert.deepEqual(allJobsGroupsOf(['supervisor', 'author', '/admin'], ['admin', 'supervisor']), ['supervisor', 'admin']);
  assert.deepEqual(allJobsGroupsOf(['/team/admin', 'author'], ['admin', 'supervisor']), []);
  assert.deepEqual(allJobsGroupsOf(undefined, ['admin']), []);
  assert.deepEqual(allJobsGroupsOf('/admin', ['admin', 'supervisor']), ['admin'], 'a single-valued mapper sends one group as a string');
  assert.deepEqual(allJobsGroupsOf(['admin', '/admin'], ['admin']), ['admin'], 'a group listed twice counts once');
});

test('sign-in settings are required and the session secret must be long', () => {
  const env = {
    KEYCLOAK_ISSUER_URL: 'https://keycloak.example/realms/test',
    KEYCLOAK_CLIENT_ID: 'envisio-test',
    SESSION_SECRET: SECRET,
    APP_URL: 'https://envisio.example/',
  };
  const config = readAuthConfig(env);
  assert.equal(config.appUrl, 'https://envisio.example');
  assert.deepEqual(config.allJobsGroups, ['admin', 'supervisor']);
  assert.deepEqual(readAuthConfig({ ...env, AUTH_ALL_JOBS_GROUPS: ' lead , admin ' }).allJobsGroups, ['lead', 'admin']);
  assert.throws(() => readAuthConfig({ ...env, KEYCLOAK_CLIENT_ID: '' }), /KEYCLOAK_CLIENT_ID/);
  assert.throws(() => readAuthConfig({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.throws(() => readAuthConfig({ ...env, APP_URL: 'not a url' }), /APP_URL/);
  assert.throws(() => readAuthConfig({ ...env, APP_URL: 'localhost:3003' }), /APP_URL must start with http/);
});

test('sealSession keeps normal idToken and drops oversized idToken to stay under 3,800 bytes', () => {
  const base: AuthorSession = { sub: 'sub-1', email: 'a@example.com', name: 'Author', allJobs: false };
  const normal = sealSession(SECRET, { ...base, idToken: 'header.payload.sig' });
  assert.equal(unsealValue<AuthorSession>(SECRET, 'session', normal)?.idToken, 'header.payload.sig');

  const trimmed = sealSession(SECRET, { ...base, idToken: 'x'.repeat(4000) });
  assert.ok(Buffer.byteLength(`${SESSION_COOKIE}=${trimmed}`, 'utf8') <= 3800);
  const opened = unsealValue<AuthorSession>(SECRET, 'session', trimmed);
  assert.deepEqual(opened, base);
});

test('authorEmailFromClaims trims email and preferred_username before falling back', () => {
  assert.equal(authorEmailFromClaims({ email: '  user@example.com  ', preferred_username: 'user', sub: 'sub-1' }), 'user@example.com');
  assert.equal(authorEmailFromClaims({ email: '   ', preferred_username: '  user  ', sub: 'sub-1' }), 'user');
  assert.equal(authorEmailFromClaims({ email: '', preferred_username: '   ', sub: ' sub-1 ' }), 'sub-1');
});
