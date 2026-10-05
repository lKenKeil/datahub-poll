import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';
import { MyActivity } from '@/components/my-activity';

export const metadata: Metadata = { title: `마이페이지 | ${BRAND.name}`, robots: { index: false, follow: false } };
export default function MyPage() { return <MyActivity />; }
