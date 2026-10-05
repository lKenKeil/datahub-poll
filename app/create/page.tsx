'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { AuthButton } from '@/components/auth-button';
import { AuthPrompt } from '@/components/auth-prompt';
import { useAuth } from '@/components/auth-provider';
import { BrandHomeLink } from '@/components/brand-home-link';
import { PollCategory } from '@/lib/types';
import type { PollEditLockConfig } from '@/lib/poll-edit-lock';
import { storePollOwnerToken } from '@/lib/poll-owner-storage';
import { getUnicodeCodePointLength } from '@/lib/unicode-length';
import { trackPollCreated } from '@/lib/analytics';
import { CATEGORY_CREATE_EXAMPLES, CATEGORY_PRESENTATION, type InterestCategory } from '@/lib/category-presentation';

type InterestCategoryOption = {
  label: InterestCategory;
  icon: string;
  description: string;
  examples: readonly string[];
  dbValue: PollCategory;
};

type PollOptionDraft = {
  key: number;
  text: string;
  imageFile: File | null;
  previewUrl: string | null;
};

type OwnerTokenFallback = {
  pollId: string;
  ownerToken: string;
};

type EditLockPreset =
  | 'first_vote'
  | 'time_10'
  | 'time_30'
  | 'participants_5'
  | 'participants_10'
  | 'time_10_or_participants_5';

type EditLockPresetOption = {
  value: EditLockPreset;
  label: string;
  description: string;
  config: PollEditLockConfig;
};

const CATEGORY_OPTIONS: InterestCategoryOption[] = [
  { ...CATEGORY_PRESENTATION['연애·관계'], icon: '💞', dbValue: '커뮤니티' },
  { ...CATEGORY_PRESENTATION['게임'], icon: '🎮', dbValue: '커뮤니티' },
  { ...CATEGORY_PRESENTATION['스포츠'], icon: '⚽', dbValue: '라이프스타일' },
  { ...CATEGORY_PRESENTATION['음식'], icon: '🍜', dbValue: '라이프스타일' },
  { ...CATEGORY_PRESENTATION['엔터·콘텐츠'], icon: '🎬', dbValue: '커뮤니티' },
  { ...CATEGORY_PRESENTATION['IT·제품'], icon: '📱', dbValue: 'IT/테크' },
  { ...CATEGORY_PRESENTATION['라이프'], icon: '🌿', dbValue: '라이프스타일' },
  { ...CATEGORY_PRESENTATION['가치관'], icon: '💭', dbValue: '사회/경제' },
  { ...CATEGORY_PRESENTATION['데이터'], icon: '📊', dbValue: '학술/통계' },
];

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 120;
const MAX_OPTION_LENGTH = 50;
const MAX_DESCRIPTION_LENGTH = 300;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 4_300_000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EDIT_LOCK_PRESETS: EditLockPresetOption[] = [
  {
    value: 'first_vote',
    label: '첫 투표 전까지만',
    description: '첫 참여가 생기면 질문과 선택지가 잠겨요.',
    config: { mode: 'first_vote', minutes: null, participants: null },
  },
  {
    value: 'time_10',
    label: '게시 후 10분 동안',
    description: '참여 여부와 관계없이 게시 후 10분까지 수정할 수 있어요.',
    config: { mode: 'time', minutes: 10, participants: null },
  },
  {
    value: 'time_30',
    label: '게시 후 30분 동안',
    description: '참여 여부와 관계없이 게시 후 30분까지 수정할 수 있어요.',
    config: { mode: 'time', minutes: 30, participants: null },
  },
  {
    value: 'participants_5',
    label: '5명 참여 전까지',
    description: '참여자가 5명에 도달하면 질문과 선택지가 잠겨요.',
    config: { mode: 'participants', minutes: null, participants: 5 },
  },
  {
    value: 'participants_10',
    label: '10명 참여 전까지',
    description: '참여자가 10명에 도달하면 질문과 선택지가 잠겨요.',
    config: { mode: 'participants', minutes: null, participants: 10 },
  },
  {
    value: 'time_10_or_participants_5',
    label: '10분 또는 5명 중 먼저 도달할 때까지',
    description: '시간과 참여자 조건 중 하나라도 먼저 도달하면 잠겨요.',
    config: { mode: 'time_or_participants', minutes: 10, participants: 5 },
  },
];

export default function CreatePollPage() {
  const { user, openLogin } = useAuth();
  const router = useRouter();
  const submissionInFlight = useRef(false);
  const nextOptionKeyRef = useRef(2);
  const imageInputRefs = useRef(new Map<number, HTMLInputElement>());
  const activeImageOptionKeyRef = useRef<number | null>(null);

  const [title, setTitle] = useState('');
  const [interestCategory, setInterestCategory] = useState<InterestCategory | null>(null);
  const [options, setOptions] = useState<PollOptionDraft[]>([
    { key: 0, text: '', imageFile: null, previewUrl: null },
    { key: 1, text: '', imageFile: null, previewUrl: null },
  ]);
  const optionsRef = useRef(options);
  const [description, setDescription] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeImageOptionKey, setActiveImageOptionKey] = useState<number | null>(null);
  const [ownerTokenFallback, setOwnerTokenFallback] = useState<OwnerTokenFallback | null>(null);
  const [ownerTokenCopyMessage, setOwnerTokenCopyMessage] = useState('');
  const [editLockPreset, setEditLockPreset] = useState<EditLockPreset>('first_vote');
  const [previewOpen, setPreviewOpen] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);

  const trimmedTitle = title.trim();
  const titleLength = getUnicodeCodePointLength(title);
  const trimmedOptions = useMemo(() => options.map((option) => option.text.trim()), [options]);
  const selectedImageBytes = useMemo(
    () => options.reduce((total, option) => total + (option.imageFile?.size ?? 0), 0),
    [options],
  );
  const selectedImageCount = useMemo(
    () => options.reduce((total, option) => total + Number(Boolean(option.imageFile)), 0),
    [options],
  );
  const selectedCategory = CATEGORY_OPTIONS.find((option) => option.label === interestCategory) ?? null;
  const createExample = interestCategory ? CATEGORY_CREATE_EXAMPLES[interestCategory] : null;
  const selectedEditLock = EDIT_LOCK_PRESETS.find((option) => option.value === editLockPreset)
    ?? EDIT_LOCK_PRESETS[0];

  const updateOptions = (updater: (previous: PollOptionDraft[]) => PollOptionDraft[]) => {
    setOptions((previous) => {
      const next = updater(previous);
      optionsRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    return () => {
      for (const option of optionsRef.current) {
        if (option.previewUrl) URL.revokeObjectURL(option.previewUrl);
      }
      optionsRef.current = [];
    };
  }, []);

  const validationMessage = useMemo(() => {
    if (!interestCategory) return '카테고리를 선택해주세요.';
    const normalizedTitleLength = getUnicodeCodePointLength(trimmedTitle);
    if (normalizedTitleLength < MIN_TITLE_LENGTH) return `투표 질문은 ${MIN_TITLE_LENGTH}자 이상 입력해주세요.`;
    if (normalizedTitleLength > MAX_TITLE_LENGTH) return `투표 질문은 ${MAX_TITLE_LENGTH}자 이하로 입력해주세요.`;
    if (trimmedOptions.length < MIN_OPTIONS) return '선택지는 최소 2개가 필요해요.';
    if (trimmedOptions.some((option) => !option)) return '빈 선택지가 있어요. 모든 선택지를 입력해주세요.';
    if (trimmedOptions.some((option) => getUnicodeCodePointLength(option) > MAX_OPTION_LENGTH)) {
      return `선택지는 ${MAX_OPTION_LENGTH}자 이하로 입력해주세요.`;
    }
    if (getUnicodeCodePointLength(description.trim()) > MAX_DESCRIPTION_LENGTH) {
      return `설명은 ${MAX_DESCRIPTION_LENGTH}자 이하로 입력해주세요.`;
    }

    const uniqueOptions = new Set(trimmedOptions.map((option) => option.toLowerCase()));
    if (uniqueOptions.size !== trimmedOptions.length) return '중복된 선택지가 있어요.';
    return '';
  }, [description, interestCategory, trimmedOptions, trimmedTitle]);

  const clearError = () => {
    if (errorMessage) setErrorMessage('');
  };

  const activateImageTarget = (optionKey: number) => {
    activeImageOptionKeyRef.current = optionKey;
    setActiveImageOptionKey(optionKey);
  };

  const handleOptionChange = (index: number, value: string) => {
    clearError();
    updateOptions((previous) => previous.map((option, optionIndex) => (
      optionIndex === index ? { ...option, text: value } : option
    )));
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    clearError();
    const key = nextOptionKeyRef.current;
    nextOptionKeyRef.current += 1;
    updateOptions((previous) => [
      ...previous,
      { key, text: '', imageFile: null, previewUrl: null },
    ]);
  };

  const removeOption = (index: number) => {
    if (options.length <= MIN_OPTIONS) return;
    clearError();
    const removed = optionsRef.current[index];
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    if (removed?.key === activeImageOptionKeyRef.current) {
      activeImageOptionKeyRef.current = null;
      setActiveImageOptionKey(null);
    }
    updateOptions((previous) => previous.filter((_, optionIndex) => optionIndex !== index));
  };

  const removeOptionImage = (index: number) => {
    if (isSubmitting) return;
    clearError();
    const current = optionsRef.current[index];
    if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
    updateOptions((previous) => previous.map((option, optionIndex) => (
      optionIndex === index
        ? { ...option, imageFile: null, previewUrl: null }
        : option
    )));
  };

  const setImageForOption = useCallback((optionKey: number, file: File | null | undefined) => {
    if (!file || isSubmitting) return;
    setErrorMessage('');

    const currentIndex = optionsRef.current.findIndex((option) => option.key === optionKey);
    if (currentIndex < 0) {
      setErrorMessage('이미지를 넣을 선택지를 먼저 선택해주세요.');
      return;
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setErrorMessage('JPG, PNG, WebP 이미지만 추가할 수 있어요. GIF와 SVG는 지원하지 않아요.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setErrorMessage('이미지는 파일당 최대 2MB까지 추가할 수 있어요.');
      return;
    }

    const current = optionsRef.current[currentIndex];
    const currentTotalBytes = optionsRef.current.reduce(
      (total, option) => total + (option.imageFile?.size ?? 0),
      0,
    );
    const nextTotalBytes = currentTotalBytes - (current.imageFile?.size ?? 0) + file.size;
    if (nextTotalBytes > MAX_MULTIPART_BYTES) {
      setErrorMessage('이미지 전체 용량이 너무 큽니다. 파일 크기를 줄여주세요.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
    updateOptions((previous) => previous.map((option, optionIndex) => (
      optionIndex === currentIndex ? { ...option, imageFile: file, previewUrl } : option
    )));
  }, [isSubmitting]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isSubmitting) return;

      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      const imageItem = clipboardItems.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const imageFile = imageItem?.getAsFile()
        ?? Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));

      if (!imageFile) return;
      event.preventDefault();

      const optionKey = activeImageOptionKeyRef.current;
      if (optionKey === null || !optionsRef.current.some((option) => option.key === optionKey)) {
        setErrorMessage('이미지를 넣을 선택지를 먼저 선택해주세요.');
        return;
      }

      setImageForOption(optionKey, imageFile);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isSubmitting, setImageForOption]);

  const releaseAllPreviewUrls = () => {
    for (const option of optionsRef.current) {
      if (option.previewUrl) URL.revokeObjectURL(option.previewUrl);
    }
    optionsRef.current = optionsRef.current.map((option) => ({ ...option, previewUrl: null }));
  };

  const copyFallbackOwnerToken = async () => {
    if (!ownerTokenFallback) return;
    setOwnerTokenCopyMessage('');

    try {
      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(ownerTokenFallback.ownerToken);
          copied = true;
        } catch {
          // Continue to the DOM copy fallback when Clipboard API access is denied.
        }
      }

      if (!copied) {
        const textarea = document.createElement('textarea');
        textarea.value = ownerTokenFallback.ownerToken;
        textarea.readOnly = true;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          copied = document.execCommand('copy');
        } finally {
          textarea.remove();
        }
      }

      if (!copied) throw new Error('Clipboard copy failed.');
      setOwnerTokenCopyMessage('관리 키를 복사했어요. 안전한 곳에 보관해주세요.');
    } catch {
      setOwnerTokenCopyMessage('복사하지 못했습니다. 위 관리 키를 직접 복사해주세요.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) { openLogin('질문을 올리려면 로그인이 필요해요.', '/create'); return; }
    if (submissionInFlight.current || ownerTokenFallback) return;
    setErrorMessage('');

    if (validationMessage || !selectedCategory) {
      setErrorMessage(validationMessage || '카테고리를 선택해주세요.');
      return;
    }

    if (selectedImageBytes > MAX_MULTIPART_BYTES) {
      setErrorMessage('이미지 전체 용량이 너무 큽니다. 파일 크기를 줄여주세요.');
      return;
    }

    submissionInFlight.current = true;
    setIsSubmitting(true);

    try {
      const hasImages = options.some((option) => option.imageFile);
      let requestInit: RequestInit;

      if (hasImages) {
        const formData = new FormData();
        formData.append('title', trimmedTitle);
        formData.append('category', selectedCategory.dbValue);
        formData.append('options', JSON.stringify(trimmedOptions));
        formData.append('editLock', JSON.stringify(selectedEditLock.config));
        formData.append('isAnonymous', String(isAnonymous));
        if (description.trim()) formData.append('officialFact', description.trim());
        options.forEach((option, index) => {
          if (option.imageFile) formData.append(`optionImages[${index}]`, option.imageFile);
        });
        requestInit = { method: 'POST', body: formData };
      } else {
        const payload: Record<string, unknown> = {
          title: trimmedTitle,
          category: selectedCategory.dbValue,
          options: trimmedOptions,
          editLock: selectedEditLock.config,
          isAnonymous,
        };
        if (description.trim()) payload.official_fact = description.trim();
        requestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        };
      }

      const response = await fetch('/api/polls', requestInit);
      const json = (await response.json()) as {
        data?: { id?: string; ownerToken?: string };
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401) {
          openLogin('질문을 올리려면 다시 로그인해주세요.', '/create');
          setErrorMessage('세션이 만료됐어요. 다시 로그인해주세요.');
          return;
        }
        setErrorMessage(
          response.status === 429
            ? json.error ?? '투표를 너무 빠르게 만들고 있어요. 잠시 후 다시 시도해주세요.'
            : json.error ?? '투표를 만들지 못했어요. 입력 내용을 확인해주세요.',
        );
        return;
      }

      const createdPollId = json.data?.id;
      const ownerToken = json.data?.ownerToken;
      if (!createdPollId || !ownerToken) {
        setErrorMessage('투표 관리 권한 정보를 확인하지 못했습니다. 관리자에게 문의해주세요.');
        return;
      }

      trackPollCreated({
        poll_id: createdPollId,
        category: selectedCategory.dbValue,
        option_count: trimmedOptions.length,
        image_count: options.reduce((count, option) => count + (option.imageFile ? 1 : 0), 0),
      });

      try {
        storePollOwnerToken(createdPollId, ownerToken);
      } catch {
        setOwnerTokenFallback({ pollId: createdPollId, ownerToken });
        setErrorMessage('이 브라우저에 수정·삭제 권한을 저장하지 못했습니다.');
        return;
      }

      releaseAllPreviewUrls();
      router.push(`/vote/${encodeURIComponent(createdPollId)}`);
    } catch {
      setErrorMessage('네트워크 오류로 투표를 만들지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      submissionInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  if (!user && !ownerTokenFallback) return (
    <main className="min-h-screen w-full min-w-0 bg-canvas text-ink">
      <nav className="sticky top-0 z-50 border-b border-line bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <BrandHomeLink /><div className="flex items-center gap-2"><AuthButton /><ThemeToggle /></div>
        </div>
      </nav>
      <div className="mx-auto max-w-[1440px] space-y-5 px-4 pt-6 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold">질문 올리기</h1>
        <AuthPrompt message="질문을 올리려면 로그인이 필요해요." returnTo="/create" />
      </div>
    </main>
  );

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-canvas pb-24 text-ink dark:bg-canvas dark:text-ink">
      <nav className="sticky top-0 z-50 border-b border-line bg-canvas/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <BrandHomeLink />
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-link dark:text-link sm:inline-flex">투표 만들기</span>
            <AuthButton />
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[1280px] space-y-4 px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8">
        <header className="rounded-3xl border border-line bg-hero px-4 py-4 sm:px-6 sm:py-5">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em] text-ink dark:text-ink sm:text-3xl">투표 만들기</h1>
            <p className="mt-1.5 break-keep text-sm font-medium text-muted dark:text-muted sm:text-base">
              궁금한 걸 사람들에게 물어보세요.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-4">
            <fieldset className="rounded-3xl border border-line bg-surface p-4 dark:border-line dark:bg-surface sm:p-5">
              <legend className="sr-only">카테고리</legend>
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">1</span>
                <div>
                  <h2 className="text-lg font-bold text-ink dark:text-ink">카테고리</h2>
                  <p className="text-sm text-muted dark:text-muted">주제 하나를 골라주세요.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {CATEGORY_OPTIONS.map((option) => {
                  const selected = interestCategory === option.label;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => {
                        clearError();
                        setInterestCategory(option.label);
                      }}
                      aria-pressed={selected}
                      className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition active:scale-[0.99] sm:min-h-16 sm:px-2 ${selected ? 'border-primary bg-primary-soft ring-2 ring-primary/20' : 'border-line bg-canvas hover:border-link hover:bg-primary-soft dark:border-line dark:bg-surface-muted dark:hover:bg-primary-soft'}`}
                    >
                      {selected ? <span aria-hidden="true" className="absolute right-1.5 top-1 text-xs font-bold text-link dark:text-link">✓</span> : null}
                      <span className="text-lg leading-none" aria-hidden="true">{option.icon}</span>
                      <span className="mt-1 block max-w-full truncate text-xs font-bold text-ink dark:text-ink sm:text-sm">{option.label}</span>
                    </button>
                  );
                })}
              </div>
              {selectedCategory ? (
                <div className="mt-3 min-w-0 border-l-2 border-accent pl-3" aria-live="polite" id="category-guidance">
                  <p className="text-sm font-semibold leading-5 text-ink">
                    {selectedCategory.label}<span className="font-normal text-muted"> · {selectedCategory.description}</span>
                  </p>
                  <p className="mt-1 break-keep text-[13px] leading-5 text-muted">{selectedCategory.examples.join(' · ')}</p>
                </div>
              ) : null}
            </fieldset>

            <section className="rounded-3xl border border-line bg-surface p-4 shadow-sm shadow-blue-950/[0.03] dark:border-blue-500/25 dark:bg-surface sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">2</span>
                <div>
                  <label htmlFor="poll-title" className="text-lg font-bold text-ink dark:text-ink">질문</label>
                  <p className="text-sm text-muted dark:text-muted">한눈에 이해할 수 있게 적어주세요.</p>
                </div>
              </div>
              <input
                id="poll-title"
                type="text"
                value={title}
                onChange={(event) => {
                  clearError();
                  setTitle(event.target.value);
                }}
                className="mt-3 min-h-14 w-full rounded-xl border-2 border-line bg-canvas px-4 py-3 text-base font-bold outline-none transition placeholder:text-muted focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted dark:text-ink sm:text-lg"
                placeholder={createExample?.question ?? '예: 평생 짜장면만 먹기 vs 평생 짬뽕만 먹기'}
                aria-describedby="poll-title-help"
              />
              <div id="poll-title-help" className="mt-2 flex justify-between gap-4 text-xs font-semibold text-muted">
                <span>{MIN_TITLE_LENGTH}자 이상 입력해주세요.</span>
                <span>{titleLength}/{MAX_TITLE_LENGTH}</span>
              </div>
            </section>

            <section className="rounded-3xl border border-line bg-surface p-4 dark:border-line dark:bg-surface sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-white">3</span>
                <div>
                  <h2 className="text-lg font-bold text-ink dark:text-ink">선택지</h2>
                  <p className="text-sm text-muted dark:text-muted">2개부터 최대 {MAX_OPTIONS}개 · 이미지는 선택사항</p>
                  <p className="mt-0.5 text-xs font-medium text-muted dark:text-muted">JPG, PNG, WebP · 파일당 최대 2MB</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {options.map((option, index) => (
                  <div
                    key={option.key}
                    onPointerDown={() => activateImageTarget(option.key)}
                    onFocusCapture={() => activateImageTarget(option.key)}
                    className={`rounded-2xl border bg-canvas p-3 transition dark:bg-surface-muted ${
                      activeImageOptionKey === option.key
                        ? 'border-blue-400 ring-2 ring-blue-500/10 dark:border-blue-400/70'
                        : 'border-line dark:border-line'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label htmlFor={`poll-option-${index}`} className="flex items-center gap-2 text-sm font-bold text-ink dark:text-ink">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-soft text-xs text-link dark:text-link">{index + 1}</span>
                        선택지 {index + 1}
                      </label>
                      <div className="flex items-center gap-2">
                        {activeImageOptionKey === option.key ? (
                          <span className="hidden rounded-full bg-primary-soft px-2 py-1 text-xs font-bold text-link dark:bg-blue-500/15 dark:text-link sm:inline-flex">
                            여기에 붙여넣기
                          </span>
                        ) : null}
                        <span className="text-xs font-medium text-muted dark:text-muted">{getUnicodeCodePointLength(option.text)}/{MAX_OPTION_LENGTH}</span>
                      </div>
                    </div>
                    <div className="flex min-w-0 gap-2">
                      <input
                        id={`poll-option-${index}`}
                        type="text"
                        value={option.text}
                        onChange={(event) => handleOptionChange(index, event.target.value)}
                        disabled={isSubmitting}
                        className="min-w-0 flex-1 rounded-xl border-2 border-line bg-surface p-3.5 text-base font-semibold outline-none transition placeholder:text-muted focus:border-link dark:border-line dark:bg-surface-muted dark:text-ink"
                        placeholder={index < 2 ? createExample?.options[index] ?? (index === 0 ? '예: 짜장면' : '예: 짬뽕') : `선택지 ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        disabled={isSubmitting || options.length <= MIN_OPTIONS}
                        className="min-h-11 shrink-0 rounded-xl border border-line px-3 text-sm font-bold text-muted transition hover:border-rose-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-line dark:text-muted sm:px-4"
                        aria-label={`선택지 ${index + 1} 삭제`}
                      >
                        삭제
                      </button>
                    </div>

                    <input
                      ref={(node) => {
                        if (node) imageInputRefs.current.set(option.key, node);
                        else imageInputRefs.current.delete(option.key);
                      }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      tabIndex={-1}
                      disabled={isSubmitting}
                      onChange={(event) => {
                        setImageForOption(option.key, event.currentTarget.files?.[0]);
                        event.currentTarget.value = '';
                      }}
                      aria-label={`선택지 ${index + 1} 이미지 파일`}
                    />

                    {option.previewUrl ? (
                      <div
                        className="mt-3 overflow-hidden rounded-xl bg-surface outline-none transition focus:ring-2 focus:ring-link/20 dark:bg-surface-muted"
                        tabIndex={0}
                        aria-label={`선택지 ${index + 1} 이미지 영역. 붙여넣거나 파일을 선택할 수 있습니다.`}
                      >
                        <div className="relative aspect-video max-h-52 w-full overflow-hidden bg-surface-muted dark:bg-surface-muted">
                          <Image
                            src={option.previewUrl}
                            alt=""
                            fill
                            unoptimized
                            sizes="(max-width: 640px) 100vw, 640px"
                            className="object-cover"
                          />
                        </div>
                        <div className="p-2.5">
                          <p className="mb-2 hidden text-center text-xs font-semibold text-muted sm:block">Ctrl+V 또는 Cmd+V로도 바꿀 수 있어요.</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => imageInputRefs.current.get(option.key)?.click()}
                              disabled={isSubmitting}
                              aria-label={`선택지 ${index + 1} 이미지 변경`}
                              className="min-h-11 flex-1 rounded-xl border border-blue-300 px-2 text-sm font-bold text-link transition hover:bg-primary-soft disabled:cursor-wait disabled:opacity-50 dark:border-blue-500/30 dark:text-link dark:hover:bg-primary-soft sm:px-4"
                            >
                              이미지 변경
                            </button>
                            <button
                              type="button"
                              onClick={() => removeOptionImage(index)}
                              disabled={isSubmitting}
                              aria-label={`선택지 ${index + 1} 이미지 삭제`}
                              className="min-h-11 flex-1 rounded-xl border border-rose-300 px-2 text-sm font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10 sm:px-4"
                            >
                              이미지 삭제
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          imageInputRefs.current.get(option.key)?.click();
                        }}
                        disabled={isSubmitting}
                        aria-label={`선택지 ${index + 1} 이미지 영역. 붙여넣거나 파일을 선택할 수 있습니다.`}
                        className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-surface px-3 py-2 text-sm font-bold text-link transition hover:border-link hover:bg-primary-soft focus:border-link focus:ring-2 focus:ring-link/20 disabled:cursor-wait disabled:opacity-50 dark:border-blue-500/30 dark:bg-surface-muted dark:text-link dark:hover:bg-primary-soft"
                      >
                        <span>+ 이미지 추가</span>
                        <span className="hidden text-xs font-medium text-muted dark:text-muted sm:inline">파일 선택 · Ctrl/Cmd+V 붙여넣기</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {selectedImageCount > 0 ? (
                <p className="mt-4 text-center text-xs font-bold text-muted" aria-live="polite">
                  이미지 {selectedImageCount}개 · {(selectedImageBytes / 1024 / 1024).toFixed(2)}MB / 약 4.3MB
                </p>
              ) : null}

              <button
                type="button"
                onClick={addOption}
                disabled={isSubmitting || options.length >= MAX_OPTIONS}
                className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-blue-400 px-4 text-sm font-bold text-link transition hover:bg-primary-soft disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 dark:border-blue-500/40 dark:text-link dark:hover:bg-primary-soft"
              >
                {options.length >= MAX_OPTIONS ? `선택지는 ${MAX_OPTIONS}개까지 추가할 수 있어요` : '+ 선택지 추가'}
              </button>
            </section>

            <section className="rounded-2xl border border-line bg-surface p-4 dark:border-line dark:bg-surface sm:p-5">
              <div>
                <label htmlFor="poll-description" className="text-base font-bold text-ink dark:text-ink">설명 또는 참고정보 <span className="text-xs font-medium text-muted dark:text-muted">선택</span></label>
                <p className="mt-0.5 text-sm text-muted dark:text-muted">필요한 배경이나 조건만 짧게 적어주세요.</p>
              </div>
              <textarea
                id="poll-description"
                value={description}
                onChange={(event) => {
                  clearError();
                  setDescription(event.target.value);
                }}
                className="mt-3 h-24 w-full resize-none rounded-xl border-2 border-line bg-canvas p-3.5 text-base font-medium outline-none transition placeholder:text-muted focus:border-link focus:ring-2 focus:ring-link/20 dark:border-line dark:bg-surface-muted dark:text-ink"
                placeholder={createExample?.description ?? '예: 가격은 같다고 가정하고 골라주세요.'}
              />
              <p className="mt-2 text-right text-xs font-semibold text-muted">{getUnicodeCodePointLength(description)}/{MAX_DESCRIPTION_LENGTH}</p>
            </section>

            <div className="rounded-2xl border border-line bg-surface px-4 py-2 sm:px-5">
              <label htmlFor="poll-anonymous" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
                <input
                  id="poll-anonymous"
                  type="checkbox"
                  checked={isAnonymous}
                  onChange={(event) => setIsAnonymous(event.target.checked)}
                  disabled={isSubmitting}
                  aria-describedby="poll-anonymous-help"
                  className="h-4 w-4 shrink-0 accent-blue-600"
                />
                익명으로 올리기
              </label>
              <p id="poll-anonymous-help" className="pb-2 text-xs leading-relaxed text-muted">익명으로 올려도 작성 권한과 관리 권한은 그대로 유지돼요.</p>
            </div>

            <details className="group rounded-2xl border border-line bg-surface p-4 dark:border-line dark:bg-surface sm:p-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">
                <div>
                  <h2 className="text-base font-bold text-ink dark:text-ink">고급 설정 <span className="text-xs font-medium text-muted">선택</span></h2>
                  <p className="mt-0.5 text-xs font-semibold text-muted">수정 가능 범위 · {selectedEditLock.label}</p>
                </div>
                <span aria-hidden="true" className="text-xl font-black text-link transition group-open:rotate-45 dark:text-link">+</span>
              </summary>

              <fieldset className="mt-5 border-t border-line pt-5 dark:border-line">
                <legend className="text-sm font-black text-ink dark:text-ink">질문·선택지·이미지 수정 가능 기간</legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {EDIT_LOCK_PRESETS.map((preset) => {
                    const selected = editLockPreset === preset.value;
                    return (
                      <label
                        key={preset.value}
                        className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-link/40 ${selected ? 'border-primary bg-primary-soft ring-2 ring-primary/20' : 'border-line bg-canvas hover:border-blue-300 dark:border-line dark:bg-surface-muted'}`}
                      >
                        <input
                          type="radio"
                          name="edit-lock-preset"
                          value={preset.value}
                          checked={selected}
                          onChange={() => setEditLockPreset(preset.value)}
                          disabled={isSubmitting}
                          className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-ink dark:text-ink">{preset.label}{selected ? ' · 선택됨' : ''}</span>
                          <span className="mt-1 block break-keep text-xs font-semibold leading-relaxed text-muted">{preset.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs font-semibold leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  수정 가능 기간 안에는 질문·선택지·이미지를 변경할 수 있습니다. 이미 투표가 있는 상태에서 구조를 변경하면 기존 투표는 초기화됩니다.
                </p>
              </fieldset>
            </details>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
            <section className="rounded-3xl border border-line bg-hero p-4 shadow-lg shadow-blue-950/[0.04] sm:p-5" aria-label="질문 미리보기">
              <button
                type="button"
                aria-expanded={previewOpen}
                aria-controls="poll-preview-content"
                onClick={() => setPreviewOpen((open) => !open)}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-link transition hover:border-link hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-link"
              >
                <span className="inline-flex items-center gap-2 text-sm font-bold">
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                  미리보기
                </span>
                <span className="inline-flex items-center gap-2 text-xs font-semibold">
                  {previewOpen ? '접기' : '펼치기'}
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${previewOpen ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
                </span>
              </button>

              <div id="poll-preview-content" hidden={!previewOpen} className="mt-4 border-t border-line pt-4">
                <div className="flex justify-end">
                  <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-white">
                    {selectedCategory ? `${selectedCategory.icon} ${selectedCategory.label}` : '카테고리 선택'}
                  </span>
                </div>

                <h2 className="mt-4 break-words text-xl font-bold leading-snug text-ink dark:text-ink sm:text-2xl">
                  {trimmedTitle || '여기에 투표 질문이 표시돼요.'}
                </h2>

                {description.trim() ? (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-muted dark:text-muted">{description.trim()}</p>
                ) : (
                  <p className="mt-3 text-sm text-muted dark:text-muted">설명을 적으면 이곳에 함께 표시돼요.</p>
                )}

                <div className="mt-5 grid gap-2">
                  {options.map((option, index) => (
                    <div key={option.key} className="overflow-hidden rounded-2xl border border-line bg-surface p-2 dark:border-line dark:bg-surface-muted">
                      {option.previewUrl ? (
                        <div className="relative aspect-[4/3] max-h-48 w-full overflow-hidden rounded-xl bg-surface-muted dark:bg-surface-muted">
                          <Image
                            src={option.previewUrl}
                            alt=""
                            fill
                            unoptimized
                            sizes="380px"
                            className="object-cover"
                          />
                        </div>
                      ) : null}
                      <div className="flex min-h-12 items-center gap-3 px-2 py-2">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-xs font-bold text-link dark:text-link">{index + 1}</span>
                        <span className={`min-w-0 break-words text-sm font-bold ${option.text.trim() ? 'text-ink dark:text-ink' : 'text-muted dark:text-muted'}`}>
                          {option.text.trim() || `선택지 ${index + 1}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs font-medium text-muted dark:text-muted">선택하면 결과를 확인할 수 있어요.</p>
              </div>
            </section>

            {errorMessage ? (
              <div role="alert" aria-live="assertive" className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-700 dark:text-rose-300">
                {errorMessage}
              </div>
            ) : null}

            {ownerTokenFallback ? (
              <section className="rounded-2xl border border-amber-400/40 bg-amber-50 p-4 dark:bg-amber-500/10" aria-labelledby="owner-token-fallback-title">
                <h2 id="owner-token-fallback-title" className="text-sm font-black text-amber-900 dark:text-amber-200">관리 키를 직접 보관해주세요</h2>
                <p className="mt-2 text-xs font-semibold leading-relaxed text-amber-800/80 dark:text-amber-100/70">
                  이 키를 잃으면 로그인 없이 투표 관리 권한을 복구할 수 없습니다. 다른 사람에게 공유하지 마세요.
                </p>
                <code className="mt-3 block break-all rounded-xl border border-amber-300/60 bg-surface px-3 py-2 text-xs font-bold text-ink dark:border-amber-500/20 dark:bg-surface-muted dark:text-ink">
                  {ownerTokenFallback.ownerToken}
                </code>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void copyFallbackOwnerToken()}
                    className="min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-black text-ink transition hover:bg-amber-400"
                  >
                    관리 키 복사
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      releaseAllPreviewUrls();
                      router.push(`/vote/${encodeURIComponent(ownerTokenFallback.pollId)}`);
                    }}
                    className="min-h-11 rounded-xl border border-amber-400 px-4 text-sm font-black text-amber-800 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/10"
                  >
                    투표 페이지로 이동
                  </button>
                </div>
                <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-bold text-amber-800 dark:text-amber-200">
                  {ownerTokenCopyMessage}
                </p>
              </section>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting || Boolean(ownerTokenFallback)}
              aria-busy={isSubmitting}
              className="min-h-14 w-full rounded-xl bg-primary px-5 py-4 text-lg font-black text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? '만드는 중...' : '투표 만들기'}
            </button>
            <p className="text-center text-xs font-medium text-muted dark:text-muted">투표를 만들면 바로 상세 화면으로 이동해요.</p>
          </aside>
        </form>
      </div>
    </main>
  );
}
