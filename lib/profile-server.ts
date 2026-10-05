import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { parseAccountProfile, type AccountProfile } from '@/lib/profile';
import { logPublicMutationError, PUBLIC_INTERNAL_ERROR_MESSAGE } from '@/lib/public-api-hardening';

export async function ensureAccountProfile(
  client: SupabaseClient,
  userId: string,
): Promise<AccountProfile> {
  const { data, error } = await client.rpc('ensure_user_profile', { p_user_id: userId });
  if (error) throw error;
  const profile = parseAccountProfile(data);
  if (!profile) throw new Error('Profile response is invalid.');
  return profile;
}

export function accountErrorResponse(error: unknown, scope: string) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  const migrationMissing = code === 'PGRST202' || code === '42P01'
    || code === '42703' || code === '42883' || code === 'PGRST204';
  logPublicMutationError(scope, error);
  return NextResponse.json({
    error: migrationMissing ? '계정 설정을 준비 중이에요. 잠시 후 다시 시도해주세요.' : PUBLIC_INTERNAL_ERROR_MESSAGE,
    ...(migrationMissing ? { code: 'ACCOUNT_MIGRATION_REQUIRED' } : {}),
  }, { status: migrationMissing ? 503 : 500, headers: { 'Cache-Control': 'private, no-store' } });
}
