import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { POLLS } from '@/data/polls';
import { supabaseServer } from '@/lib/supabase-server';

type VoteLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

type PollMetadata = {
  title: string;
};

const SITE_NAME = 'DATA HUB';
const DEFAULT_DESCRIPTION = '다양한 주제에 투표하고 다른 사람들의 선택과 결과를 확인해보세요.';

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number) {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;

  const candidate = compacted.slice(0, maxLength - 1);
  const lastSpace = candidate.lastIndexOf(' ');
  const boundary = lastSpace >= Math.floor(maxLength * 0.6) ? lastSpace : candidate.length;
  return `${candidate.slice(0, boundary).trimEnd()}…`;
}

async function getPollMetadata(id: string): Promise<PollMetadata | null> {
  const officialPoll = POLLS.find((poll) => poll.id === id);
  if (officialPoll) return { title: officialPoll.title };

  try {
    const { data, error } = await supabaseServer
      .from('polls')
      .select('title')
      .eq('id', id)
      .maybeSingle();

    if (error || typeof data?.title !== 'string' || !data.title.trim()) return null;
    return { title: data.title };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: VoteLayoutProps): Promise<Metadata> {
  const { id } = await params;
  const canonicalPath = `/vote/${encodeURIComponent(id)}`;
  const poll = await getPollMetadata(id);

  if (!poll) {
    const title = `투표를 찾을 수 없어요 | ${SITE_NAME}`;
    return {
      title,
      description: DEFAULT_DESCRIPTION,
      alternates: { canonical: canonicalPath },
      robots: { index: false, follow: false },
      openGraph: {
        title,
        description: DEFAULT_DESCRIPTION,
        url: canonicalPath,
        siteName: SITE_NAME,
        locale: 'ko_KR',
        type: 'website',
      },
      twitter: {
        card: 'summary',
        title,
        description: DEFAULT_DESCRIPTION,
      },
    };
  }

  const displayTitle = truncateText(poll.title, 68);
  const title = `${displayTitle} | ${SITE_NAME}`;
  const description = truncateText(
    `'${displayTitle}' 투표에 참여하고 다른 사람들의 선택과 결과를 확인해보세요.`,
    155,
  );

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonicalPath,
      siteName: SITE_NAME,
      locale: 'ko_KR',
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}

export default function VoteLayout({ children }: VoteLayoutProps) {
  return children;
}
