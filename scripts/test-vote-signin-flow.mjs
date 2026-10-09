// Render the actual VotePage with deterministic hooks and mocked transports.
// No env files, OAuth accounts, network access, emails, or live DB mutations.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
const compile = (file) => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const pageCode = compile('../app/vote/[id]/page.tsx');
const identityCode = compile('../lib/poll-vote-identity-request.ts');
const original = Object.fromEntries(['fetch', 'window', 'localStorage', 'setInterval', 'clearInterval']
  .map(key => [key, { present: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
const tick = () => new Promise(setImmediate);
const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function harness(provider) {
  let auth = { user: null, profile: null, loading: true, openLogin() {} };
  let dirty = true;
  let cursor = 0;
  let tree;
  const cells = [];
  const effects = [];
  const intervals = new Map();
  const calls = [];
  let intervalId = 0;
  let nextClaim = deferred();
  let nextRead = deferred();
  const poll = { id: 'custom_mock-signin', title: '모의 질문', category: '커뮤니티',
    options: ['모의 선택 A', '모의 선택 B'], votes: [1, 0], participants: 1,
    option_image_paths: null };
  const viewer = { optionIndex: 0, canChangeVote: true, canCancelVote: true, managementToken: 'a'.repeat(64) };
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  globalThis.window = { location: { search: '?comments=latest' }, addEventListener() {}, removeEventListener() {} };
  globalThis.setInterval = callback => { intervals.set(++intervalId, callback); return intervalId; };
  globalThis.clearInterval = id => intervals.delete(id);
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init });
    if (input === '/api/polls') return Response.json({ data: [] });
    if (input.endsWith('/vote/claim')) return nextClaim.promise;
    if (input.startsWith(`/api/polls/${poll.id}?`)) return nextRead.promise;
    if (input.endsWith('/vote')) throw new Error('Unexpected fresh vote mutation during sign-in.');
    throw new Error(`Unexpected mock request ${input}`);
  };
  const hooks = {
    use: () => ({ id: poll.id }),
    useState(initial) {
      const index = cursor++;
      const cell = cells[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [cell.value, next => {
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (!Object.is(value, cell.value)) { cell.value = value; dirty = true; }
      }];
    },
    useRef(initial) { return (cells[cursor++] ??= { ref: { current: initial } }).ref; },
    useMemo(compute, deps) {
      const index = cursor++;
      if (!sameDeps(cells[index]?.deps, deps)) cells[index] = { deps, value: compute() };
      return cells[index].value;
    },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(callback, deps) {
      const index = cursor++;
      const cell = cells[index] ??= {};
      if (!sameDeps(cell.deps, deps)) { cell.deps = deps; effects.push(() => { cell.cleanup?.(); cell.cleanup = callback(); }); }
    },
  };
  const channel = { on() { return channel; }, subscribe() { return channel; } };
  const identityModule = { exports: {} };
  new Function('module', 'exports', identityCode)(identityModule, identityModule.exports);
  const stubs = {
    react: hooks,
    'react/jsx-runtime': nativeRequire('react/jsx-runtime'),
    'next/link': () => null, 'next/image': () => null,
    '@/components/auth-provider': { useAuth: () => auth },
    '@/lib/supabase': { supabase: { channel: () => channel, removeChannel: async () => {} } },
    '@/lib/voter-id': { getStoredLegacyVoterId: () => null },
    '@/lib/poll-vote-identity-request': identityModule.exports,
    '@/lib/poll-option-image-paths': { getPollOptionImagePublicUrl: () => null, normalizeOptionImagePaths: () => null },
    '@/lib/poll-owner-storage': { getStoredPollOwnerToken: () => null },
    '@/lib/poll-discovery': { selectNextPolls: () => [] },
    '@/lib/poll-discovery-session': { rememberPollVisit: () => [] },
    '@/lib/analytics': { trackNextPollClicked() {}, trackPollViewed() {}, trackVoteResultViewed() {}, trackVoteSubmitted() {} },
    '@/lib/content-reporting': { HIDDEN_COMMENT_PLACEHOLDER: '숨겨진 의견' },
    '@/lib/comment-sorting': { COMMENT_SORTS: { likes: '인기순', latest: '최신순' },
      parseCommentSort: value => value === 'latest' ? 'latest' : 'likes', sortComments: value => value },
    '../../../data/polls': { POLLS: [] },
  };
  const pageModule = { exports: {} };
  new Function('module', 'exports', 'require', pageCode)(pageModule, pageModule.exports, specifier => {
    if (Object.hasOwn(stubs, specifier)) return stubs[specifier];
    if (specifier.startsWith('@/components/')) return new Proxy({}, { get: () => () => null });
    throw new Error(`Unmocked VotePage import ${specifier}`);
  });
  function render() {
    let count = 0;
    while (dirty) {
      if (++count > 30) throw new Error('Unexpected hook render loop.');
      dirty = false; cursor = 0;
      tree = pageModule.exports.default({ params: Promise.resolve({ id: poll.id }) });
      for (const effect of effects.splice(0)) effect();
    }
  }
  async function flush() {
    for (let index = 0; index < 8; index++) { render(); await tick(); }
    render();
  }
  const text = node => node == null || typeof node === 'boolean' ? ''
    : typeof node === 'string' || typeof node === 'number' ? String(node)
      : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
  function nodes(node, result = []) {
    if (Array.isArray(node)) for (const child of node) nodes(child, result);
    else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); }
    return result;
  }
  const buttons = () => nodes(tree).filter(node => node.type === 'button');
  const freshButtons = () => buttons().filter(node => /모의 선택 [AB]/.test(text(node)));
  function assertNoFreshVote(label) {
    assert.ok(freshButtons().every(button => button.props.disabled === true), label);
    assert.equal(calls.filter(call => call.input.endsWith('/vote')).length, 0, label);
  }
  return {
    calls, poll, viewer, flush, render, text: () => text(tree), buttons, freshButtons, assertNoFreshVote,
    setAuth(loading, signedIn) { auth = { ...auth, loading, user: signedIn ? { id: 'mock-canonical-account', app_metadata: { provider } } : null }; dirty = true; },
    finishRead(status, hasVote) { nextRead.resolve(Response.json({ poll, comments: [], viewerVote: hasVote ? viewer : null, viewerIdentityStatus: status })); },
    finishClaim(status) { nextClaim.resolve(Response.json({ mode: 'rpc', viewerIdentityStatus: status, data: viewer })); },
    prepareRetry() { nextClaim = deferred(); nextRead = deferred(); },
    async retry() {
      const button = buttons().find(button => text(button) === '다시 확인');
      assert.ok(button, 'Unresolved viewer offers retry instead of fresh voting.');
      void button.props.onClick(); await flush();
    },
    cleanup() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

try {
  for (const provider of ['google', 'kakao']) {
    const test = harness(provider);
    try {
      await test.flush();
      assert.equal(test.calls.filter(call => call.input.endsWith('/vote/claim')).length, 0);
      test.assertNoFreshVote('Auth hydration never starts with a fresh POST window.');
      test.setAuth(false, false);
      await test.flush();
      test.finishRead('guest', true);
      await test.flush();
      assert.match(test.text(), /선택 변경/);
      assert.match(test.text(), /투표 취소/);
      test.prepareRetry();
      test.setAuth(false, true);
      await test.flush();
      assert.equal(test.calls.filter(call => call.input.endsWith('/vote/claim')).length, 1);
      const readCount = test.calls.filter(call => call.input.includes('?comments=')).length;
      test.assertNoFreshVote('Guest-to-account transition remains blocked while reconciliation is pending.');
      test.finishClaim('account');
      await test.flush();
      assert.equal(test.calls.filter(call => call.input.includes('?comments=')).length, readCount + 1,
        'Read follows, never overtakes, account reconciliation.');
      test.assertNoFreshVote('A claim HTTP 200 does not alone enable fresh voting.');
      // Auth fails only on the following public read. Original implementation
      // treated this successful null-viewer response as fresh participation.
      test.finishRead('unavailable', false);
      await test.flush();
      assert.match(test.text(), /기존 투표를 확인하지 못했어요/);
      test.assertNoFreshVote('Unverified public GET after successful claim never means unvoted.');
      test.prepareRetry();
      await test.retry();
      assert.equal(test.calls.filter(call => call.input.endsWith('/vote/claim')).length, 2,
        'Unresolved read invalidates the earlier claim and retries reconciliation.');
      test.finishClaim('guest');
      await test.flush();
      test.finishRead('guest', false);
      await test.flush();
      test.assertNoFreshVote('Server guest cookies cannot authorize browser account participation.');
      test.prepareRetry();
      await test.retry();
      assert.equal(test.calls.filter(call => call.input.endsWith('/vote/claim')).length, 3,
        'Mismatched claim is not retained as a successful account claim.');
      test.finishClaim('account');
      await test.flush();
      test.finishRead('account', true);
      await test.flush();
      assert.match(test.text(), /모의 선택 A ✓/);
      const change = test.buttons().find(button => button.props.children === '선택 변경');
      assert.ok(change && change.props.disabled === false);
      const cancel = test.buttons().find(button => button.props.children === '투표 취소');
      assert.ok(cancel && cancel.props.disabled === false);
      assert.doesNotMatch(test.text(), /기존 투표를 확인하지 못했어요/);
      test.assertNoFreshVote('Recovered existing ballot remains result/change/cancel, not a new POST.');
      console.log(`PASS ${provider}: actual VotePage hydration, pending claim, post-claim Auth outage, guest-cookie mismatch, retry and restored result controls. No live requests.`);
    } finally { test.cleanup(); }
    const unvoted = harness(provider);
    try {
      unvoted.setAuth(false, false);
      await unvoted.flush();
      unvoted.finishRead('guest', false);
      await unvoted.flush();
      assert.equal(unvoted.freshButtons().length, 2, 'Harness detects real unvoted option buttons.');
      assert.ok(unvoted.freshButtons().every(button => button.props.disabled === false),
        'Verified, unvoted guests still participate normally.');
      unvoted.prepareRetry(); unvoted.setAuth(false, true);
      await unvoted.flush();
      unvoted.assertNoFreshVote('Previously unvoted controls close immediately on account transition.');
      unvoted.finishClaim('account'); await unvoted.flush();
      unvoted.finishRead('account', false); await unvoted.flush();
      assert.equal(unvoted.freshButtons().length, 2);
      assert.ok(unvoted.freshButtons().every(button => button.props.disabled === false),
        'A verified, reconciled account with no ballot can still cast its first vote.');
    } finally { unvoted.cleanup(); }
  }
} finally {
  for (const [key, state] of Object.entries(original)) {
    if (state.present) globalThis[key] = state.value;
    else delete globalThis[key];
  }
}
