import assert from 'node:assert/strict';
import test from 'node:test';
import { hasAllJobsAccess, readAuthConfig, safeReturnTo } from './auth';
import { readCookie, sealValue, unsealValue } from './session';

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
  assert.equal(hasAllJobsAccess(['/admin'], ['admin', 'supervisor']), true);
  assert.equal(hasAllJobsAccess(['supervisor'], ['admin', 'supervisor']), true);
  assert.equal(hasAllJobsAccess(['/team/admin', 'author'], ['admin', 'supervisor']), false);
  assert.equal(hasAllJobsAccess(undefined, ['admin']), false);
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
