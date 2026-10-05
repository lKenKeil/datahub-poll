import { ProfileSettings } from '@/components/profile-settings';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `프로필 설정 | ${BRAND.name}`, robots: { index: false, follow: false } };

export default function ProfilePage() { return <ProfileSettings />; }
