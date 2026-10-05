'use client';

import Image from 'next/image';
import { getSafeAvatarUrl } from '@/lib/profile';

export function ProfileAvatar({ name, url, size = 28 }: { name: string; url?: string | null; size?: number }) {
  const safeUrl = getSafeAvatarUrl(url);
  return safeUrl
    ? <Image unoptimized src={safeUrl} width={size} height={size} alt="" referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-link" style={{ width: size, height: size }}>{Array.from(name)[0] || 'A'}</span>;
}
