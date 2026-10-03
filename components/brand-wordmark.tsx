import { Nunito_Sans } from 'next/font/google';
import { BRAND } from '@/lib/brand';
import { BrandMark } from '@/components/brand-mark';

const wordmarkFont = Nunito_Sans({
  weight: '900',
  subsets: ['latin'],
  display: 'swap',
});

export function BrandWordmark({
  size = 'header',
  showDescriptor = false,
  className = '',
}: { size?: 'header' | 'compact'; showDescriptor?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-2xl leading-none text-ink ${size === 'header' ? 'md:text-4xl' : ''} ${className}`}>
      <BrandMark className={size === 'header' ? 'size-7 md:size-10' : 'size-7'} />
      <span className={`${wordmarkFont.className} tracking-normal`}>{BRAND.name}<span style={{ color: '#d76448' }}>.</span></span>
      {showDescriptor ? <span className="ml-2 hidden text-sm font-medium leading-normal tracking-normal text-muted xl:inline">{BRAND.descriptor}</span> : null}
    </span>
  );
}
