// Display-only selection: never changes votes, service data, or ranking scores.
export type DiscoveryCategory = '연애/관계' | '게임' | '스포츠' | '음식' | '엔터/콘텐츠' | 'IT/제품' | '라이프' | '가치관' | '데이터';
type CategorySource = { title: string; category?: string | null; options?: string[] | null; tags?: string[] | null };
export type DiscoveryPoll = CategorySource & { id: string; created_at?: string; participants?: number; is_hidden?: boolean };

// Same classification as the existing home filter, not the broad DB category.
const KEYWORDS: Array<[DiscoveryCategory, string[]]> = [
  ['연애/관계', ['연애', '사랑', '결혼', '썸', '친구', '관계']],
  ['게임', ['게임', '콘솔', '롤', '오버워치', '닌텐도', '스팀']],
  ['스포츠', ['스포츠', '축구', '야구', '농구', '배구', '선수']],
  ['음식', ['음식', '메뉴', '치킨', '피자', '짜장', '짬뽕', '커피', '맛집']],
  ['엔터/콘텐츠', ['영화', '드라마', '음악', '아이돌', '유튜브', '콘텐츠', '웹툰']],
  ['IT/제품', ['it/테크', '아이폰', '갤럭시', '노트북', '스마트폰', '소프트웨어', '제품']],
  ['라이프', ['라이프스타일', '생활', '여행', '패션', '건강', '취미']],
  ['데이터', ['학술/통계', '통계', '데이터', '지표', '인구', '경제성장률']],
];

export function getInterestCategory(item: CategorySource): DiscoveryCategory {
  const text = `${item.title} ${item.category ?? ''} ${(item.options ?? []).join(' ')} ${(item.tags ?? []).join(' ')}`.toLowerCase();
  const matched = KEYWORDS.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)));
  if (matched) return matched[0];
  if (item.category === '라이프스타일') return '라이프';
  if (item.category === 'IT/테크') return 'IT/제품';
  if (item.category === '학술/통계') return '데이터';
  return '가치관';
}

export function getDiscoveryTime(poll: DiscoveryPoll) {
  const time = poll.created_at ? Date.parse(poll.created_at) : 0;
  return Number.isFinite(time) ? time : 0;
}

export function compareDiscoveryNewest(a: DiscoveryPoll, b: DiscoveryPoll) {
  return getDiscoveryTime(b) - getDiscoveryTime(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function getPollTopicKey(poll: CategorySource) {
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const sides = poll.title.split(/\s+vs\s+/i);
  // Reversed A/B titles are the same topic; generic option labels alone are not.
  return sides.length === 2 ? sides.map(normalize).sort().join('|') : normalize(poll.title);
}

export function selectUniquePollTopics<T extends DiscoveryPoll>(polls: readonly T[], excluded: readonly DiscoveryPoll[] = [], limit = Infinity): T[] {
  const ids = new Set(excluded.map(poll => poll.id));
  const topics = new Set(excluded.map(getPollTopicKey));
  const selected: T[] = [];
  for (const poll of polls) {
    const topic = getPollTopicKey(poll);
    if (poll.is_hidden || ids.has(poll.id) || topics.has(topic)) continue;
    if (selected.length >= limit) break;
    selected.push(poll);
    ids.add(poll.id);
    topics.add(topic);
  }
  return selected;
}

export const LATEST_BATCH_WINDOW_MS = 5 * 60 * 1000;
export const RECENT_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function selectDiverseLatestPolls<T extends DiscoveryPoll>(polls: readonly T[], excluded: readonly DiscoveryPoll[] = [], limit = 8, now = Date.now()): T[] {
  if (limit <= 0) return [];
  const ordered = selectUniquePollTopics([...polls].sort(compareDiscoveryNewest), excluded);
  const selected: T[] = [];
  let offset = 0;
  let lastCategory: DiscoveryCategory | undefined;
  while (offset < ordered.length && selected.length < limit) {
    const newestTime = getDiscoveryTime(ordered[offset]);
    const queues = new Map<DiscoveryCategory, { polls: T[]; index: number }>();
    while (offset < ordered.length && newestTime - getDiscoveryTime(ordered[offset]) <= LATEST_BATCH_WINDOW_MS) {
      const poll = ordered[offset++];
      const category = getInterestCategory(poll);
      const queue = queues.get(category) ?? { polls: [], index: 0 };
      queue.polls.push(poll);
      queues.set(category, queue);
    }
    // Stable round-robin only inside an anchored five-minute batch.
    const categories = [...queues.keys()];
    let cursor = 0;
    while (selected.length < limit) {
      let next = -1;
      for (let step = 0; step < categories.length; step++) {
        const index = (cursor + step) % categories.length;
        const queue = queues.get(categories[index])!;
        if (queue.index >= queue.polls.length) continue;
        if (next === -1) next = index;
        if (categories[index] !== lastCategory) { next = index; break; }
      }
      if (next === -1) break;
      const queue = queues.get(categories[next])!;
      selected.push(queue.polls[queue.index++]);
      lastCategory = categories[next];
      cursor = (next + 1) % categories.length;
    }
  }
  // At most one recent custom question can displace a bulk seed. Never pull
  // months-old user content into 'latest', or duplicate earlier home sections.
  if (selected.length === limit && selected.every(poll => poll.id.startsWith('seed_v1_'))) {
    const newestTime = getDiscoveryTime(ordered[0]);
    const recentUser = ordered.find(poll => poll.id.startsWith('custom_')
      && now - getDiscoveryTime(poll) >= 0
      && now - getDiscoveryTime(poll) <= RECENT_USER_WINDOW_MS
      && newestTime - getDiscoveryTime(poll) <= RECENT_USER_WINDOW_MS);
    if (recentUser) {
      const rest = selected.slice(0, -1);
      const category = getInterestCategory(recentUser);
      let position = Math.min(3, rest.length);
      const positions = Array.from({ length: rest.length + 1 }, (_, i) => i)
        .sort((a, b) => Math.abs(a - position) - Math.abs(b - position) || a - b);
      for (const i of positions) {
        const before = rest[i - 1] && getInterestCategory(rest[i - 1]);
        const after = rest[i] && getInterestCategory(rest[i]);
        if (before !== category && after !== category) { position = i; break; }
      }
      rest.splice(position, 0, recentUser);
      return rest;
    }
  }
  return selected;
}

function stableFraction(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function selectNextPolls<T extends DiscoveryPoll>(polls: readonly T[], current: DiscoveryPoll, recentIds: readonly string[] = [], limit = 4, now = Date.now()): T[] {
  if (limit <= 0) return [];
  const byId = new Map(polls.map(poll => [poll.id, poll]));
  const recentTopics = new Map<string, number>();
  recentIds.forEach((id, index) => {
    const poll = byId.get(id);
    if (poll) recentTopics.set(getPollTopicKey(poll), index);
  });
  const seenIndex = (poll: T) => recentTopics.get(getPollTopicKey(poll)) ?? -1;
  const currentCategory = getInterestCategory(current);
  const score = (poll: T) => {
    const ageHours = Math.max(0, (now - getDiscoveryTime(poll)) / 3600000);
    return stableFraction(`${current.id}\0${poll.id}`) * 20
      + Math.max(0, 72 - ageHours) / 72 * 10
      + (getInterestCategory(poll) === currentCategory ? 8 : 0)
      + Math.min(3, Math.log2(Math.max(0, poll.participants ?? 0) + 1));
  };
  const compare = (a: T, b: T) => {
    const aSeen = seenIndex(a), bSeen = seenIndex(b);
    const seenDifference = Number(aSeen >= 0) - Number(bSeen >= 0);
    // Exhaust unviewed candidates first, then relax oldest history first.
    return seenDifference || (aSeen >= 0 && bSeen >= 0 ? aSeen - bSeen : 0)
      || score(b) - score(a) || compareDiscoveryNewest(a, b);
  };
  const candidates = selectUniquePollTopics([...polls].sort(compare), [current]);
  const queues = new Map<DiscoveryCategory, { polls: T[]; index: number }>();
  for (const poll of candidates) {
    const category = getInterestCategory(poll);
    const queue = queues.get(category) ?? { polls: [], index: 0 };
    queue.polls.push(poll);
    queues.set(category, queue);
  }
  const selected: T[] = [];
  let lastCategory = currentCategory;
  while (selected.length < limit) {
    const heads = [...queues.entries()].filter(([, q]) => q.index < q.polls.length);
    if (!heads.length) break;
    const unseen = heads.filter(([, q]) => seenIndex(q.polls[q.index]) === -1);
    const available = unseen.length ? unseen : heads;
    const different = available.filter(([category]) => category !== lastCategory);
    const choices = different.length ? different : available;
    choices.sort(([, a], [, b]) => compare(a.polls[a.index], b.polls[b.index]));
    const [category, queue] = choices[0];
    selected.push(queue.polls[queue.index++]);
    lastCategory = category;
  }
  return selected;
}

export const RECENT_POLL_LIMIT = 20;
export function appendRecentPollId(ids: readonly string[], id: string): string[] {
  return [...ids.filter(value => value !== id), id].slice(-RECENT_POLL_LIMIT);
}
