// The late Set-Cookie race must stay fixed without network/Auth/DB access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/poll-vote-identity-request.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { claimPollVoteIdentity, fetchPollVoteIdentity, isPollVoteIdentityReady } = mod.exports;
const originalFetch = globalThis.fetch;
let browserCookie = null;
const requests = [];
globalThis.fetch = (input, init) => {
  const cookie = browserCookie ?? `mock-cookie-${requests.length + 1}`;
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  const request = { input, init, cookie,
    finish() { browserCookie = cookie; resolve(new Response('{}')); },
    fail() { reject(new Error('mock network failure')); },
  };
  requests.push(request);
  return promise;
};
const flush = () => new Promise(setImmediate);
try {
  const options = { cache: 'no-store', headers: { 'x-voter-id': 'mock-legacy-header' } };
  const first = fetchPollVoteIdentity('/api/polls/P?comments=likes', options);
  const queryChanged = fetchPollVoteIdentity('/api/polls/P?comments=latest', options);
  await flush();
  assert.equal(requests.length, 1, 'a changed query must wait until the first identity response sets its cookie');
  assert.equal(requests[0].init, options, 'keep caller fetch options unchanged');
  requests[0].finish();
  await first;
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].cookie, requests[0].cookie, 'next request uses the same browser identity');
  // A new poll/actor after a page unmount shares the module queue as well.
  const claimOptions = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
  const accountClaim = fetchPollVoteIdentity('/api/polls/Q/vote/claim', claimOptions);
  await flush();
  assert.equal(requests.length, 2, 'poll/actor transition cannot overtake a pending identity response');
  const rejected = queryChanged.catch(error => error);
  requests[1].fail();
  assert.match((await rejected).message, /mock network failure/);
  await flush();
  assert.equal(requests.length, 3, 'failed reads do not poison later retry/claim requests');
  assert.equal(requests[2].cookie, requests[0].cookie);
  assert.equal(requests[2].init, claimOptions);
  requests[2].finish();
  await accountClaim;
  const retry = fetchPollVoteIdentity('/api/polls/Q');
  await flush();
  requests[3].finish();
  assert.ok((await retry) instanceof Response);
  assert.ok(requests.every(request => request.cookie === requests[0].cookie));
  for (const signedIn of [true, false]) {
    for (const unresolved of [undefined, null, 'unavailable', 'invalid', {}]) {
      assert.equal(isPollVoteIdentityReady(unresolved, signedIn), false);
    }
    assert.equal(isPollVoteIdentityReady(signedIn ? 'account' : 'guest', signedIn), true);
    assert.equal(isPollVoteIdentityReady(signedIn ? 'guest' : 'account', signedIn), false);
  }
  const claimCalls = [];
  let claimReply = { mode: 'rpc', viewerIdentityStatus: 'guest', data: null };
  let claimStatus = 200;
  let invalidJson = false;
  let failNetwork = false;
  globalThis.fetch = async (input, init) => {
    claimCalls.push({ input, init });
    if (failNetwork) throw new Error('mock-only failure');
    return new Response(invalidJson ? 'not-json' : JSON.stringify(claimReply), { status: claimStatus });
  };
  assert.equal(await claimPollVoteIdentity('P', '', true), false,
    'account hydration must not accept a successful guest claim as account reconciliation');
  assert.equal(await claimPollVoteIdentity('P', '', false), true);
  for (const provider of ['google', 'kakao']) {
    claimReply = { mode: 'rpc', viewerIdentityStatus: 'unavailable', data: null };
    assert.equal(await claimPollVoteIdentity('P', '', true), false, `${provider}: unknown viewer never means unvoted`);
    claimReply = { mode: 'rpc', viewerIdentityStatus: 'account', data: { optionIndex: 0 } };
    assert.equal(await claimPollVoteIdentity('P', 'mock-legacy-id', true), true, `${provider}: retry can claim after cookie hydration`);
    assert.deepEqual(JSON.parse(claimCalls.at(-1).init.body), { voterId: 'mock-legacy-id' });
    assert.equal(claimCalls.at(-1).input, '/api/polls/P/vote/claim');
  }
  claimReply = { viewerIdentityStatus: 'account' };
  assert.equal(await claimPollVoteIdentity('P', '', true), false, 'unexpected HTTP 200 body is not claim success');
  claimReply = { mode: 'rpc', viewerIdentityStatus: 'account', data: null };
  claimStatus = 503;
  assert.equal(await claimPollVoteIdentity('P', '', true), false);
  claimStatus = 200; invalidJson = true;
  assert.equal(await claimPollVoteIdentity('P', '', true), false);
  invalidJson = false; failNetwork = true;
  assert.equal(await claimPollVoteIdentity('P', '', true), false);
  failNetwork = false;
  assert.equal(await claimPollVoteIdentity('P', '', true), true,
    'failures do not poison a later reconciliation request');
  console.log('PASS changed-query bootstrap ordering, poll/actor transition ordering, stable cookie, unchanged request options and recovery after failed reads. No live requests.');
  console.log('PASS guest/account mode verification, Google/Kakao claim retries, malformed/unavailable/failed claim safety. No live requests.');
} finally {
  globalThis.fetch = originalFetch;
}
