export type LinkedLoginMethods = { google: boolean; kakao: boolean; email: boolean };

// Reduce Supabase's private identity payload immediately. Neither the profile
// UI nor its state needs provider account IDs, emails or identity metadata.
export function getLinkedLoginMethods(identities: unknown, userId: string): LinkedLoginMethods | null {
  if (!userId || !Array.isArray(identities)) return null;
  const linked: LinkedLoginMethods = { google: false, kakao: false, email: false };
  for (const identity of identities) {
    if (!identity || typeof identity !== 'object' || identity.user_id !== userId) return null;
    if (identity.provider === 'google' || identity.provider === 'kakao' || identity.provider === 'email') {
      linked[identity.provider as keyof LinkedLoginMethods] = true;
    }
  }
  return linked;
}

export function getIdentityLinkFeedback(status: string | null): { error: boolean; message: string } | null {
  if (status === 'success') return { error: false, message: '로그인 방법을 연결했어요.' };
  if (status === 'identity_already_exists') return { error: true, message: '이 로그인 방법은 이미 다른 Askio 계정에 연결되어 있어요.' };
  if (status === 'failed') return { error: true, message: '로그인 방법을 연결하지 못했어요. 다시 시도해주세요.' };
  return null;
}
