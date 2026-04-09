'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PollCategory } from '@/lib/types';

const categories: PollCategory[] = ['학술/통계', 'IT/테크', '사회/경제', '라이프스타일', '커뮤니티'];
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

function getCategoryBadge(category: PollCategory) {
  if (category === '학술/통계') return 'VERIFIED';
  if (category === 'IT/테크') return 'TREND';
  if (category === '사회/경제') return 'SOCIAL';
  if (category === '라이프스타일') return 'LIFESTYLE';
  return 'COMMUNITY';
}

export default function CreatePollPage() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PollCategory>('커뮤니티');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [officialFact, setOfficialFact] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedOptions = useMemo(() => options.map((opt) => opt.trim()), [options]);

  const validationMessage = useMemo(() => {
    if (!title.trim()) return '논제 제목을 입력해주세요.';
    if (title.trim().length < 6) return '논제 제목은 6자 이상이 좋습니다.';

    if (trimmedOptions.length < MIN_OPTIONS) return '선택지는 최소 2개가 필요합니다.';
    if (trimmedOptions.some((opt) => !opt)) return '모든 선택지를 입력해주세요.';

    const unique = new Set(trimmedOptions.map((opt) => opt.toLowerCase()));
    if (unique.size !== trimmedOptions.length) return '중복된 선택지가 있습니다.';

    return '';
  }, [title, trimmedOptions]);

  const handleOptionChange = (index: number, value: string) => {
    setOptions((prev) => prev.map((opt, i) => (i === index ? value : opt)));
  };

  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((prev) => [...prev, '']);
  };

  const removeOption = (index: number) => {
    if (options.length <= MIN_OPTIONS) return;
    setOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }

    setIsSubmitting(true);

    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload: Record<string, unknown> = {
      id,
      title: `🔥 ${title.trim()}`,
      category,
      options: trimmedOptions,
      votes: Array(trimmedOptions.length).fill(0),
      participants: 0,
    };

    if (officialFact.trim()) {
      payload.official_fact = officialFact.trim();
    }

    try {
      const response = await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { error?: string };

      if (!response.ok) {
        setErrorMessage(json.error ?? '등록 중 오류가 발생했습니다.');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setErrorMessage('네트워크 오류로 등록하지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#020617] dark:text-slate-100 p-6">
      <div className="max-w-3xl mx-auto mt-8 space-y-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-block px-5 py-2.5 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-full text-blue-600 dark:text-blue-300 font-bold hover:bg-blue-50 dark:hover:bg-white/10 transition-colors"
          >
            ← 돌아가기
          </Link>
          <span className="text-xs font-black tracking-wider text-slate-500 dark:text-slate-400">CREATE NEW TOPIC</span>
        </div>

        <section className="grid gap-4">
          <h1 className="text-4xl md:text-5xl font-black tracking-tight text-slate-900 dark:text-white">새로운 논제 만들기</h1>
          <p className="text-slate-600 dark:text-slate-400 font-medium">
            사람들이 바로 참여하고 싶은 질문을 올려주세요. 제목은 선명하게, 선택지는 명확하게.
          </p>
        </section>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 shadow-xl rounded-[2.2rem] p-8 md:p-10 space-y-8"
        >
          <div className="space-y-3">
            <label className="block text-sm font-black tracking-wide text-slate-600 dark:text-slate-300">논제 제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 focus:border-blue-500 outline-none text-lg font-bold"
              placeholder="예: 갤럭시 울트라 vs 아이폰 프로, 실제 만족도는?"
              maxLength={120}
            />
            <p className="text-xs text-slate-500 dark:text-slate-500">{title.trim().length}/120</p>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-black tracking-wide text-slate-600 dark:text-slate-300">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as PollCategory)}
              className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 focus:border-blue-500 outline-none text-base font-bold"
            >
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-black tracking-wide text-slate-600 dark:text-slate-300">선택지</label>
              <button
                type="button"
                onClick={addOption}
                disabled={options.length >= MAX_OPTIONS}
                className="text-xs font-black px-3 py-1.5 rounded-full border border-slate-300 dark:border-white/20 text-slate-600 dark:text-slate-300 disabled:opacity-40"
              >
                + 선택지 추가
              </button>
            </div>

            <div className="grid gap-3">
              {options.map((option, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => handleOptionChange(index, e.target.value)}
                    className="flex-1 p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 focus:border-blue-500 outline-none text-base font-semibold"
                    placeholder={`선택지 ${index + 1}`}
                    maxLength={50}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    disabled={options.length <= MIN_OPTIONS}
                    className="px-4 rounded-2xl border border-slate-300 dark:border-white/20 text-slate-500 dark:text-slate-300 disabled:opacity-30"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-black tracking-wide text-slate-600 dark:text-slate-300">오피셜 팩트 (선택)</label>
            <textarea
              value={officialFact}
              onChange={(e) => setOfficialFact(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-50 dark:bg-white/5 border-2 border-slate-200 dark:border-white/10 focus:border-blue-500 outline-none text-base font-medium h-28 resize-none"
              placeholder="출처가 있는 핵심 정보가 있으면 적어주세요. 예: KOSIS 2025년 통계 기준..."
              maxLength={300}
            />
          </div>

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !!validationMessage}
            className="w-full py-5 bg-blue-600 text-white rounded-2xl text-xl font-black hover:bg-blue-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? '등록 중...' : '논제 등록하기'}
          </button>
        </form>

        <section className="bg-white dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black tracking-wider text-slate-500 dark:text-slate-400">미리보기</span>
            <span className="text-[10px] px-2 py-1 rounded-full bg-blue-500/15 text-blue-400 font-black">{getCategoryBadge(category)}</span>
          </div>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white">{title.trim() || '여기에 논제 제목이 표시됩니다.'}</h3>
          <div className="grid gap-2">
            {trimmedOptions.filter(Boolean).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-500">선택지를 입력하면 여기에서 바로 보입니다.</p>
            ) : (
              trimmedOptions
                .filter(Boolean)
                .map((opt, idx) => (
                  <div key={idx} className="px-4 py-3 rounded-xl bg-slate-100 dark:bg-white/5 text-sm font-semibold">
                    {idx + 1}. {opt}
                  </div>
                ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
