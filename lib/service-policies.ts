import { BRAND } from '@/lib/brand';

// Release gate: replace the pending values only after the operator confirms
// the contact channel and reviews retention / processor / transfer details.
export const SERVICE_POLICIES = {
  reviewedAt: '2026-10-07',
  effectiveDate: null as string | null,
  operatorName: null as string | null,
  privacyContactEmail: null as string | null,
  privacy: {
    href: '/privacy',
    title: `개인정보처리방침 | ${BRAND.name}`,
    description: `${BRAND.name}의 회원·비회원 정보, 로그인, 콘텐츠, 쿠키 및 분석 서비스 처리에 관한 안내입니다.`,
    canonical: 'https://askio.quest/privacy',
  },
  terms: {
    href: '/terms',
    title: `서비스 이용약관 | ${BRAND.name}`,
    description: `${BRAND.name}의 질문, 투표, 의견 나누기와 콘텐츠 운영에 관한 이용약관입니다.`,
    canonical: 'https://askio.quest/terms',
  },
} as const;
