import { BRAND } from '@/lib/brand';

// Confirmed public contact channels. Legal / provider details that are not
// established by the repository are tracked in the operational checklist.
export const SERVICE_POLICIES = {
  reviewedAt: '2026-10-07',
  effectiveDate: '2026-10-07',
  effectiveDateLabel: '2026년 10월 7일',
  supportEmail: 'support@askio.quest',
  privacyContactEmail: 'privacy@askio.quest',
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
