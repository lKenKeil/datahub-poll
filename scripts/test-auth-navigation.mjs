// Exercise actual modal/OAuth/OTP handlers without credentials, email or DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

let hooks;
const react = {
  createContext: () => ({ Provider: 'provider' }),
  useState(initial) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    const active = hooks;
    return [active.slots[index], (value) => {
      active.slots[index] = typeof value === 'function' ? value(active.slots[index]) : value;
    }];
  },
  useRef(initial) {
    const index = hooks.index++;
    return hooks.slots[index] ??= { current: initial };
  },
  useEffect() { hooks.index++; },
  useCallback(callback) { hooks.index++; return callback; },
  useId() { hooks.index++; return 'auth-test'; },
  useSyncExternalStore(_subscribe, snapshot) { hooks.index++; return snapshot(); },
};
const jsx = (type, props) => ({ type, props });
const navigation = [];
const router = { replace: (path) => navigation.push(path), refresh: () => {} };
const oauth = [];
const links = [];
const flowCalls = [];
const emailCalls = [];
const client = { auth: {
  async signInWithOAuth(payload) {
    oauth.push(payload);
    return { data: { url: 'https://provider.example.invalid' }, error: null };
  },
  async linkIdentity(payload) {
    links.push(payload);
    return { data: { url: 'https://provider.example.invalid/link' }, error: null };
  },
  async signInWithOtp(payload) { emailCalls.push(['send', payload]); return { error: null }; },
  async verifyOtp(payload) {
    emailCalls.push(['verify', payload]);
    return { data: { session: { access_token: 'mock-only' } }, error: null };
  },
} };
const mocks = {
  react,
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'next/navigation': { useRouter: () => router },
  '@/lib/supabase-auth-browser': { getSupabaseAuthBrowserClient: () => client },
  '@/components/profile-onboarding': { ProfileOnboarding: () => null },
  '@/components/policy-links': { PolicyLinks: () => null },
  '@/lib/profile': { parseAccountProfile: () => null },
};
function load(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, (name) => {
    if (!Object.hasOwn(mocks, name)) throw new Error(`Unexpected test dependency: ${name}`);
    return mocks[name];
  });
  return mod.exports;
}
mocks['@/lib/auth-redirect'] = load('lib/auth-redirect.ts');
mocks['@/lib/auth-flow'] = load('lib/auth-flow.ts');
mocks['@/lib/auth-flow-client'] = load('lib/auth-flow-client.ts');
mocks['@/lib/email-auth'] = load('lib/email-auth.ts');
mocks['@/components/auth-email-form'] = load('components/auth-email-form.tsx');
const { AuthProvider, OAuthButtons } = load('components/auth-provider.tsx');
const { EmailAuthForm } = mocks['@/components/auth-email-form'];
function renderer(component, props) {
  const state = { slots: [], index: 0 };
  return () => { hooks = state; state.index = 0; return component(props); };
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean) ?? null;
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
async function submitForm(render) {
  // React's event wrapper intentionally returns void; let its async handler
  // finish before the next explicit mock render.
  render().props.onSubmit({ preventDefault() {} });
  await new Promise(setImmediate);
}
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
try {
  const target = '/vote/seed_v1_entertainment-webtoon-release?comments=latest&q=two%20words#opinions';
  globalThis.window = { location: {
    origin: 'https://askio.example.invalid',
    pathname: target.split('?')[0], search: '?comments=latest&q=two%20words', hash: '#opinions',
    assign: (value) => navigation.push(value),
  }, localStorage: { getItem: () => null, setItem() {} }, dispatchEvent() {} };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/auth/flow');
    const body = JSON.parse(options.body);
    flowCalls.push(body);
    return { ok: true, json: async () => ({ ok: true, returnTo: target }) };
  };
  const renderProvider = renderer(AuthProvider, { children: null });
  renderProvider().props.value.openLogin();
  let request = find(renderProvider(), (node) => Boolean(node.props?.request))?.props.request;
  assert.equal(request.returnTo, target, 'modal captures exact opening page, search and fragment');
  for (const provider of ['google', 'kakao']) {
    const render = renderer(OAuthButtons, { returnTo: request.returnTo });
    const label = provider === 'google' ? 'Google로 계속하기' : '카카오로 계속하기';
    await find(render(), (node) => node.type === 'button' && node.props.children === label).props.onClick();
    await new Promise(setImmediate);
    const call = oauth.pop();
    assert.equal(call.provider, provider);
    const callback = new URL(call.options.redirectTo);
    assert.equal(callback.origin, window.location.origin);
    assert.equal(callback.pathname, '/auth/callback');
    assert.equal(callback.search, '', 'fixed callback URL does not depend on wildcard query allowlisting');
    assert.deepEqual(flowCalls.pop(), { action: 'start', mode: 'login', provider, returnTo: target });
  }
  navigation.length = 0;
  const renderEmail = renderer(EmailAuthForm, { returnTo: request.returnTo, disabled: false, onBusyChange() {} });
  find(renderEmail(), (node) => node.type === 'input' && node.props.type === 'email').props.onChange({ target: { value: 'test@example.invalid' } });
  await submitForm(renderEmail);
  find(renderEmail(), (node) => node.type === 'input' && node.props.autoComplete === 'one-time-code').props.onChange({ target: { value: '123456' } });
  await submitForm(renderEmail);
  assert.deepEqual(navigation, [target], 'successful OTP returns to captured poll, never hard-coded home');
  assert.deepEqual(emailCalls.map(([kind]) => kind), ['send', 'verify']);
  assert.deepEqual(flowCalls.slice(-2), [
    { action: 'start', mode: 'login', provider: 'email', returnTo: target },
    { action: 'complete-email' },
  ]);
  const link = await mocks['@/lib/auth-flow-client'].startOAuthFlow({ mode: 'link', provider: 'kakao', returnTo: '/profile' });
  assert.equal(link.ok, true);
  assert.equal(links.length, 1, 'manual linking uses linkIdentity, not signInWithOAuth');
  assert.equal(new URL(links[0].options.redirectTo).pathname, '/auth/callback/link');
  assert.equal(oauth.length, 0);
  renderProvider().props.value.openLogin(undefined, '/create?from=header');
  request = find(renderProvider(), (node) => Boolean(node.props?.request))?.props.request;
  assert.equal(request.returnTo, '/create?from=header');
  for (const unsafe of ['https://evil.invalid', '//evil.invalid', 'javascript:alert(1)', '/%5cevil.invalid', '/%0aevil']) {
    renderProvider().props.value.openLogin(undefined, unsafe);
    request = find(renderProvider(), (node) => Boolean(node.props?.request))?.props.request;
    assert.equal(request.returnTo, '/');
  }
  console.log('PASS modal context, Google/Kakao durable intent with fixed callback, OTP return, explicit linkIdentity, safe destination and open-redirect rejection. No live Auth/DB calls.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
