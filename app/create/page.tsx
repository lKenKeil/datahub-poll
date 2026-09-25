'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PollCategory } from '@/lib/types';
import { storePollOwnerToken } from '@/lib/poll-owner-storage';

type InterestCategory =
  | '연애·관계'
  | '게임'
  | '스포츠'
  | '음식'
  | '엔터·콘텐츠'
  | 'IT·제품'
  | '라이프'
  | '가치관'
  | '데이터';

type InterestCategoryOption = {
  label: InterestCategory;
  icon: string;
  description: string;
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

const CATEGORY_OPTIONS: InterestCategoryOption[] = [
  { label: '연애·관계', icon: '💞', description: '연애, 친구, 인간관계', dbValue: '커뮤니티' },
  { label: '게임', icon: '🎮', description: '게임과 플레이 취향', dbValue: '커뮤니티' },
  { label: '스포츠', icon: '⚽', description: '종목, 팀, 선수', dbValue: '라이프스타일' },
  { label: '음식', icon: '🍜', description: '메뉴와 맛 취향', dbValue: '라이프스타일' },
  { label: '엔터·콘텐츠', icon: '🎬', description: '영화, 음악, 웹툰', dbValue: '커뮤니티' },
  { label: 'IT·제품', icon: '📱', description: '기기, 앱, 서비스', dbValue: 'IT/테크' },
  { label: '라이프', icon: '🌿', description: '일상, 여행, 건강', dbValue: '라이프스타일' },
  { label: '가치관', icon: '💭', description: '사회, 경제, 삶의 기준', dbValue: '사회/경제' },
  { label: '데이터', icon: '📊', description: '통계와 객관적 지표', dbValue: '학술/통계' },
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

export default function CreatePollPage() {
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

  const trimmedTitle = title.trim();
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
    if (trimmedTitle.length < MIN_TITLE_LENGTH) return `투표 질문은 ${MIN_TITLE_LENGTH}자 이상 입력해주세요.`;
    if (trimmedOptions.length < MIN_OPTIONS) return '선택지는 최소 2개가 필요해요.';
    if (trimmedOptions.some((option) => !option)) return '빈 선택지가 있어요. 모든 선택지를 입력해주세요.';

    const uniqueOptions = new Set(trimmedOptions.map((option) => option.toLowerCase()));
    if (uniqueOptions.size !== trimmedOptions.length) return '중복된 선택지가 있어요.';
    return '';
  }, [interestCategory, trimmedOptions, trimmedTitle.length]);

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

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 pb-24 text-slate-900 dark:bg-[#020617] dark:text-slate-100">
      <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl dark:border-white/5 dark:bg-[#020617]/80">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-4 pr-24 sm:px-6 sm:pr-28 lg:px-8 lg:pr-28">
          <Link href="/" className="text-sm font-black text-slate-500 transition hover:text-blue-600 dark:hover:text-white">← 홈으로</Link>
          <span className="hidden rounded-full bg-blue-500/10 px-3 py-1 text-xs font-black text-blue-600 dark:text-blue-300 sm:inline-flex">투표 만들기</span>
        </div>
      </nav>

      <div className="mx-auto max-w-[1280px] space-y-8 px-4 pt-8 sm:px-6 md:pt-12 lg:px-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-blue-200/70 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-6 dark:border-blue-500/20 dark:from-slate-900 dark:via-[#07152f] dark:to-[#052631] md:p-10">
          <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <span className="inline-flex rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">나만의 투표</span>
            <h1 className="mt-5 text-4xl font-black leading-tight tracking-[-0.04em] text-slate-950 dark:text-white md:text-5xl">투표 만들기</h1>
            <p className="mt-4 break-keep text-base font-semibold leading-relaxed text-slate-600 dark:text-slate-300 md:text-lg">
              사람들이 쉽게 참여할 수 있는 질문을 만들어보세요. 질문은 짧고 명확할수록 좋아요.
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            <fieldset className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
              <legend className="sr-only">카테고리</legend>
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">1</span>
                <div>
                  <h2 className="text-xl font-black text-slate-950 dark:text-white">카테고리</h2>
                  <p className="mt-1 text-sm text-slate-500">어떤 주제의 투표인지 골라주세요.</p>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                      className={`min-h-24 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${selected ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/15 dark:bg-blue-500/10' : 'border-slate-200 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/60 dark:border-white/10 dark:bg-white/[0.025] dark:hover:bg-blue-500/10'}`}
                    >
                      <span className="text-xl" aria-hidden="true">{option.icon}</span>
                      <span className="mt-2 block text-sm font-black text-slate-900 dark:text-white">{option.label}</span>
                      <span className="mt-1 hidden text-[11px] font-semibold leading-snug text-slate-500 sm:block">{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">2</span>
                <div>
                  <label htmlFor="poll-title" className="text-xl font-black text-slate-950 dark:text-white">투표 질문</label>
                  <p className="mt-1 text-sm text-slate-500">한눈에 이해할 수 있게 적어주세요.</p>
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
                className="mt-6 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-base font-bold outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white sm:text-lg"
                placeholder="예: 평생 짜장면만 먹기 vs 평생 짬뽕만 먹기"
                maxLength={MAX_TITLE_LENGTH}
                aria-describedby="poll-title-help"
              />
              <div id="poll-title-help" className="mt-2 flex justify-between gap-4 text-xs font-semibold text-slate-500">
                <span>{MIN_TITLE_LENGTH}자 이상 입력해주세요.</span>
                <span>{title.length}/{MAX_TITLE_LENGTH}</span>
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm font-black text-white">3</span>
                <div>
                  <h2 className="text-xl font-black text-slate-950 dark:text-white">선택지</h2>
                  <p className="mt-1 text-sm text-slate-500">2개부터 최대 {MAX_OPTIONS}개까지 만들 수 있어요.</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">JPG, PNG, WebP · 파일당 최대 2MB</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                {options.map((option, index) => (
                  <div
                    key={option.key}
                    onPointerDown={() => activateImageTarget(option.key)}
                    onFocusCapture={() => activateImageTarget(option.key)}
                    className={`rounded-2xl border bg-slate-50 p-3 transition dark:bg-white/[0.025] sm:p-4 ${
                      activeImageOptionKey === option.key
                        ? 'border-blue-400 ring-2 ring-blue-500/10 dark:border-blue-400/70'
                        : 'border-slate-200 dark:border-white/10'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label htmlFor={`poll-option-${index}`} className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-xs text-blue-600 dark:text-blue-300">{index + 1}</span>
                        선택지 {index + 1}
                      </label>
                      <div className="flex items-center gap-2">
                        {activeImageOptionKey === option.key ? (
                          <span className="hidden rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-600 dark:bg-blue-500/15 dark:text-blue-300 sm:inline-flex">
                            여기에 붙여넣기
                          </span>
                        ) : null}
                        <span className="text-[11px] font-semibold text-slate-400">{option.text.length}/{MAX_OPTION_LENGTH}</span>
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <input
                        id={`poll-option-${index}`}
                        type="text"
                        value={option.text}
                        onChange={(event) => handleOptionChange(index, event.target.value)}
                        disabled={isSubmitting}
                        className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white p-3.5 text-base font-semibold outline-none transition placeholder:text-slate-400 focus:border-blue-500 dark:border-white/10 dark:bg-white/5 dark:text-white"
                        placeholder={index === 0 ? '예: 짜장면' : index === 1 ? '예: 짬뽕' : `선택지 ${index + 1}`}
                        maxLength={MAX_OPTION_LENGTH}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(index)}
                        disabled={isSubmitting || options.length <= MIN_OPTIONS}
                        className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-500 transition hover:border-rose-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/15 dark:text-slate-300"
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
                        className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-white/10 dark:bg-white/5"
                        tabIndex={0}
                        aria-label={`선택지 ${index + 1} 이미지 영역. 붙여넣거나 파일을 선택할 수 있습니다.`}
                      >
                        <div className="relative aspect-[4/3] max-h-64 w-full overflow-hidden bg-slate-200 dark:bg-slate-900">
                          <Image
                            src={option.previewUrl}
                            alt=""
                            fill
                            unoptimized
                            sizes="(max-width: 640px) 100vw, 640px"
                            className="object-cover"
                          />
                        </div>
                        <div className="p-3">
                          <p className="mb-2 hidden text-center text-xs font-semibold text-slate-400 sm:block">Ctrl+V 또는 Cmd+V로 이미지를 붙여넣을 수 있어요.</p>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() => imageInputRefs.current.get(option.key)?.click()}
                              disabled={isSubmitting}
                              aria-label={`선택지 ${index + 1} 이미지 변경`}
                              className="min-h-11 flex-1 rounded-xl border border-blue-300 px-4 text-sm font-black text-blue-600 transition hover:bg-blue-50 disabled:cursor-wait disabled:opacity-50 dark:border-blue-500/30 dark:text-blue-300 dark:hover:bg-blue-500/10"
                            >
                              이미지 변경
                            </button>
                            <button
                              type="button"
                              onClick={() => removeOptionImage(index)}
                              disabled={isSubmitting}
                              aria-label={`선택지 ${index + 1} 이미지 삭제`}
                              className="min-h-11 flex-1 rounded-xl border border-rose-300 px-4 text-sm font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
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
                        className="mt-3 min-h-16 w-full rounded-xl border border-dashed border-blue-300 bg-white px-4 py-3 text-sm font-black text-blue-600 transition hover:border-blue-500 hover:bg-blue-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-wait disabled:opacity-50 dark:border-blue-500/30 dark:bg-white/[0.025] dark:text-blue-300 dark:hover:bg-blue-500/10"
                      >
                        <span className="block">+ 이미지 추가</span>
                        <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">이미지를 붙여넣거나 파일을 선택하세요</span>
                        <span className="mt-1 hidden text-[11px] font-semibold text-slate-400 sm:block">Ctrl+V 또는 Cmd+V로 이미지 붙여넣기</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {selectedImageCount > 0 ? (
                <p className="mt-4 text-center text-xs font-bold text-slate-500" aria-live="polite">
                  이미지 {selectedImageCount}개 · {(selectedImageBytes / 1024 / 1024).toFixed(2)}MB / 약 4.3MB
                </p>
              ) : null}

              <button
                type="button"
                onClick={addOption}
                disabled={isSubmitting || options.length >= MAX_OPTIONS}
                className="mt-4 min-h-12 w-full rounded-2xl border border-dashed border-blue-400 px-4 text-sm font-black text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
              >
                {options.length >= MAX_OPTIONS ? `선택지는 ${MAX_OPTIONS}개까지 추가할 수 있어요` : '+ 선택지 추가'}
              </button>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-sm font-black text-white dark:bg-slate-200 dark:text-slate-900">4</span>
                <div>
                  <label htmlFor="poll-description" className="text-xl font-black text-slate-950 dark:text-white">설명 또는 참고정보 <span className="text-sm font-bold text-slate-400">(선택)</span></label>
                  <p className="mt-1 text-sm text-slate-500">투표에 필요한 배경이나 조건이 있다면 적어주세요.</p>
                </div>
              </div>
              <textarea
                id="poll-description"
                value={description}
                onChange={(event) => {
                  clearError();
                  setDescription(event.target.value);
                }}
                className="mt-6 h-32 w-full resize-none rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-base font-medium outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 dark:border-white/10 dark:bg-white/5 dark:text-white"
                placeholder="예: 가격은 같다고 가정하고 골라주세요."
                maxLength={MAX_DESCRIPTION_LENGTH}
              />
              <p className="mt-2 text-right text-xs font-semibold text-slate-500">{description.length}/{MAX_DESCRIPTION_LENGTH}</p>
            </section>
          </div>

          <aside className="min-w-0 space-y-4 lg:sticky lg:top-28">
            <section className="rounded-[2rem] border border-blue-200 bg-gradient-to-br from-white to-blue-50 p-5 shadow-xl shadow-blue-950/[0.05] dark:border-blue-500/20 dark:from-slate-900 dark:to-[#07152f] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-black text-blue-600 dark:text-blue-300">5. 미리보기</span>
                  <p className="mt-1 text-xs text-slate-500">상세 화면에서 보일 모습을 확인해보세요.</p>
                </div>
                <span className="shrink-0 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-black text-white">
                  {selectedCategory ? `${selectedCategory.icon} ${selectedCategory.label}` : '카테고리 선택'}
                </span>
              </div>

              <h2 className="mt-6 break-words text-2xl font-black leading-snug text-slate-950 dark:text-white">
                {trimmedTitle || '여기에 투표 질문이 표시돼요.'}
              </h2>

              {description.trim() ? (
                <p className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-slate-600 dark:text-slate-300">{description.trim()}</p>
              ) : (
                <p className="mt-3 text-sm text-slate-400">설명을 적으면 이 곳에 함께 표시돼요.</p>
              )}

              <div className="mt-6 grid gap-2">
                {options.map((option, index) => (
                  <div key={option.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-2 dark:border-white/10 dark:bg-white/5">
                    {option.previewUrl ? (
                      <div className="relative aspect-[4/3] max-h-48 w-full overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-900">
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
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-xs font-black text-blue-600 dark:text-blue-300">{index + 1}</span>
                      <span className={`min-w-0 break-words text-sm font-black ${option.text.trim() ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400'}`}>
                        {option.text.trim() || `선택지 ${index + 1}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-center text-xs font-semibold text-slate-400">선택하면 결과를 확인할 수 있어요.</p>
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
                <code className="mt-3 block break-all rounded-xl border border-amber-300/60 bg-white px-3 py-2 text-xs font-bold text-slate-800 dark:border-amber-500/20 dark:bg-slate-950 dark:text-slate-100">
                  {ownerTokenFallback.ownerToken}
                </code>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void copyFallbackOwnerToken()}
                    className="min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-black text-slate-950 transition hover:bg-amber-400"
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
              className="min-h-14 w-full rounded-2xl bg-blue-600 px-5 py-4 text-lg font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? '만드는 중...' : '투표 만들기'}
            </button>
            <p className="text-center text-xs font-semibold text-slate-400">투표를 만들면 바로 상세 화면으로 이동해요.</p>
          </aside>
        </form>
      </div>
    </main>
  );
}
