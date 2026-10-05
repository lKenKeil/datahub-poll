'use client';

import { useEffect, useRef } from 'react';
import { ProfileEditor } from '@/components/profile-editor';
import { useAuth } from '@/components/auth-provider';
import type { AccountProfile } from '@/lib/profile';
import { BRAND } from '@/lib/brand';

export function ProfileOnboarding({ profile, close }: { profile: AccountProfile; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { refreshProfile } = useAuth();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const dismiss = () => {
    // Closing never blocks participation or changes the generated nickname.
    // Persist completion so the optional welcome doesn't repeat on sign-in.
    close();
    void (async () => {
      try {
        const response = await fetch('/api/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ onboardingCompleted: true }) });
        if (response.ok) await refreshProfile();
      } catch { /* Keep the account usable even when profile persistence fails. */ }
    })();
  };
  return (
    <dialog ref={ref} onCancel={dismiss} aria-labelledby="profile-welcome-title" aria-describedby="profile-welcome-description" className="m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-sm overflow-y-auto rounded-3xl border border-line bg-surface p-5 text-ink backdrop:bg-black/45">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="profile-welcome-title" className="text-xl font-bold">{BRAND.name}에서 사용할 닉네임</h2>
        <button type="button" onClick={dismiss} aria-label="닉네임 안내 닫기" className="min-h-11 min-w-11 shrink-0 rounded-xl text-xs text-muted">닫기</button>
      </div>
      <p id="profile-welcome-description" className="mb-5 text-sm leading-relaxed text-muted">자동으로 만든 이름이에요. 지금 바꾸거나 이대로 시작해도 괜찮아요.</p>
      <ProfileEditor profile={profile} onboarding onComplete={close} />
    </dialog>
  );
}
