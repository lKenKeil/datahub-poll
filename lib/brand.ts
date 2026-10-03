const name = 'Askio';
const siteTitle = `${name} | 검색해도 안 나오는 사소한 궁금증`;

export const BRAND = {
  name,
  shortName: name,
  descriptor: '사소한 궁금증을 사람들에게',
  tagline: '검색해도 안 나오는 건, 사람들에게 물어보세요.',
  description:
    '일상에서 문득 궁금하지만 정답은 없는 질문을 사람들에게 묻고, 선택과 의견을 확인하는 공간.',
  siteTitle,
  openGraphTitle: siteTitle,
  openGraphDescription:
    '일상에서 문득 궁금하지만 정답은 없는 질문을 사람들에게 묻고, 선택과 의견을 확인해보세요.',
} as const;

export const BRAND_SOCIAL_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: `${BRAND.name} — ${BRAND.descriptor}`,
} as const;
