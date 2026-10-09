// Private identities are reduced locally; no env, remote account or DB access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/auth-login-methods.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', compiled)(mod, mod.exports);
const { getLinkedLoginMethods, getIdentityLinkFeedback } = mod.exports;
const identity = provider => ({ user_id: 'account-a', provider, id: 'private-provider-id', identity_data: { email: 'private@example.invalid' } });
assert.deepEqual(getLinkedLoginMethods([identity('google')], 'account-a'), { google: true, kakao: false, email: false });
assert.deepEqual(getLinkedLoginMethods([identity('kakao')], 'account-a'), { google: false, kakao: true, email: false });
assert.deepEqual(getLinkedLoginMethods([identity('google'), identity('kakao'), identity('email')], 'account-a'), { google: true, kakao: true, email: true });
assert.deepEqual(getLinkedLoginMethods([identity('unsupported')], 'account-a'), { google: false, kakao: false, email: false });
assert.deepEqual(getLinkedLoginMethods([], 'account-a'), { google: false, kakao: false, email: false });
for (const identities of [null, {}, [null], ['google'], [{ provider: 'google', user_id: 'account-b' }]]) {
  assert.equal(getLinkedLoginMethods(identities, 'account-a'), null);
}
assert.equal(getLinkedLoginMethods([identity('google')], ''), null);
const serialized = JSON.stringify(getLinkedLoginMethods([identity('google')], 'account-a'));
for (const sensitive of ['email@', 'private', 'account-a', 'user_id', 'identity_data']) assert.ok(!serialized.includes(sensitive));
assert.deepEqual(getIdentityLinkFeedback('identity_already_exists'), { error: true, message: '이 로그인 방법은 이미 다른 Askio 계정에 연결되어 있어요.' });
assert.equal(getIdentityLinkFeedback('success').error, false);
assert.equal(getIdentityLinkFeedback('failed').error, true);
for (const invalid of [null, '', 'private-provider-error', 'identity_not_found']) assert.equal(getIdentityLinkFeedback(invalid), null);
const component = readFileSync(new URL('../components/profile-login-methods.tsx', import.meta.url), 'utf8');
assert.match(component, /auth\.getUserIdentities\(\)/);
assert.match(component, /startOAuthFlow\(\{ mode: 'link', provider, returnTo: '\/profile' \}\)/);
assert.ok(!component.includes('signInWithOAuth') && !component.includes('unlinkIdentity'));
assert.ok(!component.includes('identity_data') && !component.includes('data.email'));
assert.match(component, /if \(!active\) return/);
assert.match(component, /if \(!mounted\.current\) return/);
assert.match(component, /data\.user\.id !== userId/);
console.log('PASS profile login method privacy, canonical-account/stale response checks, explicit link flow, safe conflict/callback messages and truthful Email summary. No live accounts or mutations.');
