'use client';

import Image from 'next/image';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { ProfileAvatar } from '@/components/profile-avatar';
import type { AccountProfile } from '@/lib/profile';

export function ProfileAvatarEditor({ profile, disabled }: { profile: AccountProfile; disabled: boolean }) {
  const { refreshProfile } = useAuth();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const previewRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);
  const clearPreview = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null; setPreview(null); setFile(null);
    if (input.current) input.current.value = '';
  };
  const pick = (value: File | undefined) => {
    if (!value) return;
    clearPreview(); setFeedback('');
    if (value.size > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(value.type)) {
      setFeedback('JPEG, PNG, WebP 사진을 2MB 이하로 선택해주세요.'); return;
    }
    const url = URL.createObjectURL(value);
    previewRef.current = url; setPreview(url); setFile(value);
  };
  const save = async (source?: string) => {
    if (inFlight.current || disabled || (!source && !file)) return;
    inFlight.current = true; setBusy(true); setFeedback('');
    try {
      const form = new FormData();
      if (file) form.set('avatar', file);
      const response = await fetch('/api/profile/avatar', {
        method: source ? 'PATCH' : 'POST',
        ...(source ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) } : { body: form }),
      });
      if (!response.ok) {
        setFeedback(response.status === 413 ? '사진은 2MB 이하로 선택해주세요.'
          : response.status === 400 ? '사진을 확인해주세요. JPEG, PNG, WebP만 사용할 수 있어요.'
          : response.status === 401 ? '다시 로그인해주세요.'
          : response.status === 409 ? '사진 설정이 변경됐어요. 새로고침 후 다시 시도해주세요.'
          : response.status === 429 ? '잠시 후 다시 시도해주세요.' : '사진을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      await refreshProfile(); clearPreview(); setFeedback('사진을 변경했어요. 공개 설정은 그대로 유지돼요.');
    } catch { setFeedback('사진을 저장하지 못했어요. 잠시 후 다시 시도해주세요.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <fieldset disabled={busy || disabled} aria-busy={busy} className="min-w-0 space-y-2">
    <legend className="mb-2 text-sm font-bold">프로필 사진</legend>
    <div className="flex items-center gap-3">
      {preview ? <Image unoptimized src={preview} alt="저장 전 사진 미리보기" width={64} height={64} className="h-16 w-16 shrink-0 rounded-full object-cover" /> : <ProfileAvatar name={profile.nickname} url={profile.avatar_url} size={48} />}
      <p className="text-xs leading-relaxed text-muted">사진 변경과 공개 설정은 별개예요.<br />JPEG · PNG · WebP, 최대 2MB</p>
    </div>
    <input ref={input} id={id} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => pick(event.target.files?.[0])} className="sr-only" tabIndex={-1} aria-label="프로필 사진 선택" />
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => input.current?.click()} className="min-h-11 rounded-xl border border-line px-3 text-sm">사진 변경</button>
      <button type="button" onClick={() => void save('default')} className="min-h-11 rounded-xl border border-line px-3 text-sm">기본 이미지로 변경</button>
    </div>
    {preview ? <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void save()} className="min-h-11 rounded-xl bg-primary px-3 text-sm font-bold text-white">{busy ? '업로드 중...' : '사진 저장'}</button>
      <button type="button" onClick={clearPreview} className="min-h-11 rounded-xl px-3 text-sm">취소</button>
    </div> : null}
    <div className="flex flex-wrap gap-2 text-sm">
      {profile.social_avatar_url ? <button type="button" aria-pressed={profile.avatar_source === 'social'} onClick={() => void save('social')} className="min-h-11 rounded-xl border border-line px-3">{profile.avatar_source === 'social' ? '✓ ' : ''}소셜 사진 사용</button> : null}
      {profile.uploaded_avatar_url ? <button type="button" aria-pressed={profile.avatar_source === 'uploaded'} onClick={() => void save('uploaded')} className="min-h-11 rounded-xl border border-line px-3">{profile.avatar_source === 'uploaded' ? '✓ ' : ''}업로드 사진 사용</button> : null}
    </div>
    <p aria-live="polite" className="text-xs leading-relaxed text-muted">{busy ? '사진을 저장하고 있어요...' : feedback}</p>
  </fieldset>;
}
