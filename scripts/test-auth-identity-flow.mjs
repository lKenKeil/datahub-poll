// Exercise actual signed-cookie/callback/SDK helpers. No real Auth or DB calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const jar = new Map();
const writes = [];
const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
let user = { id: USER_A, is_anonymous: false };
let exchangeUser;
let exchangeError = null;
let exchangeCalls = 0;
let signOutCalls = 0;
const client = { auth: {
  async getUser() { return { data: { user }, error: null }; },
  async exchangeCodeForSession() {
    exchangeCalls++;
    if (exchangeUser !== undefined) user = exchangeUser;
    return { error: exchangeError };
  },
  async signOut() { signOutCalls++; user = null; return { error: null }; },
} };
const mocks = {
  'server-only': {},
  'next/server': require('next/server'),
  'next/headers': { cookies: async () => ({
    get: (name) => jar.has(name) ? { value: jar.get(name) } : undefined,
    set(name, value, options) {
      writes.push({ name, value, options });
      if (options.maxAge === 0) jar.delete(name); else jar.set(name, value);
    },
  }) },
  '@/lib/supabase-auth-server': { createSupabaseAuthServerClient: async () => client },
};
function load(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  });
  return mod.exports;
}
const oldSecret = process.env.GUEST_ID_SECRET;
const oldNodeEnv = process.env.NODE_ENV;
process.env.GUEST_ID_SECRET = 'test-secret-not-a-production-credential';
process.env.NODE_ENV = 'production';
try {
  mocks['@/lib/auth-redirect'] = load('lib/auth-redirect.ts');
  assert.equal(mocks['@/lib/auth-redirect'].getSafeAuthReturnPath('/' + '가'.repeat(500)), '/', 'normalized return path stays within signed-cookie size limits');
  mocks['@/lib/auth-flow'] = load('lib/auth-flow.ts');
  mocks['@/lib/auth-flow-server'] = load('lib/auth-flow-server.ts');
  mocks['@/lib/auth-callback'] = load('lib/auth-callback.ts');
  const { POST } = load('app/api/auth/flow/route.ts');
  const loginCallback = load('app/auth/callback/route.ts').GET;
  const linkCallback = load('app/auth/callback/link/route.ts').GET;
  const call = (body, origin = 'https://askio.example.invalid') => POST(new Request('https://askio.example.invalid/api/auth/flow', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  const target = '/vote/P?comments=latest&q=two%20words#opinions';
  for (const provider of ['google', 'kakao']) {
    const response = await call({ action: 'start', mode: 'login', provider, returnTo: target });
    assert.equal(response.status, 200);
    const cookie = writes.findLast((row) => row.name === 'askio_auth_return_to' && row.options.maxAge);
    assert.equal(cookie.options.httpOnly, true);
    assert.equal(cookie.options.secure, true);
    assert.equal(cookie.options.sameSite, 'lax');
    assert.equal(cookie.options.maxAge, 600);
    const callback = await loginCallback(new Request('https://askio.example.invalid/auth/callback?code=mock-code'));
    assert.equal(callback.headers.get('location'), `https://askio.example.invalid${target}`, 'lost next query still returns to exact poll');
    assert.equal(jar.has('askio_auth_return_to'), false);
    const recent = await call({ action: 'recent-provider' });
    assert.deepEqual(await recent.json(), { ok: true, provider });
    assert.deepEqual(await (await call({ action: 'recent-provider' })).json(), { ok: true, provider: null }, 'receipt consumed only once');
  }
  await call({ action: 'start', mode: 'login', provider: 'google', returnTo: target });
  const cookieValue = jar.get('askio_auth_return_to');
  jar.set('askio_auth_return_to', `${cookieValue}tampered`);
  const before = exchangeCalls;
  const tampered = await loginCallback(new Request('https://askio.example.invalid/auth/callback?code=mock-code&next=//evil.invalid'));
  assert.equal(exchangeCalls, before, 'tampered intent cannot downgrade to ordinary sign-in');
  assert.equal(new URL(tampered.headers.get('location')).pathname, '/auth/login');
  assert.equal((await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' }, 'https://evil.invalid')).status, 403);
  user = null;
  assert.equal((await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' })).status, 401);
  user = { id: USER_A, is_anonymous: false };
  const missing = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(new URL(missing.headers.get('location')).searchParams.get('auth_link'), 'failed');
  assert.equal(exchangeCalls, before);
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  user = { id: USER_B, is_anonymous: false };
  await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(exchangeCalls, before, 'changed current session cannot finish someone else’s linking intent');
  user = { id: USER_A, is_anonymous: false };
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  exchangeUser = { id: USER_B, is_anonymous: false };
  const mismatch = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(signOutCalls, 1, 'a different canonical user must not remain signed in as a successful link');
  assert.equal(new URL(mismatch.headers.get('location')).searchParams.get('auth_link'), 'failed');
  exchangeUser = undefined;
  user = { id: USER_A, is_anonymous: false };
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  const conflict = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?error=access_denied&error_code=identity_already_exists&error_description=private-value'));
  assert.equal(new URL(conflict.headers.get('location')).searchParams.get('auth_link'), 'identity_already_exists');
  assert.equal(conflict.headers.get('location').includes('private-value'), false);
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  exchangeError = { code: 'identity_already_exists', message: 'private-error' };
  const exchangeConflict = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(new URL(exchangeConflict.headers.get('location')).searchParams.get('auth_link'), 'identity_already_exists');
  assert.equal(exchangeConflict.headers.get('location').includes('private-error'), false);
  exchangeError = null;
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  const unlinked = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(new URL(unlinked.headers.get('location')).searchParams.get('auth_link'), 'failed', 'same account alone is insufficient proof of a linked provider');
  user = { id: USER_A, is_anonymous: false, identities: [{ provider: 'kakao', user_id: USER_A }] };
  await call({ action: 'start', mode: 'link', provider: 'kakao', returnTo: '/profile' });
  const linked = await linkCallback(new Request('https://askio.example.invalid/auth/callback/link?code=mock-code'));
  assert.equal(new URL(linked.headers.get('location')).searchParams.get('auth_link'), 'success');
  assert.equal(jar.has('askio_auth_success'), false, 'linking is not a new login preference');
  await call({ action: 'start', mode: 'login', provider: 'email', returnTo: target });
  assert.deepEqual(await (await call({ action: 'complete-email' })).json(), { ok: true, returnTo: target });
  assert.equal(jar.has('askio_auth_return_to'), false);
  for (const unsafe of ['//evil.invalid', 'https://evil.invalid', 'javascript:alert(1)', '/%5cevil.invalid', '/%255cevil.invalid', '/%252f%252fevil.invalid', '/%0aevil', '/auth/callback', '/%2561uth/callback', '/api/private']) {
    assert.equal(mocks['@/lib/auth-redirect'].getSafeAuthReturnPath(unsafe), '/');
  }
  assert.equal(mocks['@/lib/auth-redirect'].getSafeAuthReturnPath('/vote/P?q=100%25ab'), '/vote/P?q=100%25ab', 'normal query percent signs survive unchanged');
  const stored = new Map();
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value) }, dispatchEvent() {} };
  try {
    for (const provider of ['google', 'kakao', 'email']) {
      mocks['@/lib/auth-flow'].rememberLoginProvider(provider);
      assert.equal(mocks['@/lib/auth-flow'].getLastLoginProvider(), provider);
    }
    stored.set('askio_last_login_provider', 'untrusted');
    assert.equal(mocks['@/lib/auth-flow'].getLastLoginProvider(), null);
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
  console.log('PASS durable Google/Kakao/Email return, signed 10-minute HttpOnly cookies, receipt one-shot, recent provider allowlist, same-origin guard, link canonical-session checks, conflicts and open redirects. No live Auth/DB calls.');
} finally {
  if (oldSecret === undefined) delete process.env.GUEST_ID_SECRET; else process.env.GUEST_ID_SECRET = oldSecret;
  if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
}
