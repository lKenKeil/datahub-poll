import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth-server';
import { getSupabaseMutationClient } from '@/lib/supabase-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { validateNickname } from '@/lib/nickname';
import { parseAccountProfile } from '@/lib/profile';
import { accountErrorResponse, ensureAccountProfile } from '@/lib/profile-server';

const headers = { 'Cache-Control': 'private, no-store' };
const PROFILE_UPDATE_LIMIT = { key: 'profile-update', limit: 10, windowMs: 60_000 };

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    const data = await ensureAccountProfile(getSupabaseMutationClient(), auth.user.id);
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    return accountErrorResponse(error, 'profile-read');
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    const limited = enforceRateLimit(request, PROFILE_UPDATE_LIMIT);
    if (limited) return limited;
    const body = await readBody(request);
    if (!body || Object.keys(body).some((key) => !['nickname', 'onboardingCompleted', 'showAvatar'].includes(key))
      || (!Object.hasOwn(body, 'nickname') && !Object.hasOwn(body, 'onboardingCompleted') && !Object.hasOwn(body, 'showAvatar'))
      || (body.onboardingCompleted !== undefined && typeof body.onboardingCompleted !== 'boolean')
      || (body.showAvatar !== undefined && typeof body.showAvatar !== 'boolean')) {
      return NextResponse.json({ error: '프로필 입력값을 확인해주세요.' }, { status: 400, headers });
    }
    const update: { nickname?: string; onboarding_completed?: boolean; show_avatar?: boolean } = {};
    if (Object.hasOwn(body, 'nickname')) {
      const nickname = validateNickname(body.nickname);
      if (!nickname.ok) return NextResponse.json({ error: nickname.error }, { status: 400, headers });
      update.nickname = nickname.value;
    }
    if (typeof body.onboardingCompleted === 'boolean') update.onboarding_completed = body.onboardingCompleted;
    const client = getSupabaseMutationClient();
    const current = await ensureAccountProfile(client, auth.user.id);
    if (body.showAvatar === true && !current.avatar_url) {
      return NextResponse.json({ error: '사용할 소셜 프로필 사진이 없어요.' }, { status: 400, headers });
    }
    if (typeof body.showAvatar === 'boolean') update.show_avatar = body.showAvatar;
    const { data, error } = await client.from('profiles').update(update).eq('id', auth.user.id)
      .select('nickname,avatar_url,onboarding_completed,show_avatar').single();
    if (error?.code === '23505') {
      return NextResponse.json({ error: '이미 사용 중인 닉네임이에요.', code: 'NICKNAME_TAKEN' }, { status: 409, headers });
    }
    if (error) throw error;
    const profile = parseAccountProfile(data);
    if (!profile) throw new Error('Profile response is invalid.');
    return NextResponse.json({ data: profile }, { headers });
  } catch (error) {
    return accountErrorResponse(error, 'profile-update');
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    const limited = enforceRateLimit(request, PROFILE_UPDATE_LIMIT);
    if (limited) return limited;
    const body = await readBody(request);
    if (!body || body.action !== 'recommend' || Object.keys(body).length !== 1) {
      return NextResponse.json({ error: '허용되지 않은 요청입니다.' }, { status: 400, headers });
    }
    const { data, error } = await getSupabaseMutationClient()
      .rpc('recommend_user_profile_nickname', { p_user_id: auth.user.id });
    if (error) throw error;
    const profile = parseAccountProfile(data);
    if (!profile) throw new Error('Profile response is invalid.');
    return NextResponse.json({ data: profile }, { headers });
  } catch (error) {
    return accountErrorResponse(error, 'profile-recommend');
  }
}
