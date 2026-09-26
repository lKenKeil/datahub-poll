'use client';

import Image from 'next/image';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPollOptionImagePublicUrl, normalizeOptionImagePaths } from '@/lib/poll-option-image-paths';
import { getStoredPollOwnerToken, removeStoredPollOwnerToken } from '@/lib/poll-owner-storage';
import { supabase } from '@/lib/supabase';
import type { CommentRow, DbPoll, PollCategory } from '@/lib/types';
import { getUnicodeCodePointLength } from '@/lib/unicode-length';

type EditPageParams = { id: string };

type OptionDraft = {
  key: number;
  text: string;
  existingPath: string | null;
  imageFile: File | null;
  previewUrl: string | null;
};

type Feedback = {
  type: 'error' | 'info' | 'success';
  message: string;
};

const CATEGORY_OPTIONS: Array<{ value: PollCategory; label: string; description: string }> = [
  { value: '커뮤니티', label: '커뮤니티', description: '연애, 게임, 콘텐츠와 일상 선택' },
  { value: '라이프스타일', label: '라이프', description: '음식, 스포츠, 여행과 생활' },
  { value: 'IT/테크', label: 'IT·제품', description: '기기, 앱과 서비스' },
  { value: '사회/경제', label: '사회·가치관', description: '사회, 경제와 삶의 기준' },
  { value: '학술/통계', label: '데이터', description: '통계와 객관적 지표' },
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

function getMutationErrorMessage(status: number) {
  if (status === 400 || status === 413) return '입력 내용이나 이미지 파일을 확인해주세요.';
  if (status === 403) return '이 투표의 관리 권한을 확인할 수 없습니다.';
  if (status === 404) return '삭제되었거나 존재하지 않는 투표예요.';
  if (status === 409) return '참여 또는 의견이 생겨 질문·선택지·이미지를 변경할 수 없습니다. 새로고침 후 다시 확인해주세요.';
  if (status === 429) return '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
}

export default function EditPollPage({ params }: { params: Promise<EditPageParams> }) {
  const { id } = use(params);
  const router = useRouter();
  const nextOptionKeyRef = useRef(0);
  const optionsRef = useRef<OptionDraft[]>([]);
  const imageInputRefs = useRef(new Map<number, HTMLInputElement>());
  const activeImageOptionKeyRef = useRef<number | null>(null);
  const deleteConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const mutationInFlightRef = useRef(false);

  const [ownerToken, setOwnerToken] = useState<string | null | undefined>(undefined);
  const [poll, setPoll] = useState<DbPoll | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PollCategory>('커뮤니티');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [activeImageOptionKey, setActiveImageOptionKey] = useState<number | null>(null);
  const [imagesChanged, setImagesChanged] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);

  const isStructureLocked = Boolean(poll && (poll.participants > 0 || commentCount > 0));
  const selectedImageBytes = useMemo(
    () => options.reduce((total, option) => total + (option.imageFile?.size ?? 0), 0),
    [options],
  );

  const updateOptions = useCallback((updater: (previous: OptionDraft[]) => OptionDraft[]) => {
    setOptions((previous) => {
      const next = updater(previous);
      optionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let token: string | null = null;
    try {
      token = getStoredPollOwnerToken(id);
    } catch {
      token = null;
    }
    setOwnerToken(token);

    if (!token) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadPoll = async () => {
      try {
        const response = await fetch(`/api/polls/${encodeURIComponent(id)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = (await response.json()) as {
          poll?: DbPoll | null;
          comments?: CommentRow[];
        };

        if (!response.ok || !json.poll) {
          setFeedback({ type: 'error', message: response.status === 404 ? '삭제되었거나 존재하지 않는 투표예요.' : '투표 정보를 불러오지 못했습니다.' });
          return;
        }

        const loadedPoll = json.poll;
        const imagePaths = normalizeOptionImagePaths(loadedPoll.option_image_paths, loadedPoll.options.length)
          ?? loadedPoll.options.map(() => null);
        const drafts = loadedPoll.options.map((text, index) => {
          const path = imagePaths[index];
          const validPath = getPollOptionImagePublicUrl(supabase, loadedPoll.id, index, path) ? path : null;
          return {
            key: index,
            text,
            existingPath: validPath,
            imageFile: null,
            previewUrl: null,
          };
        });

        nextOptionKeyRef.current = drafts.length;
        optionsRef.current = drafts;
        setOptions(drafts);
        setPoll(loadedPoll);
        setTitle(loadedPoll.title);
        setCategory(loadedPoll.category);
        setDescription(loadedPoll.official_fact ?? '');
        setCommentCount(json.comments?.length ?? 0);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return;
        setFeedback({ type: 'error', message: '네트워크 오류로 투표 정보를 불러오지 못했습니다.' });
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void loadPoll();
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    return () => {
      for (const option of optionsRef.current) {
        if (option.previewUrl) URL.revokeObjectURL(option.previewUrl);
      }
      optionsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (showDeleteConfirmation) deleteConfirmButtonRef.current?.focus();
  }, [showDeleteConfirmation]);

  const activateImageTarget = (optionKey: number) => {
    if (isStructureLocked) return;
    activeImageOptionKeyRef.current = optionKey;
    setActiveImageOptionKey(optionKey);
  };

  const setImageForOption = useCallback((optionKey: number, file: File | null | undefined) => {
    if (!file || isSaving || isDeleting || isStructureLocked) return;
    setFeedback(null);

    const currentIndex = optionsRef.current.findIndex((option) => option.key === optionKey);
    if (currentIndex < 0) {
      setFeedback({ type: 'error', message: '이미지를 넣을 선택지를 먼저 선택해주세요.' });
      return;
    }
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setFeedback({ type: 'error', message: 'JPG, PNG, WebP 이미지만 추가할 수 있어요. GIF와 SVG는 지원하지 않아요.' });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setFeedback({ type: 'error', message: '이미지는 파일당 최대 2MB까지 추가할 수 있어요.' });
      return;
    }

    const current = optionsRef.current[currentIndex];
    const currentTotalBytes = optionsRef.current.reduce(
      (total, option) => total + (option.imageFile?.size ?? 0),
      0,
    );
    if (currentTotalBytes - (current.imageFile?.size ?? 0) + file.size > MAX_MULTIPART_BYTES) {
      setFeedback({ type: 'error', message: '이미지 전체 용량이 너무 큽니다. 파일 크기를 줄여주세요.' });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
    updateOptions((previous) => previous.map((option, index) => (
      index === currentIndex
        ? { ...option, existingPath: null, imageFile: file, previewUrl }
        : option
    )));
    setImagesChanged(true);
  }, [isDeleting, isSaving, isStructureLocked, updateOptions]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isSaving || isDeleting || isStructureLocked) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
      const imageFile = imageItem?.getAsFile()
        ?? Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith('image/'));
      if (!imageFile) return;

      event.preventDefault();
      const optionKey = activeImageOptionKeyRef.current;
      if (optionKey === null || !optionsRef.current.some((option) => option.key === optionKey)) {
        setFeedback({ type: 'error', message: '이미지를 넣을 선택지를 먼저 선택해주세요.' });
        return;
      }
      setImageForOption(optionKey, imageFile);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isDeleting, isSaving, isStructureLocked, setImageForOption]);

  const addOption = () => {
    if (isStructureLocked || options.length >= MAX_OPTIONS) return;
    setFeedback(null);
    const key = nextOptionKeyRef.current++;
    updateOptions((previous) => [
      ...previous,
      { key, text: '', existingPath: null, imageFile: null, previewUrl: null },
    ]);
  };

  const removeOption = (index: number) => {
    if (isStructureLocked || options.length <= MIN_OPTIONS) return;
    setFeedback(null);
    const current = optionsRef.current;
    const removed = current[index];
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    if (removed?.key === activeImageOptionKeyRef.current) {
      activeImageOptionKeyRef.current = null;
      setActiveImageOptionKey(null);
    }

    const shiftedExistingImage = current.slice(index + 1).some((option) => option.existingPath);
    const changedImageMapping = Boolean(removed?.existingPath || removed?.imageFile || shiftedExistingImage);
    updateOptions((previous) => previous
      .filter((_, optionIndex) => optionIndex !== index)
      .map((option, nextIndex) => {
        if (nextIndex < index || !option.existingPath) return option;
        return { ...option, existingPath: null };
      }));

    if (changedImageMapping) {
      setImagesChanged(true);
      if (shiftedExistingImage) {
        setFeedback({ type: 'info', message: '선택지 위치가 바뀌어 이동한 선택지의 기존 이미지는 다시 선택해주세요.' });
      }
    }
  };

  const removeOptionImage = (index: number) => {
    if (isStructureLocked || isSaving || isDeleting) return;
    const current = optionsRef.current[index];
    if (!current?.existingPath && !current?.imageFile) return;
    if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
    updateOptions((previous) => previous.map((option, optionIndex) => (
      optionIndex === index
        ? { ...option, existingPath: null, imageFile: null, previewUrl: null }
        : option
    )));
    setImagesChanged(true);
    setFeedback(null);
  };

  const validationMessage = useMemo(() => {
    const trimmedTitle = title.trim();
    const trimmedOptions = options.map((option) => option.text.trim());
    const titleLength = getUnicodeCodePointLength(trimmedTitle);
    if (titleLength < MIN_TITLE_LENGTH || titleLength > MAX_TITLE_LENGTH) {
      return `투표 질문은 ${MIN_TITLE_LENGTH}~${MAX_TITLE_LENGTH}자로 입력해주세요.`;
    }
    if (trimmedOptions.length < MIN_OPTIONS || trimmedOptions.length > MAX_OPTIONS) {
      return `선택지는 ${MIN_OPTIONS}~${MAX_OPTIONS}개가 필요해요.`;
    }
    if (trimmedOptions.some((option) => !option)) return '빈 선택지가 있어요.';
    if (trimmedOptions.some((option) => getUnicodeCodePointLength(option) > MAX_OPTION_LENGTH)) {
      return `선택지는 ${MAX_OPTION_LENGTH}자 이하로 입력해주세요.`;
    }
    if (new Set(trimmedOptions.map((option) => option.toLocaleLowerCase())).size !== trimmedOptions.length) {
      return '중복된 선택지가 있어요.';
    }
    if (getUnicodeCodePointLength(description.trim()) > MAX_DESCRIPTION_LENGTH) {
      return `설명은 ${MAX_DESCRIPTION_LENGTH}자 이하로 입력해주세요.`;
    }
    return '';
  }, [description, options, title]);

  const releasePreviewUrls = () => {
    for (const option of optionsRef.current) {
      if (option.previewUrl) URL.revokeObjectURL(option.previewUrl);
    }
    optionsRef.current = optionsRef.current.map((option) => ({ ...option, previewUrl: null }));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ownerToken || !poll || mutationInFlightRef.current) return;
    if (validationMessage) {
      setFeedback({ type: 'error', message: validationMessage });
      return;
    }
    if (selectedImageBytes > MAX_MULTIPART_BYTES) {
      setFeedback({ type: 'error', message: '이미지 전체 용량이 너무 큽니다. 파일 크기를 줄여주세요.' });
      return;
    }

    mutationInFlightRef.current = true;
    setIsSaving(true);
    setFeedback(null);
    try {
      const trimmedDescription = description.trim();
      const requestBodyHasImages = imagesChanged || options.some((option) => option.imageFile);
      let requestInit: RequestInit;

      if (requestBodyHasImages) {
        const formData = new FormData();
        formData.append('title', title.trim());
        formData.append('category', category);
        formData.append('options', JSON.stringify(options.map((option) => option.text.trim())));
        formData.append('officialFact', trimmedDescription);
        formData.append('retainedOptionImagePaths', JSON.stringify(
          options.map((option) => option.imageFile ? null : option.existingPath),
        ));
        options.forEach((option, index) => {
          if (option.imageFile) formData.append(`optionImages[${index}]`, option.imageFile);
        });
        requestInit = { method: 'PATCH', body: formData };
      } else if (isStructureLocked) {
        requestInit = {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, officialFact: trimmedDescription }),
        };
      } else {
        requestInit = {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            category,
            options: options.map((option) => option.text.trim()),
            officialFact: trimmedDescription,
          }),
        };
      }

      requestInit.headers = {
        ...requestInit.headers,
        'X-Poll-Owner-Token': ownerToken,
      };
      const response = await fetch(`/api/polls/${encodeURIComponent(id)}`, requestInit);
      if (!response.ok) {
        setFeedback({ type: 'error', message: getMutationErrorMessage(response.status) });
        return;
      }

      setFeedback({ type: 'success', message: '수정했어요.' });
      releasePreviewUrls();
      router.push(`/vote/${encodeURIComponent(id)}`);
    } catch {
      setFeedback({ type: 'error', message: '네트워크 오류로 저장하지 못했습니다.' });
    } finally {
      mutationInFlightRef.current = false;
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!ownerToken || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setIsDeleting(true);
    setFeedback(null);
    try {
      const response = await fetch(`/api/polls/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Poll-Owner-Token': ownerToken },
      });
      if (!response.ok) {
        setFeedback({ type: 'error', message: getMutationErrorMessage(response.status) });
        return;
      }

      try {
        removeStoredPollOwnerToken(id);
      } catch {
        // The poll is already deleted; a stale local credential has no server authority.
      }
      releasePreviewUrls();
      router.replace('/');
    } catch {
      setFeedback({ type: 'error', message: '네트워크 오류로 삭제하지 못했습니다.' });
    } finally {
      mutationInFlightRef.current = false;
      setIsDeleting(false);
    }
  };

  if (isLoading || ownerToken === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-900 dark:bg-[#020617] dark:text-white">
        <p className="font-bold text-slate-500">투표 관리 정보를 불러오는 중...</p>
      </main>
    );
  }

  if (!ownerToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-20 text-slate-900 dark:bg-[#020617] dark:text-white">
        <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-950/[0.04] dark:border-white/10 dark:bg-white/[0.035] sm:p-10">
          <span aria-hidden="true" className="text-4xl">🔐</span>
          <h1 className="mt-4 text-2xl font-black">관리 권한이 없어요</h1>
          <p className="mt-3 break-keep text-sm font-semibold leading-relaxed text-slate-500 dark:text-slate-300">
            이 브라우저에 이 투표의 관리 권한이 없습니다. 브라우저 데이터가 삭제되었거나 다른 기기라면 로그인 없는 관리 권한은 복구할 수 없어요.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Link href={`/vote/${encodeURIComponent(id)}`} className="flex-1 rounded-full bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-500">투표로 돌아가기</Link>
            <Link href="/" className="flex-1 rounded-full border border-slate-300 px-5 py-3 text-sm font-black transition hover:border-blue-500 hover:text-blue-600 dark:border-white/15">홈으로</Link>
          </div>
        </section>
      </main>
    );
  }

  if (!poll) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-20 text-slate-900 dark:bg-[#020617] dark:text-white">
        <section className="w-full max-w-xl rounded-[2rem] border border-slate-200 bg-white p-7 text-center dark:border-white/10 dark:bg-white/[0.035]">
          <h1 className="text-2xl font-black">투표를 불러올 수 없어요</h1>
          <p role="alert" className="mt-3 text-sm font-semibold text-rose-600 dark:text-rose-300">{feedback?.message ?? '잠시 후 다시 시도해주세요.'}</p>
          <Link href="/" className="mt-6 inline-flex rounded-full bg-blue-600 px-6 py-3 text-sm font-black text-white">홈으로</Link>
        </section>
      </main>
    );
  }

  const controlsDisabled = isSaving || isDeleting;

  return (
    <main className="min-h-screen w-full min-w-0 overflow-x-hidden bg-slate-50 pb-24 text-slate-900 dark:bg-[#020617] dark:text-slate-100">
      <nav className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur-xl dark:border-white/5 dark:bg-[#020617]/85">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href={`/vote/${encodeURIComponent(id)}`} className="text-sm font-black text-slate-500 transition hover:text-blue-600 dark:hover:text-white">← 투표로 돌아가기</Link>
          <span className="text-sm font-black text-slate-900 dark:text-white">내 투표 관리</span>
        </div>
      </nav>

      <div className="mx-auto grid max-w-[1280px] min-w-0 gap-6 px-4 pt-8 sm:px-6 md:pt-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <form onSubmit={handleSave} aria-busy={isSaving} className="min-w-0 space-y-5">
          <header className="rounded-[2rem] border border-blue-200/70 bg-gradient-to-br from-white via-blue-50 to-cyan-50 p-6 dark:border-blue-500/20 dark:from-slate-900 dark:via-[#07152f] dark:to-[#052631] sm:p-8">
            <span className="inline-flex rounded-full bg-blue-600 px-3 py-1 text-xs font-black text-white">투표 수정</span>
            <h1 className="mt-4 text-3xl font-black tracking-[-0.035em] text-slate-950 dark:text-white">내 투표를 관리하세요</h1>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-500 dark:text-slate-300">내용을 수정하거나 더 이상 필요하지 않은 투표를 삭제할 수 있어요.</p>
          </header>

          {isStructureLocked ? (
            <div id="structure-lock-reason" className="rounded-2xl border border-amber-400/40 bg-amber-50 px-5 py-4 text-sm font-bold leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              이미 참여 또는 의견이 있어 질문과 선택지, 이미지는 변경할 수 없습니다. 카테고리와 설명만 수정할 수 있어요.
            </div>
          ) : null}

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
            <label htmlFor="edit-poll-title" className="text-lg font-black text-slate-950 dark:text-white">투표 질문</label>
            <input
              id="edit-poll-title"
              value={title}
              onChange={(event) => { setTitle(event.target.value); setFeedback(null); }}
              disabled={controlsDisabled || isStructureLocked}
              aria-describedby={isStructureLocked ? 'structure-lock-reason edit-title-count' : 'edit-title-count'}
              className="mt-4 w-full rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 text-base font-bold outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
            <p id="edit-title-count" className="mt-2 text-right text-xs font-semibold text-slate-400">{getUnicodeCodePointLength(title)}/{MAX_TITLE_LENGTH}</p>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
            <h2 className="text-lg font-black text-slate-950 dark:text-white">카테고리</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {CATEGORY_OPTIONS.map((item) => (
                <label key={item.value} className={`cursor-pointer rounded-2xl border p-4 transition ${category === item.value ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/10 dark:bg-blue-500/10' : 'border-slate-200 bg-slate-50 hover:border-blue-300 dark:border-white/10 dark:bg-white/[0.025]'}`}>
                  <input type="radio" name="category" value={item.value} checked={category === item.value} onChange={() => setCategory(item.value)} disabled={controlsDisabled} className="sr-only" />
                  <span className="block text-sm font-black">{item.label}</span>
                  <span className="mt-1 block text-xs font-semibold text-slate-500">{item.description}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">선택지</h2>
                <p className="mt-1 text-xs font-semibold text-slate-500">JPG, PNG, WebP · 파일당 최대 2MB</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500 dark:bg-white/5">{options.length}/{MAX_OPTIONS}</span>
            </div>

            <div className="mt-5 grid gap-4">
              {options.map((option, index) => {
                const existingUrl = option.existingPath
                  ? getPollOptionImagePublicUrl(supabase, id, index, option.existingPath)
                  : null;
                const imageUrl = option.previewUrl ?? existingUrl;
                return (
                  <div
                    key={option.key}
                    onPointerDown={() => activateImageTarget(option.key)}
                    onFocusCapture={() => activateImageTarget(option.key)}
                    className={`min-w-0 rounded-2xl border bg-slate-50 p-3 transition dark:bg-white/[0.025] sm:p-4 ${activeImageOptionKey === option.key && !isStructureLocked ? 'border-blue-400 ring-2 ring-blue-500/10' : 'border-slate-200 dark:border-white/10'}`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label htmlFor={`edit-option-${index}`} className="text-sm font-black">선택지 {index + 1}</label>
                      <span className="text-xs font-semibold text-slate-400">{getUnicodeCodePointLength(option.text)}/{MAX_OPTION_LENGTH}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                      <input
                        id={`edit-option-${index}`}
                        value={option.text}
                        onChange={(event) => updateOptions((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, text: event.target.value } : item))}
                        disabled={controlsDisabled || isStructureLocked}
                        aria-describedby={isStructureLocked ? 'structure-lock-reason' : undefined}
                        className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white p-3.5 font-semibold outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5"
                      />
                      <button type="button" onClick={() => removeOption(index)} disabled={controlsDisabled || isStructureLocked || options.length <= MIN_OPTIONS} aria-label={`선택지 ${index + 1} 삭제`} className="min-h-12 rounded-xl border border-slate-300 px-4 text-sm font-black text-slate-500 transition hover:border-rose-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/15">삭제</button>
                    </div>

                    <input
                      ref={(element) => { if (element) imageInputRefs.current.set(option.key, element); else imageInputRefs.current.delete(option.key); }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      tabIndex={-1}
                      disabled={controlsDisabled || isStructureLocked}
                      onChange={(event) => { setImageForOption(option.key, event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}
                      aria-label={`선택지 ${index + 1} 이미지 파일`}
                    />

                    {imageUrl ? (
                      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
                        <div className="relative aspect-[4/3] max-h-72 w-full overflow-hidden bg-slate-200 dark:bg-slate-900">
                          <Image src={imageUrl} alt="" fill unoptimized sizes="(max-width: 640px) 100vw, 640px" className="object-cover" />
                        </div>
                        <div className="flex flex-col gap-2 p-3 sm:flex-row">
                          <button type="button" onClick={() => imageInputRefs.current.get(option.key)?.click()} disabled={controlsDisabled || isStructureLocked} aria-label={`선택지 ${index + 1} 이미지 변경`} className="min-h-11 flex-1 rounded-xl border border-blue-300 px-3 text-sm font-black text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/30 dark:text-blue-300">이미지 변경</button>
                          <button type="button" onClick={() => removeOptionImage(index)} disabled={controlsDisabled || isStructureLocked} aria-label={`선택지 ${index + 1} 이미지 삭제`} className="min-h-11 flex-1 rounded-xl border border-rose-300 px-3 text-sm font-black text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/30 dark:text-rose-300">이미지 삭제</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { activateImageTarget(option.key); imageInputRefs.current.get(option.key)?.click(); }}
                        disabled={controlsDisabled || isStructureLocked}
                        aria-label={`선택지 ${index + 1} 이미지 영역. 붙여넣거나 파일을 선택할 수 있습니다.`}
                        className="mt-3 min-h-16 w-full rounded-xl border border-dashed border-blue-300 bg-white px-4 py-3 text-sm font-black text-blue-600 transition hover:border-blue-500 hover:bg-blue-50 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-500/30 dark:bg-white/[0.025] dark:text-blue-300"
                      >
                        <span className="block">+ 이미지 추가</span>
                        <span className="mt-1 block text-xs font-semibold text-slate-500">이미지를 붙여넣거나 파일을 선택하세요</span>
                        <span className="mt-1 hidden text-[11px] font-semibold text-slate-400 sm:block">Ctrl+V 또는 Cmd+V로 이미지 붙여넣기</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addOption} disabled={controlsDisabled || isStructureLocked || options.length >= MAX_OPTIONS} className="mt-4 min-h-12 w-full rounded-2xl border border-dashed border-blue-400 px-4 text-sm font-black text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10">+ 선택지 추가</button>
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-7">
            <label htmlFor="edit-description" className="text-lg font-black text-slate-950 dark:text-white">설명 또는 참고정보 <span className="text-sm text-slate-400">(선택)</span></label>
            <textarea id="edit-description" value={description} onChange={(event) => { setDescription(event.target.value); setFeedback(null); }} disabled={controlsDisabled} rows={5} className="mt-4 w-full resize-y rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 font-semibold leading-relaxed outline-none transition focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/5" placeholder="투표에 필요한 배경이나 조건이 있다면 적어주세요." />
            <p className="mt-2 text-right text-xs font-semibold text-slate-400">{getUnicodeCodePointLength(description)}/{MAX_DESCRIPTION_LENGTH}</p>
          </section>

          <div aria-live="polite" aria-atomic="true">
            {feedback ? (
              <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`rounded-2xl border px-5 py-4 text-sm font-bold ${feedback.type === 'error' ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' : feedback.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>{feedback.message}</div>
            ) : null}
          </div>

          <button type="submit" disabled={controlsDisabled} className="min-h-14 w-full rounded-2xl bg-blue-600 px-6 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">{isSaving ? '저장 중...' : '변경사항 저장'}</button>
        </form>

        <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.035]">
            <h2 className="font-black text-slate-950 dark:text-white">현재 상태</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-1">
              <div className="rounded-2xl bg-slate-100 p-4 dark:bg-white/5"><dt className="text-xs font-bold text-slate-500">참여자</dt><dd className="mt-1 text-lg font-black">{poll.participants.toLocaleString()}명</dd></div>
              <div className="rounded-2xl bg-slate-100 p-4 dark:bg-white/5"><dt className="text-xs font-bold text-slate-500">의견</dt><dd className="mt-1 text-lg font-black">{commentCount}개</dd></div>
            </dl>
            <p className="mt-4 text-xs font-semibold leading-relaxed text-slate-500">실제 권한과 수정 가능 여부는 저장할 때 서버에서 다시 확인합니다.</p>
          </section>

          <section className="rounded-[2rem] border border-rose-300/70 bg-rose-50 p-5 dark:border-rose-500/25 dark:bg-rose-500/10" aria-busy={isDeleting}>
            <h2 className="font-black text-rose-900 dark:text-rose-200">투표 삭제</h2>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-rose-800/80 dark:text-rose-100/70">투표와 의견, 이미지가 함께 삭제되며 이 작업은 되돌릴 수 없습니다.</p>
            {!showDeleteConfirmation ? (
              <button type="button" onClick={() => setShowDeleteConfirmation(true)} disabled={controlsDisabled} className="mt-5 min-h-12 w-full rounded-xl border border-rose-400 bg-white px-4 text-sm font-black text-rose-600 transition hover:bg-rose-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-transparent">투표 삭제</button>
            ) : (
              <div role="alertdialog" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-description" className="mt-5 rounded-2xl border border-rose-400/50 bg-white p-4 dark:bg-slate-950/50">
                <h3 id="delete-confirm-title" className="text-sm font-black text-rose-800 dark:text-rose-200">정말 삭제할까요?</h3>
                <p id="delete-confirm-description" className="mt-2 text-xs font-semibold leading-relaxed text-slate-600 dark:text-slate-300">삭제 후에는 투표와 모든 의견을 복구할 수 없습니다.</p>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row lg:flex-col">
                  <button type="button" onClick={() => setShowDeleteConfirmation(false)} disabled={isDeleting} className="min-h-11 flex-1 rounded-xl border border-slate-300 px-4 text-sm font-black disabled:opacity-50 dark:border-white/15">취소</button>
                  <button ref={deleteConfirmButtonRef} type="button" onClick={() => void handleDelete()} disabled={isDeleting} className="min-h-11 flex-1 rounded-xl bg-rose-600 px-4 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60">{isDeleting ? '삭제 중...' : '영구 삭제'}</button>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
