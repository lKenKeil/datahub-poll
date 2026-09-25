import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

process.loadEnvFile('.env.local');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new Error('Required Supabase configuration is missing.');

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = createClient(supabaseUrl, anonKey, clientOptions);
const service = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const apiBase = 'http://localhost:3000';
const bucket = 'poll-option-images';
const marker = `owner_it_${Date.now()}_${randomUUID().slice(0, 8)}`;
const createdPollIds = [];
const uploadedPaths = [];
const matchingFailureOrphans = [];
const realtimePollEvents = [];
const realtimeOwnershipEvents = [];
let pollRealtimeStatus = 'NOT_STARTED';
let ownershipRealtimeStatus = 'NOT_STARTED';
let pollChannel;
let ownershipChannel;
let report;

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function listRootNames() {
  const { data, error } = await service.storage
    .from(bucket)
    .list('', { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  return (data ?? []).map((entry) => entry.name);
}

async function listPathsUnderPoll(pollId) {
  const paths = [];
  const { data: optionDirectories, error: directoryError } = await service.storage
    .from(bucket)
    .list(`${pollId}/options`, { limit: 100 });
  if (directoryError) return paths;

  for (const directory of optionDirectories ?? []) {
    const { data: files, error: filesError } = await service.storage
      .from(bucket)
      .list(`${pollId}/options/${directory.name}`, { limit: 100 });
    if (filesError) continue;
    for (const file of files ?? []) {
      if (file.id) paths.push(`${pollId}/options/${directory.name}/${file.name}`);
    }
  }
  return paths;
}

async function subscribeChannel(channel, setStatus) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve('TIMED_OUT'), 5000);
    channel.subscribe((status) => {
      setStatus(status);
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timeout);
        resolve(status);
      }
    });
  });
}

try {
  pollChannel = anon
    .channel(`owner-it-polls-${marker}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'polls' }, (payload) => {
      if (String(payload.new?.official_fact ?? '').includes(marker)) realtimePollEvents.push(payload.new);
    });
  ownershipChannel = anon
    .channel(`owner-it-ownership-${marker}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_ownership' }, (payload) => {
      realtimeOwnershipEvents.push(payload.new);
    });

  await Promise.all([
    subscribeChannel(pollChannel, (status) => { pollRealtimeStatus = status; }),
    subscribeChannel(ownershipChannel, (status) => { ownershipRealtimeStatus = status; }),
  ]);

  const textResponse = await fetch(`${apiBase}/api/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `텍스트 소유권 통합 테스트 ${marker}`,
      category: '커뮤니티',
      options: ['텍스트 A', '텍스트 B'],
      officialFact: `integration ${marker} text`,
    }),
  });
  const textBody = await textResponse.json();
  if (!textResponse.ok || !textBody.data?.id || !textBody.data?.ownerToken) {
    throw new Error(`Text poll creation failed with status ${textResponse.status}.`);
  }
  const textPollId = textBody.data.id;
  const textOwnerToken = textBody.data.ownerToken;
  createdPollIds.push(textPollId);

  const successImage = await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 37, g: 99, b: 235 } },
  }).png().toBuffer();
  const imageForm = new FormData();
  imageForm.append('title', `이미지 소유권 통합 테스트 ${marker}`);
  imageForm.append('category', '커뮤니티');
  imageForm.append('options', JSON.stringify(['이미지 A', '이미지 B']));
  imageForm.append('officialFact', `integration ${marker} image`);
  imageForm.append('optionImages[0]', new Blob([successImage], { type: 'image/png' }), 'option.png');

  const imageResponse = await fetch(`${apiBase}/api/polls`, { method: 'POST', body: imageForm });
  const imageBody = await imageResponse.json();
  if (!imageResponse.ok || !imageBody.data?.id || !imageBody.data?.ownerToken) {
    throw new Error(`Image poll creation failed with status ${imageResponse.status}.`);
  }
  const imagePollId = imageBody.data.id;
  const imageOwnerToken = imageBody.data.ownerToken;
  createdPollIds.push(imagePollId);

  const [{ data: pollRows, error: pollsError }, { data: ownershipRows, error: ownershipError }] = await Promise.all([
    service.from('polls').select('*').in('id', [textPollId, imagePollId]),
    service.from('poll_ownership').select('poll_id,owner_token_hash,created_at').in('poll_id', [textPollId, imagePollId]),
  ]);
  if (pollsError) throw pollsError;
  if (ownershipError) throw ownershipError;

  const pollById = new Map((pollRows ?? []).map((row) => [row.id, row]));
  const ownershipById = new Map((ownershipRows ?? []).map((row) => [row.poll_id, row]));
  const textOwnership = ownershipById.get(textPollId);
  const imageOwnership = ownershipById.get(imagePollId);
  const imagePoll = pollById.get(imagePollId);
  if (!textOwnership || !imageOwnership || !imagePoll) throw new Error('Created poll or ownership row is missing.');

  for (const path of imagePoll.option_image_paths ?? []) {
    if (typeof path === 'string') uploadedPaths.push(path);
  }
  const imageObjectPath = uploadedPaths[0];
  const { data: imageObject, error: imageDownloadError } = imageObjectPath
    ? await service.storage.from(bucket).download(imageObjectPath)
    : { data: null, error: new Error('Image path missing.') };

  const publicListResponse = await fetch(`${apiBase}/api/polls`, { cache: 'no-store' });
  const publicListText = await publicListResponse.text();
  const publicListBody = JSON.parse(publicListText);
  const publicTextPoll = publicListBody.data?.find((row) => row.id === textPollId);

  const detailResponse = await fetch(`${apiBase}/api/polls/${encodeURIComponent(textPollId)}`, {
    cache: 'no-store',
  });
  const detailText = await detailResponse.text();
  const detailBody = JSON.parse(detailText);

  const { data: anonOwnershipData, error: anonOwnershipError } = await anon
    .from('poll_ownership')
    .select('poll_id,owner_token_hash')
    .eq('poll_id', textPollId);

  const duplicateHashRollbackId = `custom_${randomUUID()}`;
  const duplicateHashResult = await service.rpc('create_owned_poll', {
    p_poll_id: duplicateHashRollbackId,
    p_title: `원자성 rollback 테스트 ${marker}`,
    p_category: '커뮤니티',
    p_options: ['rollback A', 'rollback B'],
    p_votes: [0, 0],
    p_participants: 0,
    p_official_fact: `integration ${marker} rollback`,
    p_option_image_paths: null,
    p_owner_token_hash: textOwnership.owner_token_hash,
  });
  const [{ data: rollbackPoll }, { data: rollbackOwnership }] = await Promise.all([
    service.from('polls').select('id').eq('id', duplicateHashRollbackId).maybeSingle(),
    service.from('poll_ownership').select('poll_id').eq('poll_id', duplicateHashRollbackId).maybeSingle(),
  ]);

  const failureImage = await sharp({
    create: { width: 53, height: 47, channels: 3, background: { r: 225, g: 29, b: 72 } },
  }).png().toBuffer();
  const expectedFailureWebp = await sharp(failureImage)
    .rotate()
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  const expectedFailureHash = createHash('sha256').update(expectedFailureWebp).digest('hex');
  const rootBeforeFailure = await listRootNames();
  const failureMarker = `integration ${marker} image-rpc-failure`;
  const failureForm = new FormData();
  failureForm.append('title', '😀😀');
  failureForm.append('category', '커뮤니티');
  failureForm.append('options', JSON.stringify(['실패 A', '실패 B']));
  failureForm.append('officialFact', failureMarker);
  failureForm.append('optionImages[0]', new Blob([failureImage], { type: 'image/png' }), 'failure.png');
  const failureResponse = await fetch(`${apiBase}/api/polls`, { method: 'POST', body: failureForm });
  const failureBody = await failureResponse.json();
  const rootAfterFailure = await listRootNames();
  const addedRootNames = rootAfterFailure.filter((name) => !rootBeforeFailure.includes(name));

  for (const pollId of addedRootNames) {
    const paths = await listPathsUnderPoll(pollId);
    for (const path of paths) {
      const { data, error } = await service.storage.from(bucket).download(path);
      if (error || !data) continue;
      const digest = createHash('sha256').update(Buffer.from(await data.arrayBuffer())).digest('hex');
      if (digest === expectedFailureHash) matchingFailureOrphans.push(path);
    }
  }
  const { data: failedPollRows } = await service
    .from('polls')
    .select('id')
    .eq('official_fact', failureMarker);

  const ownerlessPollId = `custom_${randomUUID()}`;
  const ownerlessInsert = await service.from('polls').insert({
    id: ownerlessPollId,
    title: `ownerless 호환 테스트 ${marker}`,
    category: '커뮤니티',
    options: ['기존 A', '기존 B'],
    votes: [0, 0],
    participants: 0,
    official_fact: `integration ${marker} ownerless`,
  });
  if (ownerlessInsert.error) throw ownerlessInsert.error;
  createdPollIds.push(ownerlessPollId);

  const ownerlessDetailResponse = await fetch(`${apiBase}/api/polls/${encodeURIComponent(ownerlessPollId)}`, {
    headers: { 'x-voter-id': randomUUID() },
    cache: 'no-store',
  });
  const ownerlessVoterId = randomUUID();
  const ownerlessVoteResponse = await fetch(`${apiBase}/api/polls/${encodeURIComponent(ownerlessPollId)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionIndex: 0, voterId: ownerlessVoterId }),
  });
  const ownerlessVoteBody = await ownerlessVoteResponse.json();
  const [{ data: ownerlessOwnership }, { data: ownerlessPollAfterVote }] = await Promise.all([
    service
      .from('poll_ownership')
      .select('poll_id')
      .eq('poll_id', ownerlessPollId)
      .maybeSingle(),
    service
      .from('polls')
      .select('votes,participants')
      .eq('id', ownerlessPollId)
      .single(),
  ]);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  report = {
    creation: {
      textStatus: textResponse.status,
      imageStatus: imageResponse.status,
      textCacheControl: textResponse.headers.get('cache-control'),
      imageCacheControl: imageResponse.headers.get('cache-control'),
      pollRowCount: pollRows?.length ?? 0,
      ownershipRowCount: ownershipRows?.length ?? 0,
      imageObjectExists: Boolean(imageObject && !imageDownloadError),
    },
    tokenHash: {
      textMatches: sha256(textOwnerToken) === textOwnership.owner_token_hash,
      imageMatches: sha256(imageOwnerToken) === imageOwnership.owner_token_hash,
      rawTokenNotStored: textOwnerToken !== textOwnership.owner_token_hash
        && imageOwnerToken !== imageOwnership.owner_token_hash,
      tokenLengths: [textOwnerToken.length, imageOwnerToken.length],
      hashLengths: [textOwnership.owner_token_hash.length, imageOwnership.owner_token_hash.length],
    },
    publicExposure: {
      listStatus: publicListResponse.status,
      listContainsCreatedPoll: Boolean(publicTextPoll),
      listContainsOwnershipHashField: publicListText.includes('owner_token_hash'),
      listContainsRawToken: publicListText.includes(textOwnerToken) || publicListText.includes(imageOwnerToken),
      detailStatus: detailResponse.status,
      detailContainsCreatedPoll: detailBody.poll?.id === textPollId,
      detailContainsOwnershipHashField: detailText.includes('owner_token_hash'),
      detailContainsRawToken: detailText.includes(textOwnerToken),
      anonOwnershipReadDenied: Boolean(anonOwnershipError) && !anonOwnershipData?.length,
    },
    realtime: {
      pollChannelStatus: pollRealtimeStatus,
      ownershipChannelStatus: ownershipRealtimeStatus,
      matchingPollEventCount: realtimePollEvents.length,
      pollPayloadContainsOwnershipHash: realtimePollEvents.some((event) => Object.hasOwn(event, 'owner_token_hash')),
      ownershipPayloadCount: realtimeOwnershipEvents.length,
    },
    rollback: {
      rpcFailed: Boolean(duplicateHashResult.error),
      rpcErrorCode: duplicateHashResult.error?.code ?? null,
      pollRolledBack: rollbackPoll === null,
      ownershipRolledBack: rollbackOwnership === null,
    },
    imageFailureCleanup: {
      apiStatus: failureResponse.status,
      genericFailureReturned: failureBody.error === '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      failedPollRows: failedPollRows?.length ?? 0,
      addedStorageRootEntries: addedRootNames.length,
      matchingFailureOrphans: matchingFailureOrphans.length,
    },
    ownerlessCompatibility: {
      detailStatus: ownerlessDetailResponse.status,
      voteStatus: ownerlessVoteResponse.status,
      voteParticipants: ownerlessVoteBody.data?.participants,
      dbParticipants: ownerlessPollAfterVote?.participants,
      dbVotes: ownerlessPollAfterVote?.votes,
      ownershipRowAbsent: ownerlessOwnership === null,
    },
  };
} finally {
  if (pollChannel) await anon.removeChannel(pollChannel);
  if (ownershipChannel) await anon.removeChannel(ownershipChannel);

  const cleanupPaths = [...new Set([...uploadedPaths, ...matchingFailureOrphans])];
  if (cleanupPaths.length > 0) {
    await service.storage.from(bucket).remove(cleanupPaths);
  }

  if (createdPollIds.length > 0) {
    await service.from('polls').delete().in('id', createdPollIds);
  }

  const [{ data: remainingPolls }, { data: remainingOwnership }, { data: remainingVotes }] = await Promise.all([
    createdPollIds.length > 0
      ? service.from('polls').select('id').in('id', createdPollIds)
      : Promise.resolve({ data: [] }),
    createdPollIds.length > 0
      ? service.from('poll_ownership').select('poll_id').in('poll_id', createdPollIds)
      : Promise.resolve({ data: [] }),
    createdPollIds.length > 0
      ? service.from('poll_votes').select('poll_id').in('poll_id', createdPollIds)
      : Promise.resolve({ data: [] }),
  ]);

  if (report) {
    report.cleanup = {
      remainingPollRows: remainingPolls?.length ?? 0,
      remainingOwnershipRows: remainingOwnership?.length ?? 0,
      remainingVoteRows: remainingVotes?.length ?? 0,
      removedStorageObjectCount: cleanupPaths.length,
    };
    console.log(JSON.stringify(report, null, 2));
  }
}
