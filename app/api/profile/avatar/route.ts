import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth-server';
import { getSupabaseMutationClient } from '@/lib/supabase-server';
import { ensureAccountProfile, accountErrorResponse } from '@/lib/profile-server';
import { parseAccountProfile } from '@/lib/profile';
import { enforceRateLimit } from '@/lib/rate-limit';
import { AvatarInputError } from '@/lib/profile-avatar-processing';

export const runtime = 'nodejs';
const BUCKET = 'profile-avatars';
const headers = { 'Cache-Control': 'private, no-store' };
const limit = { key: 'profile-avatar', limit: 10, windowMs: 60_000 };
const safePath = (value: unknown): value is string => typeof value === 'string' && /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/.test(value);

async function mutate(request: Request, upload: boolean) {
  let orphanPath: string | null = null;
  let commitAttempted = false;
  let client: ReturnType<typeof getSupabaseMutationClient> | null = null;
  const cleanup = async (path: string | null) => {
    if (!safePath(path) || !client) return;
    try { const { error } = await client.storage.from(BUCKET).remove([path]); if (error) console.error('[avatar-cleanup] deferred'); }
    catch { console.error('[avatar-cleanup] deferred'); }
  };
  try {
    const auth = await requireAuthenticatedUser(request);
    if (auth.response) return auth.response;
    const limited = enforceRateLimit(request, limit);
    if (limited) return limited;
    client = getSupabaseMutationClient();
    await ensureAccountProfile(client, auth.user.id);
    const { data: current, error: readError } = await client.from('profiles').select('uploaded_avatar_path').eq('id', auth.user.id).single();
    if (readError) throw readError;
    let source: unknown;
    let url: string | null = null;
    if (upload) {
      if (Number(request.headers.get('content-length') ?? 0) > 2 * 1024 * 1024 + 64 * 1024) throw new AvatarInputError('사진은 2MB 이하로 선택해주세요.', 413);
      const form = await request.formData();
      const file = form.get('avatar');
      if (!(file instanceof File) || [...form.keys()].some(key => key !== 'avatar') || form.getAll('avatar').length !== 1) throw new AvatarInputError('사진을 한 장 선택해주세요.');
      const { encodeProfileAvatar } = await import('@/lib/profile-avatar-processing');
      const encoded = await encodeProfileAvatar(file);
      const path = `avatars/${randomUUID()}.webp`;
      const { error } = await client.storage.from(BUCKET).upload(path, encoded, { contentType: 'image/webp', upsert: false, cacheControl: '3600' });
      if (error) throw error;
      orphanPath = path;
      url = client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      source = 'uploaded';
    } else {
      let body;
      try { body = await request.json(); }
      catch { throw new AvatarInputError('사진 설정을 확인해주세요.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
        || !Object.hasOwn(body, 'source')) throw new AvatarInputError('사진 설정을 확인해주세요.');
      source = body.source;
    }
    if (!['default', 'social', 'uploaded'].includes(String(source))) throw new AvatarInputError('사진 설정을 확인해주세요.');
    commitAttempted = true;
    const { data, error } = await client.rpc('change_profile_avatar', {
      p_user_id: auth.user.id, p_source: source, p_new_path: orphanPath, p_new_url: url,
      p_expected_path: current.uploaded_avatar_path ?? null,
    });
    if (error?.message === 'AVATAR_CONFLICT') {
      await cleanup(orphanPath); orphanPath = null;
      return NextResponse.json({ error: '사진 설정이 변경됐어요. 새로고침 후 다시 시도해주세요.' }, { status: 409, headers });
    }
    if (error?.message === 'AVATAR_SOURCE_UNAVAILABLE') {
      await cleanup(orphanPath); orphanPath = null;
      throw new AvatarInputError('선택할 사진이 없어요.');
    }
    if (error) throw error;
    // From this point the new object is committed. Never delete it on a response error.
    orphanPath = null;
    await cleanup(data.previous_path);
    const profile = parseAccountProfile(data.profile);
    if (!profile) throw new Error('Invalid profile');
    return NextResponse.json({ data: profile }, { headers });
  } catch (error) {
    // A transport failure is not proof of rollback: the database could still
    // commit after a follow-up read. Prefer an orphan over deleting a live photo.
    if (!commitAttempted) await cleanup(orphanPath);
    if (error instanceof AvatarInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    return accountErrorResponse(error, 'profile-avatar');
  }
}
export const POST = (request: Request) => mutate(request, true);
export const PATCH = (request: Request) => mutate(request, false);
