import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { POLLS } from '@/data/polls';
import { BRAND } from '@/lib/brand';
import { getSupabaseMutationClient, supabaseServer } from '@/lib/supabase-server';

type VoteLayoutProps = {
  children: ReactNode;
  params: Promise<{ id: string }>;
};

type PollMetadata = {
  title: string;
};

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
  const dbPollId = officialPoll ? `official_${id}` : id;

  try {
    const supabaseMutation = getSupabaseMutationClient();
    if (dbPollId.startsWith('official_')) {
      const { data: deletedOfficial, error: deletedOfficialError } = await supabaseMutation
        .from('deleted_official_polls').select('poll_id').eq('poll_id', dbPollId).maybeSingle();
      if (deletedOfficialError || deletedOfficial) return null;
    }
    // An unavailable DB-backed official question must never reappear through
    // its static title. The privileged projection contains no original text.
    const { data: availability, error: availabilityError } = await supabaseMutation
      .from('polls')
      .select('id,is_hidden')
      .eq('id', dbPollId)
      .maybeSingle();
    if (availabilityError || availability?.is_hidden) return null;
    if (!availability) return officialPoll ? { title: officialPoll.title } : null;

    const { data, error } = await supabaseServer
      .from('polls')
      .select('title')
      .eq('id', dbPollId)
      .eq('is_hidden', false)
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
    const title = `투표를 찾을 수 없어요 | ${BRAND.name}`;
    return {
      title,
      description: BRAND.description,
      alternates: { canonical: canonicalPath },
      robots: { index: false, follow: false },
      openGraph: {
        title,
        description: BRAND.openGraphDescription,
        url: canonicalPath,
        siteName: BRAND.name,
        locale: 'ko_KR',
        type: 'website',
      },
      twitter: {
        card: 'summary',
        title,
        description: BRAND.openGraphDescription,
      },
    };
  }

  const displayTitle = truncateText(poll.title, 68);
  const title = `${displayTitle} | ${BRAND.name}`;
  const description = truncateText(
    `'${displayTitle}'에 답하고 다른 사람들의 선택과 의견을 확인해보세요.`,
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
      siteName: BRAND.name,
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
