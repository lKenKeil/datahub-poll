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
const { fetchPollVoteIdentity } = mod.exports;
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
  console.log('PASS changed-query bootstrap ordering, poll/actor transition ordering, stable cookie, unchanged request options and recovery after failed reads. No live requests.');
} finally {
  globalThis.fetch = originalFetch;
}
