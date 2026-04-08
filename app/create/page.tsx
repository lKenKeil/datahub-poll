'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function CreatePollPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [opt1, setOpt1] = useState('');
  const [opt2, setOpt2] = useState('');
  const [fact, setFact] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !opt1 || !opt2) return alert("필수 항목을 모두 입력해주세요!");

    // 1. 새로운 투표 객체 생성 (고유 ID 부여)
    const newPoll = {
      id: `custom_${Date.now()}`,
      title: `🔥 ${title}`,
      options: [opt1, opt2],
      participants: 0,
      stats: [50, 50], // 초기 그래프 비율
      officialFact: fact || "아직 등록된 오피셜 팩트가 없습니다."
    };

    // 2. 기존 커스텀 투표 목록을 불러와서 새 투표를 맨 앞에 추가
    const existingPolls = JSON.parse(localStorage.getItem('custom_polls') || '[]');
    localStorage.setItem('custom_polls', JSON.stringify([newPoll, ...existingPolls]));

    // 3. 메인 페이지로 이동
    router.push('/');
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto mt-10 space-y-8">
        <Link href="/" className="inline-block px-6 py-3 bg-white border border-gray-200 rounded-full text-blue-600 font-bold hover:bg-blue-50 transition-colors">
          ← 취소하고 돌아가기
        </Link>
        
        <h2 className="text-4xl font-black italic text-slate-900">새로운 난제 등록 ✍️</h2>
        
        <form onSubmit={handleSubmit} className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-100 space-y-8">
          <div>
            <label className="block text-xl font-bold text-slate-700 mb-3">투표 주제 (예: 짜장면 vs 짬뽕)</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-blue-500 outline-none text-lg font-bold" placeholder="세상에서 가장 어려운 질문을 던져보세요" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-lg font-bold text-slate-700 mb-3">선택지 1</label>
              <input type="text" value={opt1} onChange={(e) => setOpt1(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-blue-500 outline-none text-lg font-bold" placeholder="첫 번째 선택" />
            </div>
            <div>
              <label className="block text-lg font-bold text-slate-700 mb-3">선택지 2</label>
              <input type="text" value={opt2} onChange={(e) => setOpt2(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-blue-500 outline-none text-lg font-bold" placeholder="두 번째 선택" />
            </div>
          </div>
          <div>
            <label className="block text-xl font-bold text-slate-700 mb-3">오피셜 팩트 (선택사항)</label>
            <textarea value={fact} onChange={(e) => setFact(e.target.value)} className="w-full p-5 rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-blue-500 outline-none text-lg font-medium h-32 resize-none" placeholder="이 투표와 관련된 재미있는 통계나 사실을 적어주세요!" />
          </div>
          
          <button type="submit" className="w-full py-6 bg-blue-600 text-white rounded-2xl text-2xl font-black hover:bg-blue-700 hover:-translate-y-1 transition-all shadow-lg active:scale-95">
            등록하기 🚀
          </button>
        </form>
      </div>
    </main>
  );
}