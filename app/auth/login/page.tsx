import { AuthLoginPanel } from '@/components/auth-login-panel';
import { getSafeAuthReturnPath } from '@/lib/auth-redirect';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `로그인 | ${BRAND.name}`, robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const query = await searchParams;
  return <AuthLoginPanel returnTo={getSafeAuthReturnPath(query.next)} failed={Boolean(query.error)} />;
}
