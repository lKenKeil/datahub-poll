// Deterministic Auth contract tests: no env, email sending, remote login or DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL('../lib/email-auth.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, require);
const { normalizeLoginEmail, sendEmailLoginCode, verifyEmailLoginCode } = mod.exports;
const calls = [];
let failure = null;
let throws = false;
let session = null;
const client = { auth: {
  async signInWithOtp(value) { calls.push(['send', value]); if (throws) throw new Error('private-error'); return { error: failure }; },
  async verifyOtp(value) { calls.push(['verify', value]); if (throws) throw new Error('private-error'); return { data: { session }, error: failure }; },
} };

assert.equal(normalizeLoginEmail('  member@example.invalid  '), 'member@example.invalid');
for (const email of ['', 'bad', 'member@', 'member@example.invalid\u0000', 'a b@example.invalid', 'x'.repeat(250) + '@example.invalid']) {
  assert.equal(normalizeLoginEmail(email), null);
}
assert.equal(await sendEmailLoginCode(client, 'member@example.invalid'), true);
assert.deepEqual(calls.pop(), ['send', { email: 'member@example.invalid', options: { shouldCreateUser: true } }]);
for (const code of ['12345', '1234567', '12345a', '１２３４５６']) assert.equal(await verifyEmailLoginCode(client, 'member@example.invalid', code), false);
assert.equal(calls.length, 0);
assert.equal(await verifyEmailLoginCode(client, 'member@example.invalid', '123456'), false);
session = { access_token: 'private-access-token', refresh_token: 'private-refresh-token' };
assert.equal(await verifyEmailLoginCode(client, 'member@example.invalid', '123456'), true);
assert.deepEqual(calls.pop(), ['verify', { email: 'member@example.invalid', token: '123456', type: 'email' }]);
for (const code of ['user_already_exists', 'user_not_found', 'over_email_send_rate_limit', 'otp_expired']) {
  failure = { code, message: 'private-auth-error' };
  assert.equal(await sendEmailLoginCode(client, 'member@example.invalid'), false);
  assert.equal(await verifyEmailLoginCode(client, 'member@example.invalid', '123456'), false);
}
failure = null;
throws = true;
assert.equal(await sendEmailLoginCode(client, 'member@example.invalid'), false);
assert.equal(await verifyEmailLoginCode(client, 'member@example.invalid', '123456'), false);
console.log('PASS Email OTP send/verify, signup option, six-digit validation, enumeration-neutral errors, exception/session safety. No emails or live mutations.');
