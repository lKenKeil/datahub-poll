// Pure helper/storage tests. Optional snapshot URL performs a single GET only.
// Run: node --test scripts/test-poll-discovery.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(source, require = () => { throw Error('Unexpected import'); }) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  new Function('module', 'exports', 'require', output)(loadedModule, loadedModule.exports, require);
  return loadedModule.exports;
}
const discovery = load(readFileSync(new URL('../lib/poll-discovery.ts', import.meta.url), 'utf8'));
const session = load(readFileSync(new URL('../lib/poll-discovery-session.ts', import.meta.url), 'utf8'), () => discovery);
const { selectDiverseLatestPolls, selectUniquePollTopics, selectNextPolls, appendRecentPollId, getInterestCategory, getPollTopicKey, compareDiscoveryNewest } = discovery;
const now = Date.parse('2026-10-02T12:00:00Z');
const poll = (id, title, age = 0, extra = {}) => ({ id, title, category: '커뮤니티', options: ['하나', '둘'], participants: 0, votes: [0, 0], created_at: new Date(now - age).toISOString(), ...extra });
const seedPool = ['영화', '게임', '음식', '스포츠'].flatMap((category, i) => Array.from({ length: 6 }, (_, j) => poll(`seed_v1_${i}-${j}`, `${category} 질문 ${j}`)));
function maxStreak(rows, key) {
  let max = 0, streak = 0, last;
  for (const row of rows) { const value = key(row); streak = value === last ? streak + 1 : 1; last = value; max = Math.max(max, streak); }
  return max;
}

test('latest interleaves categories, stable under input permutation, and limits eight', () => {
  const selected = selectDiverseLatestPolls(seedPool, [], 8, now);
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map(getInterestCategory)).size, 4);
  assert.equal(maxStreak(selected, getInterestCategory), 1);
  assert.deepEqual(selected, selectDiverseLatestPolls([...seedPool].reverse(), [], 8, now));
});
test('five-minute buckets are anchored, and newer buckets stay ahead of older ones', () => {
  const rows = [poll('a', '게임 a'), poll('b', '게임 b', 240000), poll('c', '음식 c', 480000)];
  assert.deepEqual(selectDiverseLatestPolls(rows, [], 8, now).map(x => x.id), ['a', 'b', 'c']);
});
test('one recent custom poll is protected but old users are not artificially promoted', () => {
  const recent = poll('custom_recent', '여행 새 질문', 4 * 3600000);
  const old = poll('custom_old', '취미 오래된 질문', 2 * 86400000);
  const selected = selectDiverseLatestPolls([...seedPool, old, recent], [], 8, now);
  assert.equal(selected.filter(x => x.id.startsWith('custom_')).length, 1);
  assert.equal(selected[3].id, recent.id);
  assert.equal(selectDiverseLatestPolls([...seedPool, old], [], 8, now).some(x => x.id === old.id), false);
  assert.equal(selectDiverseLatestPolls([...seedPool, recent], [recent], 8, now).some(x => x.id === recent.id), false);
});
test('current, hidden, duplicate IDs and exact/reversed topics are excluded', () => {
  const current = poll('current', '짜장면 vs 짬뽕');
  const duplicate = poll('alias', '짬뽕 VS 짜장면');
  const other = poll('other', '피자 vs 치킨');
  const hidden = poll('hidden', '게임 숨김 질문', 0, { is_hidden: true });
  assert.deepEqual(selectUniquePollTopics([duplicate, other, other, hidden], [current]).map(x => x.id), ['other']);
  assert.deepEqual(selectNextPolls([current, duplicate, hidden, other], current, [], 4, now).map(x => x.id), ['other']);
  assert.equal(getPollTopicKey(poll('a', '📱 아이폰 vs 갤럭시')), getPollTopicKey(poll('b', '갤럭시 vs 아이폰')));
  // Identical generic answer labels do not collapse unrelated questions.
  assert.equal(selectUniquePollTopics([poll('a', '게임 a'), poll('b', '게임 b')]).length, 2);
});
test('next selection is stable, includes zero-vote seeds, and prefers a different topic category', () => {
  const current = seedPool[0];
  const selected = selectNextPolls(seedPool, current, [current.id], 4, now);
  assert.equal(selected.length, 4);
  assert.notEqual(getInterestCategory(selected[0]), getInterestCategory(current));
  assert.deepEqual(selected, selectNextPolls([...seedPool].reverse(), current, [current.id], 4, now));
});
test('seen topics are deferred; exhausted history relaxes oldest first without self-loop', () => {
  const current = poll('c', '게임 current'), old = poll('o', '음식 old'), recent = poll('r', '음식 recent');
  assert.equal(selectNextPolls([current, old, recent], current, ['o', 'r', 'c'], 1, now)[0].id, 'o');
  assert.equal(selectNextPolls([current, old, recent], current, ['o', 'c'], 1, now)[0].id, 'r');
  assert.deepEqual(selectNextPolls([current], current, [current.id], 4, now), []);
});
test('twenty next clicks stay unique and avoid same-category streaks when alternatives exist', () => {
  const pool = [...seedPool, ...seedPool.map(x => ({ ...x, id: `${x.id}-more`, title: `${x.title} 다른 상황` }))];
  let current = pool[0], history = [current.id]; const visited = [current];
  for (let i = 0; i < 20; i++) {
    const next = selectNextPolls(pool, current, history, 4, now)[0];
    assert.notEqual(next.id, current.id);
    visited.push(next); history = appendRecentPollId(history, next.id); current = next;
  }
  assert.equal(new Set(visited.map(x => x.id)).size, 21);
  assert.equal(maxStreak(visited, getInterestCategory), 1);
  assert.equal(history.length, 20);
});
test('single-category and empty pools gracefully return bounded candidates', () => {
  const rows = seedPool.filter(x => getInterestCategory(x) === '게임');
  assert.equal(selectDiverseLatestPolls(rows, [], 8, now).length, 6);
  assert.equal(selectNextPolls(rows, rows[0], [], 4, now).length, 4);
  assert.deepEqual(selectDiverseLatestPolls([], [], 8, now), []);
});
test('session storage is SSR-safe, bounded, malformed-data-safe and denial-safe', () => {
  assert.deepEqual(session.rememberPollVisit('server'), []);
  let raw = '{invalid'; const writes = [];
  globalThis.window = { sessionStorage: { getItem: () => raw, setItem: (key, value) => { writes.push(key); raw = value; } } };
  try {
    for (let i = 0; i < 25; i++) session.rememberPollVisit(`poll_${i}`);
    assert.equal(JSON.parse(raw).length, 20);
    assert.equal(writes.every(key => key === 'askio_recent_poll_ids'), true);
    Object.defineProperty(globalThis.window, 'sessionStorage', { get: () => { throw Error('Denied'); } });
    assert.equal(session.rememberPollVisit('denied').at(-1), 'denied');
  } finally { delete globalThis.window; }
});

const snapshotUrl = process.env.POLL_DISCOVERY_SNAPSHOT_URL;
test('read-only Production snapshot before/after and twenty-step next simulation', { skip: !snapshotUrl }, async () => {
  const response = await fetch(snapshotUrl);
  assert.equal(response.status, 200);
  const { data: pool } = await response.json();
  const at = Date.now();
  const community = pool.filter(x => !['car', 'phone', 'official_car', 'official_phone'].includes(x.id));
  const tight = x => { const v = [...x.votes].sort((a,b) => b-a), total = v.reduce((a,b) => a+b,0); return v.length >= 2 && total >= 10 && (v[0]-v[1])/total*100 <= 8; };
  const trending = x => (x.participants ?? 0) + (tight(x) ? 120 : 0) + Math.max(0,36-Math.max(0,(at-Date.parse(x.created_at))/3600000))*8;
  const active = community.filter(x => x.participants > 0).sort((a,b) => trending(b)-trending(a) || compareDiscoveryNewest(a,b));
  const hero = active[0] ?? [...community].sort(compareDiscoveryNewest)[0];
  const oldPopular = active.filter(x => x.id !== hero.id).slice(0,6);
  const popular = selectUniquePollTopics(active, [hero], 6);
  const risingScore = x => Math.max(0,72-Math.max(0,(at-Date.parse(x.created_at))/3600000))*10 + Math.log2(x.participants+1)*45 + (tight(x) ? 80 : 0);
  const fresh = community.filter(x => x.participants > 0 && at-Date.parse(x.created_at) <= 72*3600000).sort((a,b) => risingScore(b)-risingScore(a) || compareDiscoveryNewest(a,b));
  const oldRising = fresh.filter(x => ![hero,...oldPopular].some(y=>y.id===x.id)).slice(0,4);
  const rising = selectUniquePollTopics(fresh,[hero,...popular],4);
  const oldLatest = [...community].sort(compareDiscoveryNewest).filter(x => ![hero,...oldPopular,...oldRising].some(y => y.id === x.id)).slice(0,8);
  const latest = selectDiverseLatestPolls(community, [hero,...popular,...rising],8,at);
  const oldNext = current => [...pool].filter(x => x.id !== current.id).sort((a,b) => Number(b.category === current.category)-Number(a.category === current.category) || b.participants-a.participants || Date.parse(b.created_at)-Date.parse(a.created_at))[0];
  function walk(next) {
    let current = pool.find(x => x.id === 'seed_v1_entertainment-movie-credits');
    let history = [current.id]; const visited = [current]; let selfLoops = 0;
    for(let i=0;i<20;i++) { const candidate=next(current,history); assert.ok(candidate); if(candidate.id === current.id) selfLoops++; visited.push(candidate); history=appendRecentPollId(history,candidate.id); current=candidate; }
    return { clicks:20,uniqueIncludingStart:new Set(visited.map(x=>x.id)).size,repeatedVisits:visited.length-new Set(visited.map(x=>x.id)).size,maxCategoryStreak:maxStreak(visited,getInterestCategory),selfLoops,ids:visited.map(x=>x.id) };
  }
  const before=walk(oldNext), after=walk((current,history)=>selectNextPolls(pool,current,history,4,at)[0]);
  assert.equal(after.uniqueIncludingStart,21);
  assert.equal(after.selfLoops,0);
  assert.ok(maxStreak(latest,getInterestCategory)<=2);
  const shown=[hero,...popular,...rising,...latest]; assert.equal(new Set(shown.map(getPollTopicKey)).size,shown.length);
  console.log(JSON.stringify({snapshotCount:pool.length,hero:hero.id,popularBefore:oldPopular.map(x=>x.id),popularAfter:popular.map(x=>x.id),risingBefore:oldRising.length,risingAfter:rising.length,latestBefore:oldLatest.map(x=>({id:x.id,category:getInterestCategory(x)})),latestAfter:latest.map(x=>({id:x.id,category:getInterestCategory(x),...(x.id.startsWith('custom_')?{ageHours:+((at-Date.parse(x.created_at))/3600000).toFixed(2)}:{})})),latestStreakBefore:maxStreak(oldLatest,getInterestCategory),latestStreakAfter:maxStreak(latest,getInterestCategory),nextBefore:before,nextAfter:after},null,2));
});
