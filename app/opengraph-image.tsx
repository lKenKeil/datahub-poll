import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND, BRAND_SOCIAL_IMAGE } from '@/lib/brand';

export const alt = BRAND_SOCIAL_IMAGE.alt;
export const size = { width: BRAND_SOCIAL_IMAGE.width, height: BRAND_SOCIAL_IMAGE.height };
export const contentType = 'image/png';
export const dynamic = 'force-static';

// Small text-only TTF subsets are fetched at build time, never by visitors.
// ImageResponse does not support next/font's WOFF2 output.
async function loadFont(family: string, weight: number, text: string) {
  const cssResponse = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(text)}`,
    { cache: 'force-cache' },
  );
  if (!cssResponse.ok) throw new Error('Social preview font stylesheet unavailable.');
  const css = await cssResponse.text();
  const fontUrl = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"]truetype['"]\)/)?.[1];
  if (!fontUrl) throw new Error('Social preview requires a TrueType font.');
  const response = await fetch(fontUrl, { cache: 'force-cache' });
  if (!response.ok) throw new Error('Social preview font unavailable.');
  return response.arrayBuffer();
}

export default async function SocialPreview() {
  const [wordmarkFont, captionFont, symbol] = await Promise.all([
    loadFont('Nunito Sans', 900, BRAND.name),
    loadFont('Noto Sans KR', 400, BRAND.descriptor),
    // Reuse the finished vector mark without changing its paths or colors.
    readFile(join(process.cwd(), 'app/icon.svg')),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#faf7f1', color: '#182638' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders SVG data, not browser images. */}
          <img src={`data:image/svg+xml;base64,${symbol.toString('base64')}`} width={170} height={170} alt="" style={{ transform: 'translateY(-4px)' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', fontFamily: 'Wordmark', fontSize: 160, fontWeight: 900, lineHeight: 1 }}>
            {BRAND.name}
            <div style={{ width: 25, height: 25, marginLeft: 6, marginBottom: 24, alignSelf: 'flex-end', borderRadius: '50%', background: '#d76448' }} />
          </div>
        </div>
        <div style={{ display: 'flex', marginTop: 28, fontFamily: 'Caption', fontSize: 36, fontWeight: 400 }}>
          {BRAND.descriptor}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Wordmark', data: wordmarkFont, style: 'normal', weight: 900 },
        { name: 'Caption', data: captionFont, style: 'normal', weight: 400 },
      ],
    },
  );
}
