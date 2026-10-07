// Read-only component and metadata regression. No auth, email or DB requests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const mocks = {
  'react/jsx-runtime': jsxRuntime,
  'next/link': { default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
  '@/components/auth-button': { AuthButton: () => React.createElement('button', null, '로그인') },
  '@/components/theme-toggle': { ThemeToggle: () => React.createElement('button', null, '테마') },
  '@/components/brand-home-link': { BrandHomeLink: () => React.createElement('a', { href: '/', 'aria-label': 'Askio 홈' }, 'Askio') },
};
function load(path) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, (name) => {
    if (!Object.hasOwn(mocks, name)) throw new Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  });
  return mod.exports;
}
mocks['@/lib/brand'] = load('lib/brand.ts');
mocks['@/lib/service-policies'] = load('lib/service-policies.ts');
mocks['@/components/policy-links'] = load('components/policy-links.tsx');
mocks['@/components/policy-document'] = load('components/policy-document.tsx');
const { SERVICE_POLICIES } = mocks['@/lib/service-policies'];
assert.equal(SERVICE_POLICIES.operatorName, null, 'do not invent an operator');
assert.equal(SERVICE_POLICIES.privacyContactEmail, null, 'do not invent a contact');
assert.equal(SERVICE_POLICIES.effectiveDate, null, 'draft is not an effective final policy');

for (const [name, title, sectionCount] of [
  ['privacy', '개인정보처리방침', 16], ['terms', '서비스 이용약관', 20],
]) {
  const page = load(`app/${name}/page.tsx`);
  assert.equal(page.metadata.title.absolute, `${title} | Askio`);
  assert.equal(page.metadata.alternates.canonical, `https://askio.quest/${name}`);
  assert.ok(page.metadata.description);
  const html = renderToStaticMarkup(React.createElement(page.default));
  assert.equal((html.match(/<h1 /g) ?? []).length, 1);
  assert.equal((html.match(/<h2 /g) ?? []).length, sectionCount);
  assert.match(html, /공개 전 검토 초안/);
  assert.match(html, /시행일: 정식 공개 전 확정 예정/);
  assert.match(html, /문의 이메일과 담당자를 확인 중/);
  assert.doesNotMatch(html, /GUEST_ID_SECRET|HMAC|access_token|service_role/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
}
const privacy = renderToStaticMarkup(React.createElement(load('app/privacy/page.tsx').default));
assert.match(privacy, /내부 계정 연결/);
assert.match(privacy, /URL을 아는 사람의 접근이 철회되는 것은 아닙니다/);
assert.match(privacy, /URL의 검색어 또는 페이지 제목/);
assert.match(privacy, /쿠키 삭제만으로 향후 분석 전송이 중단되는 것도 아닙니다/);
const terms = renderToStaticMarkup(React.createElement(load('app/terms/page.tsx').default));
assert.match(terms, /과학적 여론조사나 대표 표본 조사가 아니며/);
assert.match(terms, /고의·과실/);
assert.match(terms, /권리는 해당 이용자 또는 원 권리자에게 남습니다/);
const { PolicyLinks } = mocks['@/components/policy-links'];
const authLinks = renderToStaticMarkup(React.createElement(PolicyLinks, { newTab: true }));
assert.equal((authLinks.match(/target="_blank"/g) ?? []).length, 2);
assert.equal((authLinks.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
assert.equal((authLinks.match(/새 탭/g) ?? []).length, 2);
assert.doesNotMatch(authLinks, /동의한 것으로|동의합니다/);
const footer = renderToStaticMarkup(React.createElement(load('components/site-footer.tsx').SiteFooter));
assert.match(footer, /<footer/);
assert.match(footer, /Askio/);
assert.doesNotMatch(footer, /target="_blank"/);
console.log('PASS service policy pages, draft gates, metadata, privacy caveats, footer/auth links');
