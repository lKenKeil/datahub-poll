// API regression checks against mocked Supabase contracts. This script never
// loads environment files, opens a network connection, or writes service data.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const modules = new Map();
const calls = [];
let database;
let queryFailure = null;
let queryHook = null;
let rpcFailure = null;
let storageFailure = null;
let cleanedPaths = [];
let clientNumber = 1;
let authUser;
let authFailure = null;
let authThrows = false;
let callbackFailure = null;
let exchangedCode = null;
let refreshCookies = false;
let refreshCalls = 0;
let nextVoteId = 1_000;
const originalAdminKey = process.env.ADMIN_DASHBOARD_KEY;
const originalGuestSecret = process.env.GUEST_ID_SECRET;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-only-service-role-key-not-a-credential';
process.env.GUEST_ID_SECRET = 'mock-only-guest-identity-key-not-a-credential';
const originalConsoleError = console.error;
const loggedErrors = [];
console.error = (...values) => loggedErrors.push(values);
process.env.ADMIN_DASHBOARD_KEY = "moderation-route-test-key";

const POLL_ID = "custom_moderation-route-test";
const COMMENT_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";
const REPORTER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_REPORTER_ID = "44444444-4444-4444-8444-444444444444";
const VOTER_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_TOKEN = "a".repeat(43);
const OLD_PATH = `${POLL_ID}/options/0/66666666-6666-4666-8666-666666666666.webp`;
const NEW_PATH = `${POLL_ID}/options/0/77777777-7777-4777-8777-777777777777.webp`;
const PRIVATE_TEXT = "hidden-original-must-not-leave-server";
const RAW_ERROR = "raw-sql-constraint-secret-must-not-leave-server";
const AUTH_USER_ID = "99999999-9999-4999-8999-999999999999";
const PROFILE_NICKNAME = "느긋한펭귄4821";
const PROFILE_AVATAR = "https://avatar.example.invalid/public-profile.png";

function reset() {
  calls.length = 0;
  loggedErrors.length = 0;
  queryFailure = null;
  queryHook = null;
  rpcFailure = null;
  storageFailure = null;
  cleanedPaths = [];
  authUser = { id: AUTH_USER_ID, email: "member@example.invalid", user_metadata: { full_name: "서버 사용자" }, is_anonymous: false };
  authFailure = null;
  authThrows = false;
  callbackFailure = null;
  exchangedCode = null;
  refreshCookies = false;
  refreshCalls = 0;
  nextVoteId = 1_000;
  database = {
    polls: [{
      id: POLL_ID, title: "모의 질문", category: "커뮤니티", options: ["선택 1", "선택 2"],
      votes: [0, 0], participants: 0, official_fact: null, option_image_paths: null,
      created_at: new Date().toISOString(), edit_lock_mode: "first_vote", is_hidden: false,
    }],
    comments: [], poll_votes: [], comment_reactions: [], deleted_official_polls: [],
    profiles: [{ id: AUTH_USER_ID, nickname: PROFILE_NICKNAME, avatar_url: PROFILE_AVATAR,
      onboarding_completed: false, show_avatar: false, created_at: "2026-10-01", updated_at: "2026-10-01" }],
    poll_ownership: [{ poll_id: POLL_ID, owner_token_hash: createHash("sha256").update(OWNER_TOKEN).digest("hex") }],
    reports: new Set(),
  };
  // PostgreSQL identity IDs are never reused after cancellation. Preserve
  // explicitly supplied legacy fixtures, assigning IDs only on insertion.
  Object.defineProperty(database.poll_votes, 'push', { value: function (...rows) {
    for (const row of rows) row.id ??= nextVoteId++;
    return Array.prototype.push.apply(this, rows);
  } });
}

function publicRows(table) {
  if (table === "polls") return database.polls.filter((poll) => !poll.is_hidden);
  if (table === "comments") return database.comments.filter((comment) => !comment.is_hidden
    && database.polls.some((poll) => poll.id === comment.poll_id && !poll.is_hidden));
  if (table === "comment_reactions") return database.comment_reactions.filter((reaction) =>
    publicRows("comments").some((comment) => comment.id === reaction.comment_id));
  throw new Error(`Public client must not query privileged table ${table}.`);
}

function supabaseClient(role) {
  return {
    storage: {
      from(bucket) {
        return {
          async upload(objectPath, data, options) {
            calls.push({ role, bucket, storageUpload: objectPath, data, options });
            return { data: { path: objectPath }, error: storageFailure };
          },
          getPublicUrl(objectPath) { return { data: { publicUrl: `https://storage.example.invalid/storage/v1/object/public/${bucket}/${objectPath}` } }; },
          async remove(paths) {
            calls.push({ role, bucket, storageRemove: [...paths] });
            return { data: null, error: storageFailure };
          },
        };
      },
    },
    from(table) {
      const query = { role, table, fields: "*", equals: [], single: false, limit: Infinity };
      const chain = {
        select(fields) { query.fields = fields; return chain; },
        eq(field, value) { query.equals.push([field, value]); return chain; },
        is(field, value) { query.equals.push([field, value]); return chain; },
        in(field, values) { query.equals.push([field, values]); return chain; },
        order() { return chain; },
        limit(value) { query.limit = value; return chain; },
        maybeSingle() { query.single = true; return chain; },
        single() { query.single = true; return chain; },
        insert(value) { query.insert = value; return chain; },
        update(value) { query.update = value; return chain; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push({ ...query });
            queryHook?.(query);
            if (queryFailure && (!queryFailure.table || queryFailure.table === table)) {
              return { data: null, error: queryFailure.error };
            }
            if (query.insert) {
              assert.equal(role, "service");
              assert.equal(table, "comments");
              database.comments.push({ id: query.insert.parent_id ? REPLY_ID : COMMENT_ID,
                parent_id: null, is_hidden: false, created_at: new Date().toISOString(), ...query.insert });
            }
            if (query.update) {
              assert.equal(role, "service");
              assert.equal(table, "profiles");
              const target = database.profiles.find((row) => query.equals.every(([field, value]) => row[field] === value));
              if (query.update.nickname && database.profiles.some((row) => row.id !== target?.id
                && row.nickname.toLowerCase() === query.update.nickname.toLowerCase())) {
                return { data: null, error: { code: "23505", message: RAW_ERROR } };
              }
              if (target) Object.assign(target, query.update);
            }
            let rows = query.insert ? database.comments.slice(-1)
              : role === "anon" ? publicRows(table) : database[table] ?? [];
            rows = rows.filter((row) => query.equals.every(([field, value]) =>
              Array.isArray(value) ? value.includes(row[field]) : value === null ? row[field] == null : row[field] === value));
            rows = rows.slice(0, query.limit).map((row) => query.fields === "*" ? { ...row }
              : Object.fromEntries(query.fields.split(",").map((field) => [field, row[field]])));
            return { data: query.single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return chain;
    },
    async rpc(name, payload) {
      calls.push({ role, rpc: name, payload });
      if (rpcFailure) return { data: null, error: rpcFailure };
      if (name === "create_comment_with_identity") {
        assert.equal(role, "service");
        const now = Date.now();
        if (payload.p_guest_id_hash) {
          const prior = database.comments.filter((row) => row.guest_id_hash === payload.p_guest_id_hash);
          if (prior.some((row) => now - Date.parse(row.created_at) < 10_000)) return { data: null, error: { code: 'P0001', message: 'GUEST_COMMENT_TOO_FAST' } };
          if (prior.some((row) => row.poll_id === payload.p_poll_id && row.text === payload.p_text
            && now - Date.parse(row.created_at) < 600_000)) return { data: null, error: { code: 'P0001', message: 'GUEST_COMMENT_DUPLICATE' } };
        }
        const row = { id: payload.p_parent_id ? REPLY_ID : COMMENT_ID,
          poll_id: payload.p_poll_id, parent_id: payload.p_parent_id, text: payload.p_text,
          user_id: payload.p_user_id, guest_id_hash: payload.p_guest_id_hash,
          is_anonymous: payload.p_is_anonymous, anonymous_alias: payload.p_anonymous_alias,
          user_name: payload.p_user_name, created_at: new Date(now).toISOString(), is_hidden: false };
        database.comments.push(row);
        return { data: { ...row }, error: null };
      }
      if (name === "ensure_user_profile" || name === "recommend_user_profile_nickname") {
        assert.equal(role, "service");
        let profile = database.profiles.find((row) => row.id === payload.p_user_id);
        if (!profile) {
          profile = { id: payload.p_user_id, nickname: "파란여우1937", avatar_url: null, onboarding_completed: false };
          database.profiles.push(profile);
        }
        if (name === "recommend_user_profile_nickname") profile.nickname = "졸린수달6142";
        return { data: { ...profile }, error: null };
      }
      if (name === "create_owned_poll_with_author") {
        assert.equal(role, "service");
        database.polls.push({ id: payload.p_poll_id, title: payload.p_title, category: payload.p_category,
          options: payload.p_options, votes: payload.p_votes, participants: payload.p_participants,
          author_user_id: payload.p_author_user_id, is_anonymous: payload.p_is_anonymous,
          is_hidden: false });
        return { data: payload.p_poll_id, error: null };
      }
      if (name === "update_owned_poll") {
        const poll = database.polls.find((row) => row.id === payload.p_poll_id);
        Object.assign(poll, { title: payload.p_title, category: payload.p_category,
          options: payload.p_options, official_fact: payload.p_official_fact,
          option_image_paths: payload.p_option_image_paths });
        return { data: { ...poll }, error: null };
      }
      if (name === "increment_poll_vote" || name === "change_poll_vote") {
        const poll = database.polls.find((row) => row.id === payload.p_poll_id);
        let vote = database.poll_votes.find((row) => row.poll_id === poll.id && row.voter_id === payload.p_voter_id);
        if (name === "increment_poll_vote" && vote) return { data: null, error: { code: "23505" } };
        if (name === "change_poll_vote" && !vote) return { data: null, error: { code: "P0002", message: "Existing vote not found." } };
        const index = payload.p_option_index ?? payload.p_new_option_index;
        const changed = !vote || vote.option_index !== index;
        if (vote) poll.votes[vote.option_index] -= 1;
        else {
          vote = { poll_id: poll.id, voter_id: payload.p_voter_id };
          database.poll_votes.push(vote);
          poll.participants += 1;
        }
        vote.option_index = index;
        poll.votes[index] += 1;
        return { data: { id: poll.id, votes: [...poll.votes], participants: poll.participants, option_index: index, changed }, error: null };
      }
      // Contract model only: real SQL locking/atomicity is tested separately.
      if (["change_managed_poll_vote", "cancel_managed_poll_vote"].includes(name)) {
        assert.equal(role, "service");
        assert.ok(payload.p_user_id || payload.p_guest_id_hash);
        if (payload.p_guest_id_hash) assert.match(payload.p_guest_id_hash, /^[0-9a-f]{64}$/);
        const poll = database.polls.find(row => row.id === payload.p_poll_id);
        if (!poll || poll.is_hidden) return { data: null, error: { code: "P0002", message: "CONTENT_NOT_AVAILABLE" } };
        const accountVote = payload.p_user_id
          ? database.poll_votes.find(row => row.poll_id === poll.id && row.user_id === payload.p_user_id) : null;
        const vote = accountVote ?? (payload.p_guest_id_hash
          ? database.poll_votes.find(row => row.poll_id === poll.id && row.guest_id_hash === payload.p_guest_id_hash) : null);
        if (!vote) return { data: null, error: { code: "P0002", message: "VOTE_NOT_FOUND" } };
        if (String(vote.id) !== String(payload.p_expected_vote_id)) {
          return { data: null, error: { code: "P0001", message: "VOTE_MANAGEMENT_CONFLICT" } };
        }
        const valid = Array.isArray(poll.votes) && poll.votes.length === poll.options.length
          && poll.votes.every(value => Number.isInteger(value) && value >= 0 && value <= 2_147_483_647)
          && Number.isInteger(poll.participants) && poll.participants > 0
          && Number.isInteger(vote.option_index) && vote.option_index >= 0 && vote.option_index < poll.votes.length
          && poll.votes[vote.option_index] > 0;
        if (!valid) return { data: null, error: { code: "P0001", message: "POLL_VOTE_COUNTER_INVALID" } };
        if (name === "cancel_managed_poll_vote") {
          poll.votes[vote.option_index] -= 1;
          poll.participants -= 1;
          database.poll_votes.splice(database.poll_votes.indexOf(vote), 1);
          return { data: [{ id: poll.id, votes: [...poll.votes], participants: poll.participants }], error: null };
        }
        const index = payload.p_new_option_index;
        if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) {
          return { data: null, error: { code: "22023", message: "INVALID_OPTION_INDEX" } };
        }
        const changed = vote.option_index !== index;
        if (changed) {
          if (poll.votes[index] === 2_147_483_647) return { data: null, error: { code: "P0001", message: "POLL_VOTE_COUNTER_INVALID" } };
          poll.votes[vote.option_index] -= 1;
          poll.votes[index] += 1;
          vote.option_index = index;
        }
        return { data: [{ id: poll.id, votes: [...poll.votes], participants: poll.participants,
          option_index: vote.option_index, changed }], error: null };
      }
      if (["cast_authenticated_poll_vote", "change_authenticated_poll_vote", "claim_authenticated_poll_vote",
        "cast_guest_poll_vote", "change_guest_poll_vote", "claim_guest_poll_vote"].includes(name)) {
        assert.equal(role, "service");
        const account = name.includes("_authenticated_");
        if (account) assert.ok(payload.p_user_id);
        else assert.match(payload.p_guest_id_hash, /^[0-9a-f]{64}$/);
        const poll = database.polls.find(row => row.id === payload.p_poll_id);
        if (!poll || poll.is_hidden) return { data: null, error: { code: "P0002", message: "CONTENT_NOT_AVAILABLE" } };
        const guestVote = payload.p_guest_id_hash
          ? database.poll_votes.find(row => row.poll_id === poll.id && row.guest_id_hash === payload.p_guest_id_hash) : null;
        let vote = account ? database.poll_votes.find(row => row.poll_id === poll.id && row.user_id === payload.p_user_id) : guestVote;
        if (name.startsWith("claim_")) {
          if (account && !vote && guestVote?.user_id != null && guestVote.user_id !== payload.p_user_id) {
            return { data: [{ id: poll.id, votes: [...poll.votes], participants: poll.participants, option_index: guestVote.option_index }], error: null };
          }
          if (!vote) {
            vote = account && guestVote?.user_id == null ? guestVote : null;
            if (!vote && !guestVote) vote = database.poll_votes.find(row => row.poll_id === poll.id
              && row.voter_id === payload.p_legacy_voter_id && row.user_id == null && row.guest_id_hash == null);
            if (vote) {
              if (account) vote.user_id = payload.p_user_id;
              if (payload.p_guest_id_hash) vote.guest_id_hash = payload.p_guest_id_hash;
            }
          } else if (account && vote.guest_id_hash == null && !guestVote && payload.p_guest_id_hash) {
            vote.guest_id_hash = payload.p_guest_id_hash;
          }
          return { data: vote ? [{ id: poll.id, votes: [...poll.votes], participants: poll.participants, option_index: vote.option_index }] : [], error: null };
        }
        if (name.startsWith("cast_") && (vote || guestVote)) return { data: null, error: { code: "23505", message: "POLL_ALREADY_VOTED" } };
        if (name.startsWith("change_") && !vote) return { data: null, error: { code: "P0002", message: "Existing vote not found." } };
        if (!account && name.startsWith("change_") && vote.user_id != null) {
          return { data: null, error: { code: "P0001", message: "VOTE_REQUIRES_ACCOUNT" } };
        }
        const index = payload.p_option_index ?? payload.p_new_option_index;
        const changed = !vote || vote.option_index !== index;
        if (changed) {
          if (vote) poll.votes[vote.option_index] -= 1;
          else {
            vote = { id: nextVoteId++, poll_id: poll.id, user_id: account ? payload.p_user_id : null,
              guest_id_hash: payload.p_guest_id_hash ?? null, voter_id: `mock-server-ledger-${database.poll_votes.length + 1}` };
            database.poll_votes.push(vote);
            poll.participants += 1;
          }
          vote.option_index = index;
          poll.votes[index] += 1;
        }
        return { data: [{ id: poll.id, votes: [...poll.votes], participants: poll.participants, option_index: index, changed }], error: null };
      }
      if (name === "submit_content_report") {
        const key = `${payload.p_target_type}:${payload.p_target_id}:${payload.p_reporter_hash}`;
        const duplicate = database.reports.has(key);
        database.reports.add(key);
        return { data: { duplicate }, error: null };
      }
      if (name === 'toggle_comment_reaction_with_actor') {
        const matching = database.comment_reactions.find(row => row.comment_id === payload.p_comment_id && row.user_fingerprint === payload.p_actor_key);
        let result = payload.p_reaction;
        if (matching?.reaction === payload.p_reaction) {
          database.comment_reactions.splice(database.comment_reactions.indexOf(matching), 1); result = null;
        } else if (matching) matching.reaction = payload.p_reaction;
        else database.comment_reactions.push({ comment_id: payload.p_comment_id, user_fingerprint: payload.p_actor_key, reaction: payload.p_reaction });
        const rows = database.comment_reactions.filter(row => row.comment_id === payload.p_comment_id);
        return { data: { likeCount: rows.filter(row => row.reaction === 'like').length, dislikeCount: rows.filter(row => row.reaction === 'dislike').length, userReaction: result }, error: null };
      }
      if (name === 'change_profile_avatar') {
        const profile = database.profiles.find(row => row.id === payload.p_user_id);
        if ((profile.uploaded_avatar_path ?? null) !== payload.p_expected_path) return { data: null, error: { code: 'P0001', message: 'AVATAR_CONFLICT' } };
        profile.social_avatar_url ??= profile.avatar_url;
        const previous = payload.p_new_path ? profile.uploaded_avatar_path : null;
        if (payload.p_new_path) { profile.uploaded_avatar_path = payload.p_new_path; profile.uploaded_avatar_url = payload.p_new_url; }
        profile.avatar_source = payload.p_source;
        profile.avatar_url = payload.p_source === 'default' ? null : payload.p_source === 'social' ? profile.social_avatar_url : profile.uploaded_avatar_url;
        return { data: { profile: { ...profile }, previous_path: previous }, error: null };
      }
      if (name === "moderate_report_target" || name === "delete_comment_with_dependents") {
        return { data: { ok: true }, error: null };
      }
      if (name === "get_content_report_queue") {
        return { data: { data: [], has_more: false }, error: null };
      }
      if (name === "delete_poll_with_dependents") {
        return { data: database.polls.find((poll) => poll.id === payload.p_poll_id)?.option_image_paths ?? null, error: null };
      }
      throw new Error(`Unexpected RPC ${name}.`);
    },
  };
}

function cookieJar(initial = []) {
  const entries = new Map(initial.map((cookie) => [cookie.name, { ...cookie }]));
  return {
    getAll: () => [...entries.values()],
    set(name, value, options) {
      const cookie = typeof name === "object" ? name : { name, value, ...options };
      entries.set(cookie.name, cookie);
    },
  };
}
const overrides = {
  "server-only": {},
  "next/server": { NextRequest: nativeRequire('next/server').NextRequest, NextResponse: class extends Response {
    static json(body, options) { return nativeRequire('next/server').NextResponse.json(body, options); }
    static redirect(url, options) { return new Response(null, { status: 307, ...options, headers: { ...options?.headers, Location: String(url) } }); }
    static next() { const response = new Response(null); response.cookies = cookieJar(); return response; }
  } },
  "@supabase/ssr": {
    createServerClient: (_url, _key, options) => ({ auth: {
      async getClaims() {
        refreshCalls += 1;
        if (refreshCookies) {
          options.cookies.setAll([{ name: "sb-test-auth-token.0", value: "test-refreshed-part0", options: { path: "/" } }]);
          options.cookies.setAll([{ name: "sb-test-auth-token.1", value: "test-refreshed-part1", options: { path: "/" } }]);
        }
        return { data: { claims: {} }, error: null };
      },
    } }),
  },
  "@/lib/supabase-auth-server": {
    createSupabaseAuthServerClient: async () => ({ auth: {
      async getUser() {
        if (authThrows) throw new Error(RAW_ERROR);
        return { data: { user: authUser }, error: authFailure };
      },
      async exchangeCodeForSession(code) { exchangedCode = code; return { error: callbackFailure }; },
    } }),
  },
  "@/lib/supabase-server": {
    supabaseServer: supabaseClient("anon"),
    getSupabaseMutationClient: () => supabaseClient("service"),
  },
  "@/lib/poll-option-image-processing": {
    validateAndEncodeOptionImage: async (_file, optionIndex) => ({ optionIndex, data: Buffer.from("encoded") }),
  },
  "@/lib/poll-option-image-storage": {
    uploadPollOptionImages: async () => [NEW_PATH],
    removePollOptionImages: async (_client, paths) => { cleanedPaths.push(...paths); return null; },
  },
};

function loadModule(file) {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const testModule = { exports: {} };
  modules.set(absolute, testModule);
  const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: absolute,
  }).outputText;
  const requireForTest = (specifier) => {
    if (Object.hasOwn(overrides, specifier)) return overrides[specifier];
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2))
        : path.resolve(path.dirname(absolute), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
      if (!target) throw new Error(`Cannot resolve ${specifier}.`);
      return loadModule(target);
    }
    return nativeRequire(specifier);
  };
  new Function("module", "exports", "require", compiled)(testModule, testModule.exports, requireForTest);
  return testModule.exports;
}

function request(method = "GET", body, headers = {}, ip) {
  const requestHeaders = { "x-forwarded-for": ip ?? `198.18.${Math.floor(clientNumber / 250) % 250}.${clientNumber++ % 250 + 1}`,
    ...(authUser ? { cookie: "sb-test-auth-token=mock-session" } : {}), ...headers };
  if (body !== undefined && !(body instanceof FormData)) requestHeaders["content-type"] = "application/json";
  return new Request("https://example.invalid/api/test", {
    method, headers: requestHeaders,
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
}
const context = (id = POLL_ID) => ({ params: Promise.resolve({ id }) });
async function responseJson(response, status) {
  assert.equal(response.status, status);
  return response.json();
}
function assertNoSecrets(value) {
  const serialized = JSON.stringify(value);
  for (const text of [PRIVATE_TEXT, RAW_ERROR, OWNER_TOKEN, REPORTER_ID]) {
    assert.ok(!serialized.includes(text), `Response leaked a prohibited test value.`);
  }
}
function assertViewerVote(actual, expected) {
  const { managementToken, ...publicState } = actual;
  assert.deepEqual(publicState, expected);
  if (expected.canCancelVote) assert.match(managementToken, /^[0-9a-f]{64}$/);
  else assert.equal(managementToken, undefined);
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }
const detail = loadModule("app/api/polls/[id]/route.ts");
const list = loadModule("app/api/polls/route.ts");
const voteRoutes = loadModule("app/api/polls/[id]/vote/route.ts");
// Older regression cases predate the opaque mutation proof. This harness
// supplies fixture proof exactly as a current browser sends it; token
// omission/tampering tests below call voteRoutes directly instead.
function managedVoteRequest(request) {
  return (async () => {
    const body = await request.clone().json().catch(() => null);
    if (!body || Object.hasOwn(body, 'managementToken')) return request;
    const headers = new Headers(request.headers);
    let guestHash = null;
    try {
      const guest = loadModule('lib/poll-vote-identity.ts').getGuestVoteIdentity(request);
      guestHash = guest.hash;
      if (guest.newCookie) headers.set('cookie', `${headers.get('cookie') ?? ''}; askio_guest_id=${guest.newCookie}`);
    } catch { /* Missing guest config is covered by the actual route. */ }
    const userId = authUser && !authUser.is_anonymous ? authUser.id : null;
    const row = database.poll_votes.find(vote => vote.poll_id === POLL_ID && userId && vote.user_id === userId)
      ?? database.poll_votes.find(vote => vote.poll_id === POLL_ID && guestHash && vote.guest_id_hash === guestHash);
    const secret = process.env.GUEST_ID_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const token = row && secret ? createHmac('sha256', secret)
      .update(JSON.stringify(['askio-vote-management-v1', POLL_ID, String(row.id), userId, guestHash])).digest('hex') : undefined;
    return new Request(request, { headers, body: JSON.stringify({ ...body, managementToken: token }) });
  })();
}
const votes = { ...voteRoutes, PATCH: async (request, context) => voteRoutes.PATCH(await managedVoteRequest(request), context) };
const voteClaim = loadModule("app/api/polls/[id]/vote/claim/route.ts");
const comments = loadModule("app/api/polls/[id]/comments/route.ts");
const reactions = loadModule("app/api/comments/[id]/react/route.ts");
const avatars = loadModule('app/api/profile/avatar/route.ts');
const sorting = loadModule('lib/comment-sorting.ts');
const reports = loadModule("app/api/reports/route.ts");
const admin = loadModule("app/api/admin/polls/route.ts");
const metadata = loadModule("app/vote/[id]/layout.tsx");
const adminQueue = loadModule("app/api/admin/reports/route.ts");
const adminHide = loadModule("app/api/admin/reports/hide/route.ts");
const adminRestore = loadModule("app/api/admin/reports/restore/route.ts");
const adminResolve = loadModule("app/api/admin/reports/resolve/route.ts");
const adminDismiss = loadModule("app/api/admin/reports/dismiss/route.ts");
const adminDelete = loadModule("app/api/admin/reports/delete/route.ts");
const pollDeletion = loadModule("lib/poll-deletion.ts");
const profileRoute = loadModule("app/api/profile/route.ts");
const myActivity = loadModule("app/api/me/route.ts");
const { anonymousCommentAlias, getGuestCommentIdentity, hasMultipleGuestUrls } = loadModule("lib/comment-identity.ts");
const { validateNickname } = loadModule("lib/nickname.ts");
const reportBody = (extra = {}) => ({ targetType: "poll", targetId: POLL_ID, reporterId: REPORTER_ID, reason: "spam", ...extra });

test("hidden poll detail returns unavailable404 without original data", async () => {
  database.polls[0].is_hidden = true;
  database.polls[0].title = PRIVATE_TEXT;
  const json = await responseJson(await detail.GET(request(), context()), 404);
  assert.equal(json.unavailable, true);
  assertNoSecrets(json);
});

test("home excludes hidden rows and suppresses hidden/deleted official fallback", async () => {
  database.polls.push({ ...database.polls[0], id: "official_phone", is_hidden: true, title: PRIVATE_TEXT });
  database.deleted_official_polls.push({ poll_id: "official_car" });
  const response = await list.GET();
  const json = await responseJson(response, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(json.data.map((poll) => poll.id), [POLL_ID]);
  assert.deepEqual(new Set(json.unavailableOfficialPollIds), new Set(["official_phone", "official_car"]));
  assertNoSecrets(json);
});

test("deleted official detail and metadata cannot resurrect static content", async () => {
  database.deleted_official_polls.push({ poll_id: "official_phone" });
  const json = await responseJson(await detail.GET(request(), context("official_phone")), 404);
  assert.equal(json.unavailable, true);
  const meta = await metadata.generateMetadata(context("phone"));
  assert.equal(meta.robots.index, false);
  assert.ok(!JSON.stringify(meta).includes("아이폰"));
});

test("genuinely DB-less static official stays readable and non-reportable", async () => {
  const json = await responseJson(await detail.GET(request(), context("official_phone")), 200);
  assert.equal(json.poll, null);
  assert.equal(json.reportable, false);
});

test("hidden comment becomes a safe parent placeholder and still locks editing", async () => {
  database.comments.push(
    { id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: true, text: PRIVATE_TEXT, user_name: PRIVATE_TEXT, created_at: "2026-10-01" },
    { id: REPLY_ID, poll_id: POLL_ID, parent_id: COMMENT_ID, is_hidden: false, text: "visible reply", user_name: "익명", created_at: "2026-10-02" },
  );
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.poll.structural_edit_allowed, false);
  assert.equal(json.poll.structural_edit_lock_reason, "has_comments");
  const placeholder = json.comments.find((comment) => comment.id === COMMENT_ID);
  assert.equal(placeholder.is_hidden, true);
  assert.equal(placeholder.text, "운영 정책에 따라 숨겨진 의견입니다.");
  assert.equal(placeholder.like_count, 0);
  assert.equal(json.comments.find((comment) => comment.id === REPLY_ID).parent_id, COMMENT_ID);
  assertNoSecrets(json);
  assert.ok(calls.filter((call) => call.role === "service" && call.table === "comments").every((call) =>
    !call.fields.split(",").some((field) => ["text", "user_name", "*"].includes(field))));
});

test("poll hidden during public reads is removed by final visibility recheck", async () => {
  database.polls[0].title = PRIVATE_TEXT;
  queryHook = (query) => {
    if (query.role === "service" && query.table === "polls"
      && calls.filter((call) => call.role === "service" && call.table === "polls").length === 2) {
      database.polls[0].is_hidden = true;
    }
  };
  assertNoSecrets(await responseJson(await detail.GET(request(), context()), 404));
});

test("comment hidden after anon read is serialized only as a placeholder", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false, text: PRIVATE_TEXT, created_at: "2026-10-01" });
  queryHook = (query) => {
    if (query.role === "service" && query.table === "comments") database.comments[0].is_hidden = true;
  };
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].is_hidden, true);
  assertNoSecrets(json);
});

test("hidden polls reject vote, revote, comment, reaction, and owner edit", async () => {
  database.polls[0].is_hidden = true;
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  const voteBody = { optionIndex: 0, voterId: VOTER_ID };
  await responseJson(await votes.POST(request("POST", voteBody), context()), 404);
  await responseJson(await votes.PATCH(request("PATCH", voteBody), context()), 404);
  await responseJson(await comments.POST(request("POST", { text: "opinion" }), context()), 404);
  await responseJson(await reactions.POST(request("POST", { userFingerprint: "test-fingerprint", reaction: "like" }), context(COMMENT_ID)), 404);
  await responseJson(await detail.PATCH(request("PATCH", { description: "safe edit" }, { "x-poll-owner-token": OWNER_TOKEN }), context()), 404);
  assert.equal(calls.filter((call) => call.rpc).length, 0);
});

test("RPC hidden race maps to404 and new image cleanup keeps old image", async () => {
  database.polls[0].option_image_paths = [OLD_PATH, null];
  rpcFailure = { code: "P0002", message: "CONTENT_NOT_AVAILABLE", details: RAW_ERROR };
  const form = new FormData();
  form.set("optionImages[0]", new File([Buffer.from("fixture")], "fixture.png", { type: "image/png" }));
  const json = await responseJson(await detail.PATCH(request("PATCH", form, { "x-poll-owner-token": OWNER_TOKEN }), context()), 404);
  assert.deepEqual(cleanedPaths, [NEW_PATH]);
  assert.equal(database.polls[0].option_image_paths[0], OLD_PATH);
  assertNoSecrets(json);
});

test("owner lock responses expose only known lock reasons", async () => {
  rpcFailure = { code: "P0001", message: "POLL_STRUCTURE_LOCKED", details: RAW_ERROR };
  const json = await responseJson(await detail.PATCH(request("PATCH", { title: "바뀐 질문" }, { "x-poll-owner-token": OWNER_TOKEN }), context()), 409);
  assertNoSecrets(json);
  assert.equal(json.structural_edit_lock_reason, undefined);
  rpcFailure.details = "has_comments";
  const known = await responseJson(await detail.PATCH(request("PATCH", { title: "바뀐 질문" }, { "x-poll-owner-token": OWNER_TOKEN }), context()), 409);
  assert.equal(known.structural_edit_lock_reason, "has_comments");
});

test("vote revote hidden race preserves missing-vote409 distinction", async () => {
  database.poll_votes.push({ poll_id: POLL_ID, user_id: AUTH_USER_ID, option_index: 0 });
  database.polls[0].votes = [1, 0]; database.polls[0].participants = 1;
  rpcFailure = { code: "P0002", message: "CONTENT_NOT_AVAILABLE" };
  await responseJson(await votes.PATCH(request("PATCH", { optionIndex: 0, voterId: VOTER_ID }), context()), 404);
  rpcFailure = { code: "P0002", message: "Existing vote not found." };
  await responseJson(await votes.PATCH(request("PATCH", { optionIndex: 0, voterId: VOTER_ID }), context()), 409);
});

test("reaction success uses atomic RPC while preserving response contract", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  const json = await responseJson(await reactions.POST(request("POST", { userFingerprint: "test-fingerprint", reaction: "like" }), context(COMMENT_ID)), 200);
  assert.deepEqual(json, { likeCount: 1, dislikeCount: 0, userReaction: "like" });
  const rpc = calls.find((call) => call.rpc);
  assert.equal(rpc.rpc, 'toggle_comment_reaction_with_actor');
  assert.equal(rpc.payload.p_actor_key, `account:${AUTH_USER_ID}`);
});

test("public read errors are generic and missing moderation schema fails closed", async () => {
  queryFailure = { error: { code: "XX000", message: RAW_ERROR, details: PRIVATE_TEXT } };
  assertNoSecrets(await responseJson(await list.GET(), 500));
  assertNoSecrets(await responseJson(await detail.GET(request(), context()), 500));
  queryFailure.error.code = "42703";
  assertNoSecrets(await responseJson(await list.GET(), 503));
  assertNoSecrets(loggedErrors);
});

test("report API sends only domain-separated hash and duplicate RPC response", async () => {
  const first = await responseJson(await reports.POST(request("POST", reportBody())), 200);
  const second = await responseJson(await reports.POST(request("POST", reportBody())), 200);
  const third = await responseJson(await reports.POST(request("POST", reportBody({ reporterId: OTHER_REPORTER_ID }))), 200);
  assert.deepEqual([first.duplicate, second.duplicate, third.duplicate], [false, true, false]);
  assert.equal(database.reports.size, 2);
  const payload = calls.find((call) => call.rpc === "submit_content_report").payload;
  assert.equal(payload.p_reporter_hash, createHash("sha256").update(`askio:content-report:reporter:v1\0${REPORTER_ID}`).digest("hex"));
  assertNoSecrets(payload);
  assert.ok(!Object.hasOwn(payload, "p_reporter_id"));
});

test("comment/reply reports normalize UUID and never trust client poll ID", async () => {
  const upperId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  await responseJson(await reports.POST(request("POST", reportBody({ targetType: "comment", targetId: upperId, pollId: "arbitrary-client-poll" }))), 200);
  const payload = calls.find((call) => call.rpc === "submit_content_report").payload;
  assert.equal(payload.p_target_id, upperId.toLowerCase());
  assert.ok(!Object.hasOwn(payload, "p_poll_id"));
});

test("report validation rejects malformed ID/NUL/length and accepts Unicode boundary", async () => {
  for (const extra of [
    { reporterId: "bad" }, { targetType: "reaction" }, { targetType: "comment", targetId: "bad" },
    { reason: "other", detail: "bad\0text" }, { reason: "other", detail: "😀".repeat(301) },
  ]) await responseJson(await reports.POST(request("POST", reportBody(extra))), 400);
  await responseJson(await reports.POST(request("POST", reportBody({ reason: "other", detail: "😀".repeat(300) }))), 200);
  assert.equal(calls.filter((call) => call.rpc).length, 1);
});

test("report rate limit returns429 before another backend call", async () => {
  for (let count = 0; count < 5; count += 1) {
    await responseJson(await reports.POST(request("POST", reportBody(), {}, "198.51.100.101")), 200);
  }
  const response = await reports.POST(request("POST", reportBody(), {}, "198.51.100.101"));
  await responseJson(response, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(calls.filter((call) => call.rpc).length, 5);
});

test("report internal errors never expose database detail", async () => {
  rpcFailure = { code: "XX000", message: RAW_ERROR, details: PRIVATE_TEXT };
  assertNoSecrets(await responseJson(await reports.POST(request("POST", reportBody())), 500));
  assertNoSecrets(loggedErrors);
});

test("admin rejects unauthorized401 and limits repeated authentication failures", async () => {
  for (let count = 0; count < 10; count += 1) {
    await responseJson(await admin.GET(request("GET", undefined, {}, "198.51.100.102")), 401);
  }
  await responseJson(await admin.GET(request("GET", undefined, {}, "198.51.100.102")), 429);
  assert.equal(calls.length, 0);
});

test("authorized admin reads hidden content with service client and generic errors", async () => {
  database.polls[0].is_hidden = true;
  const headers = { "x-admin-key": "moderation-route-test-key" };
  const json = await responseJson(await admin.GET(request("GET", undefined, headers)), 200);
  assert.equal(json.data[0].is_hidden, true);
  assert.ok(calls.every((call) => call.role === "service"));
  queryFailure = { error: { code: "XX000", message: RAW_ERROR } };
  assertNoSecrets(await responseJson(await admin.GET(request("GET", undefined, headers)), 500));
});

test("admin moderation routes authorize and forward exact actions to server RPC", async () => {
  const headers = { "x-admin-key": "moderation-route-test-key" };
  const body = { targetType: "poll", targetId: POLL_ID };
  for (const [route, action] of [
    [adminHide, "hide"], [adminRestore, "restore"], [adminResolve, "resolve"], [adminDismiss, "dismiss"],
  ]) {
    assert.deepEqual(await responseJson(await route.POST(request("POST", body, headers)), 200), { ok: true });
    const call = calls.at(-1);
    assert.equal(call.role, "service");
    assert.equal(call.rpc, "moderate_report_target");
    assert.deepEqual(call.payload, { p_target_type: "poll", p_target_id: POLL_ID, p_action: action });
  }
  const before = calls.length;
  await responseJson(await adminHide.POST(request("POST", body)), 401);
  assert.equal(calls.length, before);
  rpcFailure = { code: "XX000", message: RAW_ERROR, details: PRIVATE_TEXT };
  assertNoSecrets(await responseJson(await adminHide.POST(request("POST", body, headers)), 500));
});

test("admin report queue validates pagination and only queries service RPC", async () => {
  const headers = { "x-admin-key": "moderation-route-test-key" };
  await responseJson(await adminQueue.GET(request("GET", undefined, headers)), 200);
  assert.deepEqual(calls.at(-1).payload, { p_status: "pending", p_limit: 50, p_offset: 0 });
  const invalid = new Request("https://example.invalid/api/admin/reports?status=unknown", { headers });
  await responseJson(await adminQueue.GET(invalid), 400);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].role, "service");
});

test("admin comment deletion delegates reply/reaction transaction to one RPC", async () => {
  const headers = { "x-admin-key": "moderation-route-test-key" };
  const json = await responseJson(await adminDelete.DELETE(request("DELETE", { targetType: "comment", targetId: COMMENT_ID }, headers)), 200);
  assert.deepEqual(json, { ok: true });
  assert.deepEqual(calls[0].payload, { p_comment_id: COMMENT_ID });
  assert.equal(calls[0].rpc, "delete_comment_with_dependents");
  assert.equal(calls.length, 1);
});

test("poll deletion commits RPC before cleanup and never removes another poll path", async () => {
  const invalidPath = "custom_other/options/1/88888888-8888-4888-8888-888888888888.webp";
  database.polls[0].option_image_paths = [OLD_PATH, invalidPath];
  const headers = { "x-admin-key": "moderation-route-test-key" };
  const originalWarning = console.warn;
  console.warn = () => {};
  try {
    const json = await responseJson(await adminDelete.DELETE(request("DELETE", { targetType: "poll", targetId: POLL_ID }, headers)), 200);
    assert.deepEqual(json, { ok: true });
    assert.equal(calls[0].rpc, "delete_poll_with_dependents");
    assert.deepEqual(calls[1].storageRemove, [OLD_PATH]);
    assert.equal(calls[1].bucket, "poll-option-images");
  } finally { console.warn = originalWarning; }
});

test("poll DB deletion failure never removes storage objects", async () => {
  database.polls[0].option_image_paths = [OLD_PATH, null];
  rpcFailure = { code: "XX000", message: RAW_ERROR, details: PRIVATE_TEXT };
  const result = await pollDeletion.deletePollWithImageCleanup(supabaseClient("service"), POLL_ID);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "internal");
  assert.equal(calls.length, 1);
  const headers = { "x-admin-key": "moderation-route-test-key" };
  assertNoSecrets(await responseJson(await adminDelete.DELETE(request("DELETE", { targetType: "poll", targetId: POLL_ID }, headers)), 500));
  assert.equal(calls.filter((call) => call.storageRemove).length, 0);
});

test("storage cleanup failure preserves successful deletion response and logs candidate", async () => {
  database.polls[0].option_image_paths = [OLD_PATH, null];
  storageFailure = { message: "simulated-storage-remove-failure" };
  const headers = { "x-admin-key": "moderation-route-test-key" };
  const json = await responseJson(await adminDelete.DELETE(request("DELETE", { targetType: "poll", targetId: POLL_ID }, headers)), 200);
  assert.deepEqual(json, { ok: true });
  assert.equal(calls[0].rpc, "delete_poll_with_dependents");
  assert.deepEqual(calls[1].storageRemove, [OLD_PATH]);
  assert.ok(loggedErrors.some((entry) => entry[1]?.pollId === POLL_ID && entry[1]?.imageCount === 1));
});

test("text-only poll deletion skips storage entirely", async () => {
  const result = await pollDeletion.deletePollWithImageCleanup(supabaseClient("service"), POLL_ID);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
});

const callback = loadModule("app/auth/callback/route.ts");
const { getSafeAuthReturnPath } = loadModule("lib/auth-redirect.ts");
const { getAuthDisplayName } = loadModule("lib/auth-display.ts");
const createBody = { title: "새 질문입니다", category: "커뮤니티", options: ["첫 선택", "다음 선택"] };

test('guest identity helper generates only a valid opaque hash and independent aliases', async () => {
  const guest = getGuestCommentIdentity(request());
  assert.match(guest.hash, /^[0-9a-f]{64}$/);
  assert.match(guest.newCookie, /^[0-9a-f-]{36}$/);
  const same = getGuestCommentIdentity(request('GET', undefined, { cookie: `askio_guest_id=${guest.newCookie}` }));
  assert.equal(same.hash, guest.hash);
  assert.equal(same.newCookie, null);
  const alias = anonymousCommentAlias(POLL_ID, 'guest', guest.hash);
  assert.match(alias, /^익명 [가-힣]+ [0-9]{2}$/);
  assert.equal(anonymousCommentAlias(POLL_ID, 'guest', same.hash), alias);
  // Display aliases can collide; they are not unique identifiers.
  assert.ok(new Set(Array.from({ length: 10 }, (_, index) => anonymousCommentAlias(`custom_${index}`, 'guest', same.hash))).size > 1);
});

const GUEST_COOKIE = `askio_guest_id=${OTHER_REPORTER_ID}`;
function assertAnonymousIdentity(json) {
  for (const key of ['user_id', 'guest_id_hash', 'anonymous_alias', 'nickname', 'avatar_url', 'email', 'user_metadata']) {
    assert.equal(Object.hasOwn(json.data, key), false, `Anonymous response exposed ${key}.`);
  }
  assert.match(json.data.displayName, /^익명 [가-힣]+ [0-9]{2}$/);
}

test('guest comment creates a secure HttpOnly cookie, stores only HMAC and ignores spoofed identity', async () => {
  authUser = null;
  const response = await comments.POST(request('POST', { text: '게스트 의견', userId: AUTH_USER_ID,
    guestId: REPORTER_ID, nickname: PROFILE_NICKNAME, alias: '가짜 이름' }), context());
  const json = await responseJson(response, 200);
  assertAnonymousIdentity(json);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /askio_guest_id=[0-9a-f-]{36}/);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=lax', 'Path=/', 'Max-Age=31536000']) assert.ok(cookie.includes(flag));
  const raw = cookie.match(/askio_guest_id=([^;]+)/)[1];
  assert.ok(!JSON.stringify(database.comments).includes(raw));
  assert.ok(!JSON.stringify(json).includes(raw));
  assert.ok(!JSON.stringify(loggedErrors).includes(raw));
  assert.equal(database.comments[0].user_id, null);
  assert.match(database.comments[0].guest_id_hash, /^[0-9a-f]{64}$/);
});

test('guest reply reuses poll-scoped alias and cookie without linking an account', async () => {
  authUser = null;
  const initial = await comments.POST(request('POST', { text: '첫 의견' }, { cookie: GUEST_COOKIE }), context());
  const first = await responseJson(initial, 200);
  assert.equal(initial.headers.get('set-cookie'), null);
  database.comments[0].created_at = new Date(Date.now() - 20_000).toISOString();
  const reply = await responseJson(await comments.POST(request('POST', { text: '다른 이유도 있어요', parentId: COMMENT_ID }, { cookie: GUEST_COOKIE }), context()), 200);
  assertAnonymousIdentity(reply);
  assert.equal(reply.data.displayName, first.data.displayName);
  assert.equal(database.comments[1].parent_id, COMMENT_ID);
  assert.equal(database.comments[1].guest_id_hash, database.comments[0].guest_id_hash);
  assert.equal(database.comments[1].user_id, null);
});

test('guest cooldown and duplicate text return safe429 with no second insert', async () => {
  authUser = null;
  await responseJson(await comments.POST(request('POST', { text: '같은 의견' }, { cookie: GUEST_COOKIE }), context()), 200);
  const rapid = await comments.POST(request('POST', { text: '다른 의견' }, { cookie: GUEST_COOKIE }), context());
  assertNoSecrets(await responseJson(rapid, 429));
  assert.equal(rapid.headers.get('retry-after'), '10');
  database.comments[0].created_at = new Date(Date.now() - 20_000).toISOString();
  await responseJson(await comments.POST(request('POST', { text: '같은 의견' }, { cookie: GUEST_COOKIE }), context()), 429);
  assert.equal(database.comments.length, 1);
});

test('guest multi-link spam is rejected while a single link is allowed', async () => {
  authUser = null;
  assert.equal(hasMultipleGuestUrls('example.com 과 www.example.org'), true);
  await responseJson(await comments.POST(request('POST', { text: 'https://example.com https://example.org' }), context()), 400);
  assert.equal(calls.filter((call) => call.rpc).length, 0);
  await responseJson(await comments.POST(request('POST', { text: '참고 https://example.com' }), context()), 200);
});

test('guest IP limit persists even when cookies are replaced', async () => {
  authUser = null;
  for (let index = 0; index < 10; index += 1) await responseJson(await comments.POST(request('POST', { text: `의견 ${index}` }, {}, '198.51.100.240'), context()), 200);
  await responseJson(await comments.POST(request('POST', { text: '추가 의견' }, {}, '198.51.100.240'), context()), 429);
  assert.equal(database.comments.length, 10);
});

test('guest cross-origin, malformed parent and hidden parent fail without writes', async () => {
  authUser = null;
  await responseJson(await comments.POST(request('POST', { text: '의견' }, { origin: 'https://evil.invalid' }), context()), 403);
  await responseJson(await comments.POST(request('POST', { text: '의견', parentId: 'bad-id' }), context()), 400);
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: true });
  await responseJson(await comments.POST(request('POST', { text: '답글', parentId: COMMENT_ID }), context()), 404);
  assert.equal(calls.filter((call) => call.rpc).length, 0);
});

test('missing guest secret fails closed503 but named comments remain available', async () => {
  const secret = process.env.GUEST_ID_SECRET;
  try {
    delete process.env.GUEST_ID_SECRET;
    authUser = null;
    assertNoSecrets(await responseJson(await comments.POST(request('POST', { text: '의견' }), context()), 503));
    assert.equal(calls.filter((call) => call.rpc).length, 0);
    authUser = { id: AUTH_USER_ID, is_anonymous: false };
    await responseJson(await comments.POST(request('POST', { text: '일반 의견' }), context()), 200);
  } finally { process.env.GUEST_ID_SECRET = secret; }
});

test('guest localhost cookie is usable over HTTP without weakening HTTPS production', async () => {
  authUser = null;
  const local = new Request('http://localhost:3000/api/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '로컬 의견' }) });
  const response = await comments.POST(local, context());
  await responseJson(response, 200);
  assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(!response.headers.get('set-cookie').includes('Secure'));
});

test('logged-in anonymous comments keep internal account but repeat only public alias', async () => {
  const first = await responseJson(await comments.POST(request('POST', { text: '익명 의견', isAnonymous: true }), context()), 200);
  const next = await responseJson(await comments.POST(request('POST', { text: '익명 답글', parentId: COMMENT_ID, isAnonymous: true }), context()), 200);
  assertAnonymousIdentity(first);
  assertAnonymousIdentity(next);
  assert.equal(first.data.displayName, next.data.displayName);
  assert.ok(database.comments.every((row) => row.user_id === AUTH_USER_ID && row.guest_id_hash === null));
});

test('avatar opt-in default hides social photo and explicit true reveals it only on named comments', async () => {
  const off = await responseJson(await comments.POST(request('POST', { text: '일반 의견' }), context()), 200);
  assert.equal(off.data.nickname, PROFILE_NICKNAME);
  assert.equal(off.data.avatar_url, null);
  await responseJson(await profileRoute.PATCH(request('PATCH', { showAvatar: true })), 200);
  const on = await responseJson(await comments.POST(request('POST', { text: '사진 공개 의견' }), context()), 200);
  assert.equal(on.data.avatar_url, PROFILE_AVATAR);
  const hidden = await responseJson(await comments.POST(request('POST', { text: '익명 의견', isAnonymous: true }), context()), 200);
  assertAnonymousIdentity(hidden);
  await responseJson(await profileRoute.PATCH(request('PATCH', { showAvatar: false })), 200);
  assert.equal((await responseJson(await profileRoute.GET(request()), 200)).data.show_avatar, false);
});

test('avatar preferences reject invalid flags or opt-in with no social image', async () => {
  await responseJson(await profileRoute.PATCH(request('PATCH', { showAvatar: 'true' })), 400);
  database.profiles[0].avatar_url = null;
  await responseJson(await profileRoute.PATCH(request('PATCH', { showAvatar: true })), 400);
  assert.equal(database.profiles[0].show_avatar, false);
});

test('my activity selects only verified authors including own anonymous replies, never guests or other accounts', async () => {
  database.polls[0].author_user_id = AUTH_USER_ID;
  database.polls.push({ ...database.polls[0], id: 'custom_other', author_user_id: REPORTER_ID });
  database.comments.push(
    { id: COMMENT_ID, poll_id: POLL_ID, text: '내 익명 의견', user_id: AUTH_USER_ID, is_anonymous: true, is_hidden: false },
    { id: REPLY_ID, poll_id: POLL_ID, text: '내 답글', user_id: AUTH_USER_ID, parent_id: COMMENT_ID, is_hidden: false },
    { id: REPORTER_ID, poll_id: POLL_ID, text: '타인 의견', user_id: REPORTER_ID, is_hidden: false },
    { id: OTHER_REPORTER_ID, poll_id: POLL_ID, text: '게스트 의견', user_id: null, guest_id_hash: 'b'.repeat(64), is_hidden: false },
  );
  const response = await myActivity.GET(request());
  const json = await responseJson(response, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(json.polls.map((row) => row.id), [POLL_ID]);
  assert.deepEqual(json.comments.map((row) => row.id), [COMMENT_ID, REPLY_ID]);
  assert.equal(json.comments[0].is_anonymous, true);
  assert.equal(json.comments[1].is_reply, true);
  for (const row of [...json.polls, ...json.comments]) for (const key of ['user_id', 'author_user_id', 'guest_id_hash', 'email', 'avatar_url']) assert.equal(Object.hasOwn(row, key), false);
});

test('my activity rejects guest and arbitrary account queries', async () => {
  authUser = null;
  await responseJson(await myActivity.GET(request()), 401);
  assert.equal(calls.length, 0);
  authUser = { id: AUTH_USER_ID, is_anonymous: false };
  await responseJson(await myActivity.GET(new Request(`https://example.invalid/api/me?userId=${REPORTER_ID}`)), 400);
  assert.equal(calls.length, 0);
});

test('my activity final visibility check removes raced hidden comments and polls', async () => {
  database.polls[0].author_user_id = AUTH_USER_ID;
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, text: PRIVATE_TEXT, user_id: AUTH_USER_ID, is_hidden: false });
  queryHook = (query) => { if (query.fields === 'id') database.comments[0].is_hidden = true; };
  const json = await responseJson(await myActivity.GET(request()), 200);
  assert.equal(json.comments.length, 0);
  assertNoSecrets(json);
  queryHook = (query) => { if (query.fields === 'id,title') database.polls[0].is_hidden = true; };
  assert.deepEqual(await responseJson(await myActivity.GET(request()), 200), { polls: [], comments: [] });
});

test('my activity database errors expose only safe errors', async () => {
  queryFailure = { table: 'comments', error: { code: 'XX000', message: RAW_ERROR } };
  assertNoSecrets(await responseJson(await myActivity.GET(request()), 500));
});

test('public detail preserves guest alias without exposing its private hash or raw cookie', async () => {
  authUser = null;
  await responseJson(await comments.POST(request('POST', { text: '게스트 의견' }, { cookie: GUEST_COOKIE }), context()), 200);
  const hash = database.comments[0].guest_id_hash;
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].displayName, database.comments[0].anonymous_alias);
  assertAnonymousIdentity({ data: json.comments[0] });
  assert.ok(!JSON.stringify(json).includes(hash));
  assert.ok(!JSON.stringify(json).includes(OTHER_REPORTER_ID));
});

test('missing guest posting RPC is safe503 and never falls back to direct inserts', async () => {
  authUser = null;
  rpcFailure = { code: 'PGRST202', message: RAW_ERROR };
  assertNoSecrets(await responseJson(await comments.POST(request('POST', { text: '게스트 의견' }), context()), 503));
  assert.equal(database.comments.length, 0);
  assert.equal(calls.filter((call) => call.insert).length, 0);
});

test("anonymous public reads/results remain available without altering votes", async () => {
  authUser = null;
  database.polls[0].votes = [8, 4];
  database.polls[0].participants = 12;
  const before = JSON.stringify(database.polls);
  await responseJson(await list.GET(), 200);
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.deepEqual(json.poll.votes, [8, 4]);
  assert.equal(JSON.stringify(database.polls), before);
});

test("guest poll creation remains login-only", async () => {
  authUser = null;
  for (const response of [
    await list.POST(request("POST", createBody)),
  ]) {
    const json = await responseJson(response, 401);
    assert.equal(json.code, "AUTH_REQUIRED");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(calls.length, 0);
});

test("unverified expired anonymous-provider and unavailable Auth sessions fail closed", async () => {
  for (const scenario of ["error", "missing", "anonymous", "throws"]) {
    authFailure = scenario === "error" ? { message: RAW_ERROR } : null;
    authUser = scenario === "missing" ? null : { id: AUTH_USER_ID, is_anonymous: scenario === "anonymous" };
    authThrows = scenario === "throws";
    assertNoSecrets(await responseJson(await comments.POST(request("POST", { text: "의견" }, { cookie: 'sb-test-auth-token=invalid-session' }), context()), 401));
  }
  assert.equal(calls.length, 0);
  assertNoSecrets(loggedErrors);
});

test("cross-origin protected mutations fail403 before auth or DB writes", async () => {
  for (const headers of [{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    await responseJson(await list.POST(request("POST", createBody, headers)), 403);
  }
  assert.equal(calls.length, 0);
});

test("authenticated poll creation preserves owner RPC wrapper and zero initial vote data", async () => {
  const before = JSON.stringify(database.polls[0]);
  const json = await responseJson(await list.POST(request("POST", createBody, { origin: "https://example.invalid" })), 200);
  const call = calls.find((entry) => entry.rpc === "create_owned_poll_with_author");
  assert.equal(call.role, "service");
  assert.deepEqual(call.payload.p_votes, [0, 0]);
  assert.equal(call.payload.p_participants, 0);
  assert.match(call.payload.p_owner_token_hash, /^[0-9a-f]{64}$/);
  assert.equal(call.payload.p_edit_lock_mode, "first_vote");
  assert.equal(call.payload.p_author_user_id, AUTH_USER_ID);
  assert.equal(call.payload.p_is_anonymous, false);
  assert.ok(json.data.ownerToken);
  assert.equal(JSON.stringify(database.polls[0]), before);
});

test("comment identity comes only from verified session and is not serialized publicly", async () => {
  const json = await responseJson(await comments.POST(request("POST", {
    text: "내 의견", user_id: REPORTER_ID, userId: REPORTER_ID, user_name: "다른 작성자", email: "spoof@example.invalid",
  }), context()), 200);
  assert.equal(database.comments[0].user_id, AUTH_USER_ID);
  assert.equal(database.comments[0].user_name, PROFILE_NICKNAME);
  assert.equal(json.data.user_name, PROFILE_NICKNAME);
  assert.ok(!Object.hasOwn(json.data, "user_id"));
  const publicJson = await responseJson(await detail.GET(request(), context()), 200);
  assert.ok(!Object.hasOwn(publicJson.comments[0], "user_id"));
  assert.ok(!JSON.stringify(publicJson).includes(AUTH_USER_ID));
  assert.ok(!JSON.stringify(publicJson).includes("서버 사용자"));
  assert.ok(!JSON.stringify(publicJson).includes("member@example.invalid"));
});

test("authenticated reply preserves same-poll parent relation and server identity", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false, user_name: "익명 유저", text: "기존 의견" });
  const json = await responseJson(await comments.POST(request("POST", { text: "새 답글", parentId: COMMENT_ID }), context()), 200);
  assert.equal(json.data.parent_id, COMMENT_ID);
  assert.equal(database.comments[1].user_id, AUTH_USER_ID);
  assert.equal(database.comments[0].user_name, "익명 유저");
});

test("authenticated reply rejects hidden and other-poll parents without inserts", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: "custom_other", is_hidden: false });
  await responseJson(await comments.POST(request("POST", { text: "새 답글", parentId: COMMENT_ID }), context()), 404);
  database.comments[0].poll_id = POLL_ID;
  database.comments[0].is_hidden = true;
  await responseJson(await comments.POST(request("POST", { text: "새 답글", parentId: COMMENT_ID }), context()), 404);
  assert.equal(calls.filter((call) => call.insert).length, 0);
});

test("logout preserves old authorship while new comments become separate guest activity", async () => {
  await responseJson(await comments.POST(request("POST", { text: "로그인 의견" }), context()), 200);
  const before = JSON.stringify(database.comments[0]);
  authUser = null;
  await responseJson(await comments.POST(request("POST", { text: "로그아웃 의견" }), context()), 200);
  assert.equal(JSON.stringify(database.comments[0]), before);
  assert.equal(database.comments[1].user_id, null);
  assert.ok(database.comments[1].guest_id_hash);
});

test("guest voting ignores caller voter identity and supports changing its own choice", async () => {
  authUser = null;
  const voteBody = { optionIndex: 0, voterId: VOTER_ID };
  await responseJson(await votes.POST(request("POST", voteBody, { cookie: GUEST_COOKIE }), context()), 200);
  await responseJson(await votes.PATCH(request("PATCH", { ...voteBody, optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.deepEqual(database.polls[0].votes, [0, 1]);
  assert.equal(database.polls[0].participants, 1);
  assert.equal(database.poll_votes.length, 1);
  assert.notEqual(database.poll_votes[0].voter_id, VOTER_ID);
  assert.deepEqual(calls.filter(call => call.rpc).map(call => call.rpc), ['cast_guest_poll_vote', 'change_managed_poll_vote']);
});

test("anonymous reporting remains available independently of Auth", async () => {
  authUser = null;
  await responseJson(await reports.POST(request("POST", reportBody())), 200);
  assert.equal(calls.at(-1).rpc, "submit_content_report");
});

test("authenticated insert DB failure never leaks internal error or user credentials", async () => {
  rpcFailure = { code: "XX000", message: RAW_ERROR };
  assertNoSecrets(await responseJson(await comments.POST(request("POST", { text: "의견" }), context()), 500));
  assertNoSecrets(loggedErrors);
});

function assertNoAccountIdentity(value, { anonymous = false } = {}) {
  const serialized = JSON.stringify(value);
  for (const prohibited of [AUTH_USER_ID, "member@example.invalid", "서버 사용자", "spoof@example.invalid"]) {
    assert.ok(!serialized.includes(prohibited), "Public response leaked account identity or OAuth metadata.");
  }
  if (anonymous) {
    assert.ok(!serialized.includes(PROFILE_NICKNAME), "Anonymous response leaked a profile nickname.");
    assert.ok(!serialized.includes(PROFILE_AVATAR), "Anonymous response leaked a profile avatar.");
  }
  const checkKeys = (item) => {
    if (!item || typeof item !== "object") return;
    for (const [key, nested] of Object.entries(item)) {
      assert.ok(!["user_id", "author_user_id", "guest_id_hash", "voter_id", "email", "user_metadata", "account_provider"].includes(key), "Response exposed a private account field.");
      if (anonymous) assert.ok(!["nickname", "avatar_url"].includes(key), "Anonymous response must omit profile fields entirely.");
      checkKeys(nested);
    }
  };
  checkKeys(value);
  assertNoSecrets(value);
}

test("profile routes require verified Auth and do not trust caller account identifiers", async () => {
  authUser = null;
  await responseJson(await profileRoute.GET(request()), 401);
  await responseJson(await profileRoute.PATCH(request("PATCH", { nickname: "다른펭귄" })), 401);
  await responseJson(await profileRoute.POST(request("POST", { action: "recommend" })), 401);
  assert.equal(calls.length, 0);
  authUser = { id: AUTH_USER_ID, is_anonymous: false };
  const before = JSON.stringify(database.profiles);
  await responseJson(await profileRoute.PATCH(request("PATCH", { nickname: "다른펭귄", userId: REPORTER_ID })), 400);
  await responseJson(await profileRoute.POST(request("POST", { action: "recommend", userId: REPORTER_ID })), 400);
  assert.equal(JSON.stringify(database.profiles), before);
  const json = await responseJson(await profileRoute.GET(new Request(`https://example.invalid/api/profile?userId=${REPORTER_ID}`)), 200);
  assert.equal(calls.at(-1).payload.p_user_id, AUTH_USER_ID);
  assert.deepEqual(json.data, { nickname: PROFILE_NICKNAME, avatar_url: PROFILE_AVATAR, onboarding_completed: false, show_avatar: false,
    avatar_source: 'social', social_avatar_url: PROFILE_AVATAR, uploaded_avatar_url: null });
  assertNoAccountIdentity(json);
});

test("profile GET ensures missing provider-neutral profile without publishing Auth metadata", async () => {
  database.profiles = [];
  authUser = { id: AUTH_USER_ID, is_anonymous: false, user_metadata: { nickname: "카카오실명", full_name: "서버 사용자" } };
  const response = await profileRoute.GET(request());
  const json = await responseJson(response, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(database.profiles.length, 1);
  assert.equal(database.profiles[0].id, AUTH_USER_ID);
  assert.equal(json.data.nickname, "파란여우1937");
  assert.equal(json.data.onboarding_completed, false);
  assert.equal(json.data.avatar_url, null);
  assertNoAccountIdentity(json);
  assert.ok(!JSON.stringify(json).includes("카카오실명"));
});

test("profile PATCH trims nickname, updates only verified account and persists onboarding", async () => {
  database.profiles.push({ id: REPORTER_ID, nickname: "다른사용자", avatar_url: null, onboarding_completed: false });
  const otherBefore = JSON.stringify(database.profiles[1]);
  const json = await responseJson(await profileRoute.PATCH(request("PATCH", { nickname: "  새펭귄_12  ", onboardingCompleted: true })), 200);
  assert.equal(json.data.nickname, "새펭귄_12");
  assert.equal(json.data.onboarding_completed, true);
  assert.equal(database.profiles[0].nickname, "새펭귄_12");
  assert.equal(JSON.stringify(database.profiles[1]), otherBefore);
  assert.deepEqual(calls.find((call) => call.update).equals, [["id", AUTH_USER_ID]]);
  assertNoAccountIdentity(json);
});

test("profile PATCH accepts onboarding-only completion without changing nickname", async () => {
  const json = await responseJson(await profileRoute.PATCH(request("PATCH", { onboardingCompleted: true })), 200);
  assert.equal(json.data.nickname, PROFILE_NICKNAME);
  assert.equal(json.data.onboarding_completed, true);
  assert.deepEqual(calls.find((call) => call.update).update, { onboarding_completed: true });
});

test("profile nickname collision maps mocked case-insensitive unique error to safe409", async () => {
  database.profiles.push({ id: REPORTER_ID, nickname: "AskioUser", avatar_url: null, onboarding_completed: false });
  const before = JSON.stringify(database.profiles);
  for (const nickname of ["AskioUser", "askiouser", "ASKIOUSER"]) {
    const json = await responseJson(await profileRoute.PATCH(request("PATCH", { nickname })), 409);
    assert.equal(json.code, "NICKNAME_TAKEN");
    assertNoSecrets(json);
  }
  assert.equal(JSON.stringify(database.profiles), before);
});

test("nickname policy rejects reserved, controls, URLs, invalid characters and length", async () => {
  for (const nickname of ["admin", "ADMIN", "Administrator", "Askio", "운영자", "관리자", "공식", "OFFICIAL",
    "a", "가".repeat(17), "hello world", "a.b", "https://site", "😀😀", "abc\u0000", "abc\u202e", "\nabc\n"]) {
    assert.equal(validateNickname(nickname).ok, false, `Nickname unexpectedly accepted: ${JSON.stringify(nickname)}`);
    await responseJson(await profileRoute.PATCH(request("PATCH", { nickname })), 400);
  }
  assert.equal(calls.length, 0);
});

test("nickname policy supports exact Korean Unicode boundaries and normal whitespace trimming", async () => {
  for (const nickname of ["가나", "가".repeat(16), "AB", "a".repeat(16), "새이름_1", "ㄱㅏ"]) {
    const validated = validateNickname(nickname);
    assert.equal(validated.ok, true);
    const json = await responseJson(await profileRoute.PATCH(request("PATCH", { nickname: `  ${nickname}  ` })), 200);
    assert.equal(json.data.nickname, nickname);
  }
});

test("nickname policy rejects raw leading tabs and invisible FEFF before whitespace trimming", async () => {
  for (const nickname of ["\t새닉네임", "새닉네임\t", "\uFEFF새닉네임", "새닉네임\uFEFF", "  \t새닉네임  "]) {
    assert.equal(validateNickname(nickname).ok, false);
    await responseJson(await profileRoute.PATCH(request("PATCH", { nickname })), 400);
  }
  assert.equal(calls.length, 0);
});

test("profile recommend uses only server session ID and returns safe generated fields", async () => {
  const response = await profileRoute.POST(request("POST", { action: "recommend" }));
  const json = await responseJson(response, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls.at(-1), { role: "service", rpc: "recommend_user_profile_nickname", payload: { p_user_id: AUTH_USER_ID } });
  assert.equal(json.data.nickname, "졸린수달6142");
  assertNoAccountIdentity(json);
});

test("profile writes reject invalid body flags and cross-origin requests before mutation", async () => {
  for (const body of [null, [], {}, { avatar_url: PROFILE_AVATAR }, { onboardingCompleted: "true" }, { nickname: 1 }]) {
    await responseJson(await profileRoute.PATCH(request("PATCH", body)), 400);
  }
  await responseJson(await profileRoute.PATCH(request("PATCH", { nickname: "새닉네임" }, { origin: "https://evil.invalid" })), 403);
  await responseJson(await profileRoute.POST(request("POST", { action: "unknown" })), 400);
  assert.equal(calls.length, 0);
});

test("profile updates/recommendations share rate limiting without additional mutation", async () => {
  const ip = "198.51.100.111";
  for (let count = 0; count < 10; count += 1) {
    await responseJson(await profileRoute.PATCH(request("PATCH", { onboardingCompleted: true }, {}, ip)), 200);
  }
  const before = calls.length;
  const response = await profileRoute.POST(request("POST", { action: "recommend" }, {}, ip));
  await responseJson(response, 429);
  assert.ok(Number(response.headers.get("retry-after")) > 0);
  assert.equal(calls.length, before);
});

test("profile missing migration and DB failures return generic fail-closed errors", async () => {
  rpcFailure = { code: "PGRST202", message: RAW_ERROR, details: PRIVATE_TEXT };
  const missing = await responseJson(await profileRoute.GET(request()), 503);
  assert.equal(missing.code, "ACCOUNT_MIGRATION_REQUIRED");
  assertNoSecrets(missing);
  rpcFailure = { code: "XX000", message: RAW_ERROR, details: PRIVATE_TEXT };
  assertNoSecrets(await responseJson(await profileRoute.POST(request("POST", { action: "recommend" })), 500));
  assertNoSecrets(loggedErrors);
});

test("profile GET strips unsafe avatars rather than trusting provider URL protocols", async () => {
  database.profiles[0].avatar_url = "javascript:alert(1)";
  const json = await responseJson(await profileRoute.GET(request()), 200);
  assert.equal(json.data.avatar_url, null);
  assertNoAccountIdentity(json);
});

test("anonymous comment preserves internal account ID but publishes no profile identity", async () => {
  const json = await responseJson(await comments.POST(request("POST", {
    text: "익명 의견", isAnonymous: true, userId: REPORTER_ID, user_name: "서버 사용자", avatar_url: PROFILE_AVATAR,
  }), context()), 200);
  assert.equal(database.comments[0].user_id, AUTH_USER_ID);
  assert.equal(database.comments[0].is_anonymous, true);
  const alias = anonymousCommentAlias(POLL_ID, 'account', AUTH_USER_ID);
  assert.equal(database.comments[0].user_name, alias);
  assert.equal(json.data.user_name, alias);
  assert.equal(json.data.displayName, alias);
  assert.ok(!Object.hasOwn(json.data, "avatar_url"));
  assert.ok(!Object.hasOwn(json.data, "nickname"));
  assert.equal(json.data.is_anonymous, true);
  assertNoAccountIdentity(json, { anonymous: true });
  const publicJson = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(publicJson.comments[0].user_name, alias);
  assert.ok(!Object.hasOwn(publicJson.comments[0], "avatar_url"));
  assert.ok(!Object.hasOwn(publicJson.comments[0], "nickname"));
  assertNoAccountIdentity(publicJson, { anonymous: true });
  assert.equal(calls.filter((call) => call.table === "profiles").length, 0);
});

test("anonymous reply retains parent relation, true user ID and anonymous public identity", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false,
    user_id: null, user_name: "익명 유저", text: "기존 의견" });
  const json = await responseJson(await comments.POST(request("POST", { text: "익명 답글", parentId: COMMENT_ID, isAnonymous: true }), context()), 200);
  assert.equal(database.comments[1].user_id, AUTH_USER_ID);
  assert.equal(database.comments[1].is_anonymous, true);
  assert.equal(json.data.parent_id, COMMENT_ID);
  assert.equal(json.data.user_name, anonymousCommentAlias(POLL_ID, 'account', AUTH_USER_ID));
  assertNoAccountIdentity(json, { anonymous: true });
});

test("public comment projection ignores stored OAuth names for account rows and preserves legacy names", async () => {
  database.profiles[0].show_avatar = true;
  database.comments.push(
    { id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false, is_anonymous: false,
      user_id: AUTH_USER_ID, user_name: "서버 사용자", text: "계정 의견", created_at: "2026-10-01" },
    { id: REPLY_ID, poll_id: POLL_ID, parent_id: COMMENT_ID, is_hidden: false, is_anonymous: false,
      user_id: null, user_name: "예전 익명 유저", text: "기존 답글", created_at: "2026-10-02" },
  );
  const json = await responseJson(await detail.GET(request(), context()), 200);
  const member = json.comments.find((row) => row.id === COMMENT_ID);
  const legacy = json.comments.find((row) => row.id === REPLY_ID);
  assert.equal(member.user_name, PROFILE_NICKNAME);
  assert.equal(member.avatar_url, PROFILE_AVATAR);
  assert.equal(legacy.user_name, "예전 익명 유저");
  assert.ok(!Object.hasOwn(legacy, "avatar_url"));
  assert.ok(!Object.hasOwn(legacy, "nickname"));
  assertNoAccountIdentity(json);
  assert.ok(calls.filter((call) => call.table === "profiles").every((call) => call.role === "service"));
});

test("public anonymous rows suppress even stale stored nickname/avatar and hidden authors", async () => {
  database.comments.push(
    { id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false, is_anonymous: true,
      user_id: AUTH_USER_ID, user_name: PROFILE_NICKNAME, avatar_url: PROFILE_AVATAR,
      text: "공개 익명 의견", created_at: "2026-10-01" },
    { id: REPLY_ID, poll_id: POLL_ID, parent_id: COMMENT_ID, is_hidden: true, is_anonymous: false,
      user_id: AUTH_USER_ID, user_name: PROFILE_NICKNAME, text: PRIVATE_TEXT, created_at: "2026-10-02" },
  );
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].user_name, "익명");
  assert.ok(!Object.hasOwn(json.comments[0], "avatar_url"));
  assert.ok(!Object.hasOwn(json.comments[0], "nickname"));
  assertNoAccountIdentity(json, { anonymous: true });
  assert.equal(calls.filter((call) => call.table === "profiles").length, 0);
});

test("final moderation recheck redacts comment hidden during public profile lookup", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false,
    is_anonymous: false, user_id: AUTH_USER_ID, user_name: PROFILE_NICKNAME,
    text: PRIVATE_TEXT, created_at: "2026-10-01" });
  database.comment_reactions.push({ comment_id: COMMENT_ID, reaction: "like", user_fingerprint: "test-fingerprint" });
  queryHook = (query) => {
    if (query.role === "service" && query.table === "profiles") database.comments[0].is_hidden = true;
  };
  const json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].is_hidden, true);
  assert.equal(json.comments[0].text, "운영 정책에 따라 숨겨진 의견입니다.");
  assert.equal(json.comments[0].user_name, "");
  assert.equal(json.comments[0].like_count, 0);
  assertNoAccountIdentity(json, { anonymous: true });
  const profileCall = calls.findIndex((call) => call.table === "profiles");
  const finalStateCall = calls.findLastIndex((call) => call.role === "service" && call.table === "comments");
  assert.ok(profileCall >= 0 && finalStateCall > profileCall, "Visibility must be checked after awaited profile reads.");
});

test("comment anonymous flag requires a true JSON boolean instead of truthy strings", async () => {
  for (const isAnonymous of ["true", "false", 1, 0, null, {}, []]) {
    await responseJson(await comments.POST(request("POST", { text: "의견", isAnonymous }), context()), 400);
  }
  assert.equal(calls.filter((call) => call.insert).length, 0);
});

test("anonymous poll creation stores verified author without changing owner or voter model", async () => {
  const before = JSON.stringify(database.polls[0]);
  const json = await responseJson(await list.POST(request("POST", {
    ...createBody, isAnonymous: true, author_user_id: REPORTER_ID, userId: REPORTER_ID,
  })), 200);
  const created = database.polls.find((row) => row.id === json.data.id);
  assert.equal(created.author_user_id, AUTH_USER_ID);
  assert.equal(created.is_anonymous, true);
  assert.deepEqual(created.votes, [0, 0]);
  assert.equal(created.participants, 0);
  assert.equal(database.poll_votes.length, 0);
  assert.ok(json.data.ownerToken);
  assert.ok(!JSON.stringify(json.data).includes(AUTH_USER_ID));
  assert.equal(JSON.stringify(database.polls[0]), before);
});

test("multipart poll anonymous flag supports explicit true/false with existing image pipeline", async () => {
  for (const isAnonymous of ["true", "false"]) {
    const form = new FormData();
    form.set("title", createBody.title);
    form.set("category", createBody.category);
    form.set("options", JSON.stringify(createBody.options));
    form.set("isAnonymous", isAnonymous);
    form.set("optionImages[0]", new File([Buffer.from("fixture")], "fixture.png", { type: "image/png" }));
    const json = await responseJson(await list.POST(request("POST", form)), 200);
    const call = calls.filter((row) => row.rpc === "create_owned_poll_with_author").at(-1);
    assert.equal(call.payload.p_author_user_id, AUTH_USER_ID);
    assert.equal(call.payload.p_is_anonymous, isAnonymous === "true");
    assert.deepEqual(call.payload.p_option_image_paths, [NEW_PATH, null]);
    assert.deepEqual(call.payload.p_votes, [0, 0]);
    assert.ok(json.data.ownerToken);
  }
  assert.deepEqual(cleanedPaths, []);
});

test("poll anonymous validation rejects nonbooleans and invalid multipart values before creation", async () => {
  for (const isAnonymous of ["true", "false", 1, null, {}]) {
    await responseJson(await list.POST(request("POST", { ...createBody, isAnonymous })), 400);
  }
  for (const value of ["1", "TRUE", "", "yes"]) {
    const form = new FormData();
    form.set("title", createBody.title);
    form.set("category", createBody.category);
    form.set("options", JSON.stringify(createBody.options));
    form.set("isAnonymous", value);
    await responseJson(await list.POST(request("POST", form)), 400);
  }
  assert.equal(calls.filter((call) => call.rpc === "create_owned_poll_with_author").length, 0);
});

test("home and poll detail serialize no author account IDs for named or anonymous polls", async () => {
  for (const isAnonymous of [true, false]) {
    Object.assign(database.polls[0], { author_user_id: AUTH_USER_ID, is_anonymous: isAnonymous,
      email: "member@example.invalid", user_metadata: { full_name: "서버 사용자" } });
    const listJson = await responseJson(await list.GET(), 200);
    const detailJson = await responseJson(await detail.GET(request(), context()), 200);
    assertNoAccountIdentity(listJson);
    assertNoAccountIdentity(detailJson);
    assert.equal(detailJson.poll.is_anonymous, isAnonymous);
  }
  assert.ok(calls.filter((call) => call.role === "anon" && call.table === "polls")
    .every((call) => call.fields !== "*" && !call.fields.includes("author_user_id")));
});

test("owner PATCH strips author identity from service RPC while preserving existing votes", async () => {
  Object.assign(database.polls[0], { author_user_id: AUTH_USER_ID, is_anonymous: true,
    votes: [8, 4], participants: 12 });
  database.poll_votes.push({ poll_id: POLL_ID, voter_id: VOTER_ID, option_index: 0 });
  const votesBefore = JSON.stringify(database.poll_votes);
  const json = await responseJson(await detail.PATCH(request("PATCH", { description: "설명만 보정" }, { "x-poll-owner-token": OWNER_TOKEN }), context()), 200);
  assertNoAccountIdentity(json);
  assert.deepEqual(database.polls[0].votes, [8, 4]);
  assert.equal(database.polls[0].participants, 12);
  assert.equal(JSON.stringify(database.poll_votes), votesBefore);
  assert.equal(database.polls[0].author_user_id, AUTH_USER_ID);
});

test("safe return path rejects external encoded/backslash/control and auth-loop targets", async () => {
  for (const value of [undefined, "https://evil.invalid", "//evil.invalid", "javascript:alert(1)", "/\\evil.invalid", "/%2fevil.invalid", "/%5cevil.invalid", "/%0aevil", "/api/polls", "/auth/login", "/vote/../auth/callback", "/%61uth/login", "/bad%escape", "/vote/p?x=%0d%0aLocation%3Aevil", "/vote/p#%00"]) {
    assert.equal(getSafeAuthReturnPath(value), "/");
  }
  assert.equal(getSafeAuthReturnPath("/create"), "/create");
  assert.equal(getSafeAuthReturnPath(`/vote/${POLL_ID}`), `/vote/${POLL_ID}`);
  for (const value of [`/vote/${POLL_ID}?comments=latest&from=home#opinions`, `/vote/${POLL_ID}?q=two%20words#my%20choice`, "/profile?tab=settings#nickname"]) {
    assert.equal(getSafeAuthReturnPath(value), value);
  }
});

test("PKCE callback success redirects safely without caching or exposing code", async () => {
  const response = await callback.GET(new Request("https://example.invalid/auth/callback?code=test-code&next=/create"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://example.invalid/create");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(exchangedCode, "test-code");
  const unsafe = await callback.GET(new Request("https://example.invalid/auth/callback?code=test-code&next=//evil.invalid"));
  assert.equal(unsafe.headers.get("location"), "https://example.invalid/");
  const pollPath = `/vote/${POLL_ID}?comments=latest&q=two%20words#opinions`;
  const pollReturn = await callback.GET(new Request(`https://example.invalid/auth/callback?code=test-code&next=${encodeURIComponent(pollPath)}`));
  assert.equal(pollReturn.headers.get("location"), `https://example.invalid${pollPath}`);
});

test("PKCE callback cancellation/missing code/failed exchange expose only generic state", async () => {
  callbackFailure = { message: RAW_ERROR };
  for (const query of ["code=test-code", "error=access_denied&error_description=" + RAW_ERROR, ""]) {
    const response = await callback.GET(new Request(`https://example.invalid/auth/callback?${query}`));
    const location = response.headers.get("location");
    assert.ok(location.startsWith("https://example.invalid/auth/login?"));
    assert.ok(!location.includes(RAW_ERROR));
    assert.ok(!location.includes("test-code"));
    assert.ok(location.endsWith("#"));
  }
});

test("display names sanitize controls, bound Unicode length and fall back safely", async () => {
  assert.equal(getAuthDisplayName({ user_metadata: { full_name: "  나\u202e\u0000  다  " } }), "나 다");
  assert.equal(Array.from(getAuthDisplayName({ user_metadata: { name: "😀".repeat(50) } })).length, 40);
  assert.equal(getAuthDisplayName({ user_metadata: {}, email: "member@example.invalid" }), "member");
  assert.equal(getAuthDisplayName({ user_metadata: {} }), "Askio 사용자");
});

const authProxy = loadModule("proxy.ts");
test("proxy skips anonymous Auth requests and preserves public availability without env", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    await authProxy.proxy({ cookies: cookieJar() });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
    await authProxy.proxy({ cookies: cookieJar() });
    assert.equal(refreshCalls, 0);
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});

test("proxy forwards refreshed cookie chunks to request and uncached response", async () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
    refreshCookies = true;
    const req = { cookies: cookieJar([{ name: "sb-test-auth-token", value: "test-old-cookie" }]) };
    const response = await authProxy.proxy(req);
    assert.equal(refreshCalls, 1);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    for (const name of ["sb-test-auth-token.0", "sb-test-auth-token.1"]) {
      assert.equal(response.cookies.getAll().find((cookie) => cookie.name === name)?.value,
        req.cookies.getAll().find((cookie) => cookie.name === name)?.value);
    }
    assert.equal(response.cookies.getAll().length, 2);
  } finally {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
  }
});

test('guest reaction toggles like/unlike/dislike/remove/switch without exposing actors', async () => {
  authUser = null;
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  let cookie;
  for (const [reaction, expected] of [['like','like'], ['like',null], ['dislike','dislike'], ['dislike',null], ['like','like'], ['dislike','dislike']]) {
    const response = await reactions.POST(request('POST', { reaction, userId: REPORTER_ID, guestId: VOTER_ID, userFingerprint: 'spoof' }, cookie ? { cookie } : {}), context(COMMENT_ID));
    if (!cookie) cookie = response.headers.get('set-cookie').split(';')[0];
    const json = await responseJson(response, 200);
    assert.equal(json.userReaction, expected);
    assert.equal(json.likeCount + json.dislikeCount, expected ? 1 : 0);
    assert.deepEqual(Object.keys(json).sort(), ['dislikeCount', 'likeCount', 'userReaction']);
    assert.ok(!JSON.stringify(json).includes(cookie.split('=')[1]));
  }
  assert.equal(database.comment_reactions.length, 1);
  assert.match(database.comment_reactions[0].user_fingerprint, /^guest:[0-9a-f]{64}$/);
  assert.ok(!database.comment_reactions[0].user_fingerprint.includes(cookie.split('=')[1]));
  const detailRequest = request('GET', undefined, { cookie, 'x-user-fp': 'spoof' });
  const json = await responseJson(await detail.GET(detailRequest, context()), 200);
  assert.equal(json.comments[0].user_reaction, 'dislike');
  assert.ok(!JSON.stringify(json).includes(database.comment_reactions[0].user_fingerprint));
});

test('different guests are independent; legacy and account reactions remain intact', async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  database.comment_reactions.push({ comment_id: COMMENT_ID, user_fingerprint: 'legacy-fingerprint', reaction: 'like' });
  await responseJson(await reactions.POST(request('POST', { reaction: 'like' }), context(COMMENT_ID)), 200);
  authUser = null;
  for (let i = 0; i < 2; i++) await responseJson(await reactions.POST(request('POST', { reaction: 'like' }), context(COMMENT_ID)), 200);
  assert.equal(database.comment_reactions.length, 4);
  assert.equal(database.comment_reactions[0].user_fingerprint, 'legacy-fingerprint');
  assert.equal(new Set(database.comment_reactions.map(row => row.user_fingerprint)).size, 4);
  authUser = { id: AUTH_USER_ID };
  const json = await responseJson(await detail.GET(request('GET', undefined, { 'x-user-fp': 'legacy-fingerprint' }), context()), 200);
  assert.equal(json.comments[0].like_count, 4);
  assert.equal(json.comments[0].user_reaction, 'like');
});

test('guest reaction fail-closed Auth/cross-origin/rate limits and safe DB errors', async () => {
  authUser = null;
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  await responseJson(await reactions.POST(request('POST', { reaction: 'like' }, { origin: 'https://other.invalid' }), context(COMMENT_ID)), 403);
  await responseJson(await reactions.POST(request('POST', { reaction: 'like' }, { cookie: 'sb-test-auth-token=invalid' }), context(COMMENT_ID)), 401);
  rpcFailure = { code: 'XX000', message: RAW_ERROR };
  assertNoSecrets(await responseJson(await reactions.POST(request('POST', { reaction: 'like' }), context(COMMENT_ID)), 500));
  rpcFailure = null;
  const policy = loadModule('lib/rate-limit.ts').RATE_LIMIT_POLICIES.commentReaction;
  for (let i = 0; i < policy.limit; i++) await responseJson(await reactions.POST(request('POST', { reaction: 'like' }, {}, '198.51.100.241'), context(COMMENT_ID)), 200);
  await responseJson(await reactions.POST(request('POST', { reaction: 'dislike' }, {}, '198.51.100.241'), context(COMMENT_ID)), 429);
});

test('guest missing identity secret disables reactions safely', async () => {
  authUser = null;
  delete process.env.GUEST_ID_SECRET;
  try { await responseJson(await reactions.POST(request('POST', { reaction: 'like' }), context(COMMENT_ID)), 503); }
  finally { process.env.GUEST_ID_SECRET = 'mock-only-guest-identity-key-not-a-credential'; }
});

test('sorting all four modes uses exact tie breakers and leaves reply order unchanged', async () => {
  const rows = [
    { id: 'b', parent_id: null, like_count: 3, dislike_count: 1, created_at: '2026-10-01' },
    { id: 'a', parent_id: null, like_count: 3, dislike_count: 1, created_at: '2026-10-01' },
    { id: 'c', parent_id: null, like_count: 3, dislike_count: 0, created_at: '2026-09-01' },
    { id: 'd', parent_id: null, like_count: 0, dislike_count: 5, created_at: '2026-10-02' },
    { id: 'r1', parent_id: 'b', created_at: '2026-10-01' },
    { id: 'r2', parent_id: 'b', created_at: '2026-10-02' },
    { id: 'r3', parent_id: 'c', is_hidden: true, created_at: '2026-10-02' },
  ];
  for (const [mode, expected] of [['likes',['c','a','b','d']],['dislikes',['d','a','b','c']],['replies',['b','a','c','d']],['latest',['d','a','b','c']]]) {
    const result = sorting.sortComments(rows, mode);
    assert.deepEqual(result.filter(row => !row.parent_id).map(row => row.id), expected);
    assert.deepEqual(result.filter(row => row.parent_id).map(row => row.id), ['r1','r2','r3']);
  }
  assert.equal(sorting.parseCommentSort('bad'), 'likes');
});

test('avatar upload/select require verified session and ignore arbitrary target/path', async () => {
  authUser = null;
  await responseJson(await avatars.POST(request('POST')), 401);
  await responseJson(await avatars.PATCH(request('PATCH', { source: 'default' })), 401);
  assert.equal(calls.length, 0);
  authUser = { id: AUTH_USER_ID };
  await responseJson(await avatars.PATCH(request('PATCH', { source: 'default', userId: REPORTER_ID })), 400);
  await responseJson(await avatars.PATCH(request('PATCH', { source: 'invalid' })), 400);
  const data = await responseJson(await avatars.PATCH(request('PATCH', { source: 'default' })), 200);
  assert.equal(data.data.avatar_url, null);
  assert.equal(data.data.social_avatar_url, PROFILE_AVATAR);
  assert.equal(calls.find(call => call.rpc === 'change_profile_avatar').payload.p_user_id, AUTH_USER_ID);
});

test('avatar validates real bytes, SVG/GIF/HTML rejection and 2MB boundary before Storage', async () => {
  const candidates = [
    new File(['<svg></svg>'], 'bad.svg', { type: 'image/svg+xml' }),
    new File(['<svg></svg>'], 'pretend.png', { type: 'image/png' }),
    new File(['GIF89a'], 'bad.gif', { type: 'image/gif' }),
    new File(['<html>'], 'bad.jpg', { type: 'image/jpeg' }),
    new File([Buffer.alloc(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
  ];
  for (const file of candidates) {
    const form = new FormData(); form.set('avatar', file);
    await responseJson(await avatars.POST(request('POST', form)), file.size > 2 * 1024 * 1024 ? 413 : 400);
  }
  assert.equal(calls.filter(call => call.storageUpload).length, 0);
});

test('avatar WebP square encoding strips EXIF and uses opaque paths with opt-in unchanged', async () => {
  const sharp = nativeRequire('sharp');
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: 'blue' } }).png().withMetadata().toBuffer();
  const form = new FormData(); form.set('avatar', new File([png], 'photo.png', { type: 'image/png' }));
  const json = await responseJson(await avatars.POST(request('POST', form)), 200);
  const uploaded = calls.find(call => call.storageUpload);
  const metadata = await sharp(uploaded.data).metadata();
  assert.equal(metadata.format, 'webp'); assert.equal(metadata.width, 512); assert.equal(metadata.height, 512);
  assert.equal(metadata.exif, undefined);
  assert.match(uploaded.storageUpload, /^avatars\/[0-9a-f-]{36}\.webp$/);
  assert.equal(uploaded.options.upsert, false);
  assert.equal(json.data.show_avatar, false);
  assert.ok(!json.data.avatar_url.includes(AUTH_USER_ID));
  const oldPath = uploaded.storageUpload;
  calls.length = 0;
  await responseJson(await avatars.POST(request('POST', form)), 200);
  assert.deepEqual(calls.find(call => call.storageRemove).storageRemove, [oldPath]);
  assert.ok(!calls.find(call => call.storageRemove).storageRemove.includes(PROFILE_AVATAR));
  assert.equal(json.data.social_avatar_url, PROFILE_AVATAR);
});

test('avatar replacement CAS conflict cleans only new orphan, preserving previous object', async () => {
  const png = await nativeRequire('sharp')({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
  const form = new FormData(); form.set('avatar', new File([png], 'photo.png', { type: 'image/png' }));
  // Model a conflict returned by the locked compare-and-swap after profile read.
  queryHook = query => { if (query.table === 'profiles' && query.fields === 'uploaded_avatar_path') rpcFailure = { code: 'P0001', message: 'AVATAR_CONFLICT' }; };
  await responseJson(await avatars.POST(request('POST', form)), 409);
  const upload = calls.find(call => call.storageUpload);
  assert.deepEqual(calls.find(call => call.storageRemove).storageRemove, [upload.storageUpload]);
  assert.equal(database.profiles[0].avatar_url, PROFILE_AVATAR);
});

test('uploaded avatars honor opt-in and remain hidden on anonymous comments', async () => {
  const uploadedUrl = 'https://storage.example.invalid/storage/v1/object/public/profile-avatars/avatars/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp';
  database.profiles[0].avatar_url = uploadedUrl;
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, text: '공개 의견', is_hidden: false, is_anonymous: false, user_id: AUTH_USER_ID, created_at: '2026-10-01' });
  let json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].avatar_url, null);
  database.profiles[0].show_avatar = true;
  json = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(json.comments[0].avatar_url, uploadedUrl);
  database.comments[0].is_anonymous = true;
  json = await responseJson(await detail.GET(request(), context()), 200);
  assert.ok(!JSON.stringify(json.comments).includes(uploadedUrl));
  assertNoAccountIdentity(json, { anonymous: true });
});

test('concurrent same guest toggles keep a single actor and nonnegative counts on replies', async () => {
  authUser = null;
  database.comments.push({ id: REPLY_ID, parent_id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  const cookie = `askio_guest_id=${VOTER_ID}`;
  const results = await Promise.all(Array.from({ length: 10 }, () => reactions.POST(request('POST', { reaction: 'like' }, { cookie }), context(REPLY_ID))));
  for (const response of results) {
    const json = await responseJson(response, 200);
    assert.ok(json.likeCount >= 0 && json.dislikeCount >= 0);
  }
  assert.equal(database.comment_reactions.length, 0);
  await responseJson(await reactions.POST(request('POST', { reaction: 'dislike' }, { cookie }), context(REPLY_ID)), 200);
  assert.equal(database.comment_reactions.length, 1);
});

test('avatar RPC failure preserves potentially committed object; storage failure remains generic', async () => {
  const png = await nativeRequire('sharp')({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
  const form = new FormData(); form.set('avatar', new File([png], 'photo.png', { type: 'image/png' }));
  queryHook = query => { if (query.table === 'profiles' && query.fields === 'uploaded_avatar_path') rpcFailure = { message: RAW_ERROR }; };
  assertNoSecrets(await responseJson(await avatars.POST(request('POST', form)), 500));
  assert.equal(calls.filter(call => call.storageRemove).length, 0);
  queryHook = null; rpcFailure = null; storageFailure = { message: RAW_ERROR };
  assertNoSecrets(await responseJson(await avatars.POST(request('POST', form)), 500));
});

test('API sort query and ID ties are deterministic while replies stay attached', async () => {
  database.comments.push(
    { id: COMMENT_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false, created_at: '2026-10-01', text: '이전' },
    { id: REPLY_ID, poll_id: POLL_ID, parent_id: null, is_hidden: false, created_at: '2026-10-02', text: '최신' },
  );
  const json = await responseJson(await detail.GET(new Request('https://example.invalid/api/test?comments=latest'), context()), 200);
  assert.deepEqual(json.comments.map(row => row.id), [REPLY_ID, COMMENT_ID]);
});

test('default image preserves prior opt-in and still permits nickname save', async () => {
  database.profiles[0].show_avatar = true;
  await responseJson(await avatars.PATCH(request('PATCH', { source: 'default' })), 200);
  const json = await responseJson(await profileRoute.PATCH(request('PATCH', { nickname: PROFILE_NICKNAME, showAvatar: true })), 200);
  assert.equal(json.data.show_avatar, true);
  assert.equal(json.data.avatar_url, null);
});

test('account voting ignores spoofed identity and uses verified user for all providers', async () => {
  for (const provider of ['google', 'kakao', 'email']) {
    reset();
    authUser.app_metadata = { provider };
    const json = await responseJson(await votes.POST(request('POST', { optionIndex: 0, user_id: OTHER_REPORTER_ID, voterId: VOTER_ID }), context()), 200);
    const call = calls.find(row => row.rpc === 'cast_authenticated_poll_vote');
    assert.equal(call.payload.p_user_id, AUTH_USER_ID);
    assert.equal(call.payload.p_voter_id, undefined);
    assertNoAccountIdentity(json);
    assert.ok(!JSON.stringify(json).includes(VOTER_ID));
    assert.deepEqual(database.polls[0].votes, [1, 0]);
  }
});

test('anonymous Auth sessions and failed verification cannot cast or change votes', async () => {
  for (const scenario of ['anonymous', 'error', 'throw']) {
    reset();
    if (scenario === 'anonymous') authUser.is_anonymous = true;
    if (scenario === 'error') authFailure = { message: RAW_ERROR };
    if (scenario === 'throw') authThrows = true;
    const expected = scenario === 'anonymous' ? 401 : 503;
    assertNoSecrets(await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), expected));
    await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }), context()), expected);
    assert.equal(calls.filter(row => row.rpc).length, 0);
  }
});

test('same account across simulated browser identities has one row and persistent viewer vote', async () => {
  const json = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 200);
  assert.equal(json.data.optionIndex, 0);
  const seen = await responseJson(await detail.GET(request('GET', undefined, { 'x-voter-id': OTHER_REPORTER_ID }), context()), 200);
  assertViewerVote(seen.viewerVote, { optionIndex: 0, canChangeVote: true, canCancelVote: true });
  await responseJson(await votes.POST(request('POST', { optionIndex: 1, voterId: OTHER_REPORTER_ID }), context()), 409);
  assert.equal(database.poll_votes.length, 1);
  assert.deepEqual(database.polls[0].votes, [1, 0]);
  assert.equal(database.polls[0].participants, 1);
  assertNoAccountIdentity(seen);
});

test('simultaneous API requests retain one vote in the mocked RPC contract', async () => {
  const responses = await Promise.all([0, 1].map(optionIndex => votes.POST(request('POST', { optionIndex }), context())));
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
  assert.equal(database.poll_votes.length, 1);
  assert.equal(database.polls[0].participants, 1);
  assert.equal(database.polls[0].votes.reduce((sum, value) => sum + value, 0), 1);
});

test('account change moves only its count and same option is a no-op', async () => {
  database.polls[0].votes = [8, 4];
  database.polls[0].participants = 12;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 200);
  const before = database.poll_votes[0].id;
  const changed = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }), context()), 200);
  assert.equal(changed.data.changed, true);
  assert.deepEqual(database.polls[0].votes, [8, 5]);
  assert.equal(database.polls[0].participants, 13);
  assert.equal(database.poll_votes[0].id, before);
  const repeated = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }), context()), 200);
  assert.equal(repeated.data.changed, false);
  assert.deepEqual(database.polls[0].votes, [8, 5]);
  assert.equal(database.poll_votes.length, 1);
});

test('legacy claim attaches the same ledger row without aggregate changes', async () => {
  database.polls[0].votes = [9, 4];
  database.polls[0].participants = 13;
  database.poll_votes.push({ id: 24, poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null, option_index: 0, created_at: '2026-09-01' });
  const json = await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context()), 200);
  assert.equal(json.data.optionIndex, 0);
  assert.equal(database.poll_votes[0].id, 24);
  assert.equal(database.poll_votes[0].user_id, AUTH_USER_ID);
  assert.equal(database.poll_votes[0].created_at, '2026-09-01');
  assert.deepEqual(database.polls[0].votes, [9, 4]);
  assert.equal(database.polls[0].participants, 13);
  assert.equal(database.poll_votes.length, 1);
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }), context()), 409);
  assertNoAccountIdentity(json);
});

test('legacy conflict prefers account vote, preserves both historical rows, and adds no third', async () => {
  database.polls[0].votes = [8, 4];
  database.polls[0].participants = 12;
  database.poll_votes.push(
    { id: 1, poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null, option_index: 0 },
    { id: 2, poll_id: POLL_ID, voter_id: OTHER_REPORTER_ID, user_id: AUTH_USER_ID, option_index: 1 },
  );
  const before = JSON.stringify(database.poll_votes);
  const claimed = await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context()), 200);
  assert.equal(claimed.data.optionIndex, 1);
  const seen = await responseJson(await detail.GET(request('GET', undefined, { 'x-voter-id': VOTER_ID }), context()), 200);
  assert.equal(seen.viewerVote.optionIndex, 1);
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 409);
  // Claim may bind the account's empty browser hash without touching its
  // option or either historical row's aggregate contribution.
  assert.equal(JSON.stringify(database.poll_votes.map(row => ({ ...row, guest_id_hash: undefined }))), before);
  assert.deepEqual(database.polls[0].votes, [8, 4]);
});

test('GET preserves only unclaimed legacy result and never mutates or leaks ledger identity', async () => {
  authUser = null;
  database.poll_votes.push({ poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null, option_index: 1 });
  const first = await responseJson(await detail.GET(request('GET', undefined, { 'x-voter-id': VOTER_ID }), context()), 200);
  assertViewerVote(first.viewerVote, { optionIndex: 1, canChangeVote: false, canCancelVote: false });
  assert.equal(calls.filter(row => row.rpc).length, 0);
  database.poll_votes[0].user_id = AUTH_USER_ID;
  const after = await responseJson(await detail.GET(request('GET', undefined, { 'x-voter-id': VOTER_ID }), context()), 200);
  assert.equal(after.viewerVote, null);
  assertNoAccountIdentity(first); assertNoAccountIdentity(after);
  assert.ok(!JSON.stringify(first).includes(VOTER_ID));
});

test('claim cannot steal another account row or attach nonexistent legacy vote', async () => {
  database.poll_votes.push({ poll_id: POLL_ID, voter_id: VOTER_ID, user_id: OTHER_REPORTER_ID, option_index: 0 });
  const before = JSON.stringify(database.poll_votes);
  const result = await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context()), 200);
  assert.equal(result.data, null);
  assert.equal(JSON.stringify(database.poll_votes), before);
  const noRow = await responseJson(await voteClaim.POST(request('POST', { voterId: REPORTER_ID }), context()), 200);
  assert.equal(noRow.data, null);
});

test('account mutations reject cross-site requests and invalid claims without RPC', async () => {
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { origin: 'https://evil.invalid' }), context()), 403);
  await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 0 }, { 'sec-fetch-site': 'cross-site' }), context()), 403);
  await responseJson(await voteClaim.POST(request('POST', { voterId: 'not-a-uuid' }), context()), 400);
  assert.equal(calls.filter(row => row.rpc).length, 0);
});

test('missing account migration and raw vote/claim errors remain safe', async () => {
  database.poll_votes.push({ poll_id: POLL_ID, user_id: AUTH_USER_ID, option_index: 0 });
  database.polls[0].votes = [1, 0]; database.polls[0].participants = 1;
  rpcFailure = { code: 'PGRST202', message: `cast_authenticated_poll_vote ${RAW_ERROR}` };
  const missing = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 503);
  assert.equal(missing.code, 'DUAL_VOTING_MIGRATION_REQUIRED');
  assertNoSecrets(missing);
  rpcFailure = { code: 'PGRST202', message: `claim_authenticated_poll_vote ${RAW_ERROR}` };
  assertNoSecrets(await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context()), 503));
  rpcFailure = { code: 'XX000', message: RAW_ERROR };
  assertNoSecrets(await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 500));
  assertNoSecrets(await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 0 }), context()), 500));
  assertNoSecrets(await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context()), 500));
});

test('account API responses are private and noncacheable', async () => {
  const created = await votes.POST(request('POST', { optionIndex: 0 }), context());
  const viewed = await detail.GET(request(), context());
  for (const response of [created, viewed]) assert.match(response.headers.get('cache-control'), /private.*no-store/);
});

function responseGuestCookie(response) {
  const cookie = response.headers.get('set-cookie') ?? '';
  const match = cookie.match(/askio_guest_id=([^;]+)/);
  assert.ok(match, 'Response did not establish a guest cookie.');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Secure/i);
  return `askio_guest_id=${match[1]}`;
}

test('detail establishes a cookie before guest voting; refresh preserves only safe viewer state', async () => {
  authUser = null;
  const first = await detail.GET(request(), context());
  const cookie = responseGuestCookie(first);
  assert.equal((await responseJson(first, 200)).viewerVote, null);
  assert.equal(calls.filter(row => row.rpc).length, 0);
  const vote = await responseJson(await votes.POST(request('POST', {
    optionIndex: 1, guest_id_hash: 'a'.repeat(64), guestId: REPORTER_ID, user_id: AUTH_USER_ID, voterId: VOTER_ID,
  }, { cookie }), context()), 200);
  const row = database.poll_votes[0];
  const commentIdentity = getGuestCommentIdentity(request('GET', undefined, { cookie }));
  assert.match(row.guest_id_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.guest_id_hash, commentIdentity.hash);
  assert.notEqual(row.guest_id_hash, 'a'.repeat(64));
  assert.equal(row.user_id, null);
  assert.notEqual(row.voter_id, VOTER_ID);
  const refreshed = await detail.GET(request('GET', undefined, { cookie }), context());
  const json = await responseJson(refreshed, 200);
  assertViewerVote(json.viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  for (const result of [json, vote]) {
    assertNoAccountIdentity(result);
    assert.ok(!JSON.stringify(result).includes(row.guest_id_hash));
    assert.ok(!JSON.stringify(result).includes(row.voter_id));
    assert.ok(!JSON.stringify(result).includes(cookie.split('=')[1]));
  }
  assert.match(refreshed.headers.get('cache-control'), /private.*no-store/);
});

test('same guest duplicates and simultaneous RPC contracts add exactly one ballot', async () => {
  authUser = null;
  const responses = await Promise.all([0, 1].map(optionIndex => votes.POST(request('POST', { optionIndex }, { cookie: GUEST_COOKIE }), context())));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const before = JSON.stringify(database.polls[0]);
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 409);
  assert.equal(database.poll_votes.length, 1);
  assert.equal(database.polls[0].participants, 1);
  assert.equal(database.polls[0].votes.reduce((sum, value) => sum + value, 0), 1);
  assert.equal(JSON.stringify(database.polls[0]), before);
});

test('guest change preserves ledger identity and participant count, including same-option no-op', async () => {
  authUser = null;
  database.polls[0].votes = [20, 30];
  database.polls[0].participants = 50;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  const rowId = database.poll_votes[0].id;
  const changed = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(changed.data.changed, true);
  assert.deepEqual(database.polls[0].votes, [20, 31]);
  assert.equal(database.polls[0].participants, 51);
  assert.equal(database.poll_votes[0].id, rowId);
  const noop = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(noop.data.changed, false);
  assert.deepEqual(database.polls[0].votes, [20, 31]);
});

test('case A: guest-to-Google claim preserves one ballot and restores changeable account results', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  const hash = database.poll_votes[0].guest_id_hash;
  const id = database.poll_votes[0].id;
  const aggregate = JSON.stringify({ votes: database.polls[0].votes, participants: database.polls[0].participants });
  authUser = { id: AUTH_USER_ID, is_anonymous: false, app_metadata: { provider: 'google' } };
  const beforeClaim = JSON.stringify(database.poll_votes);
  const viewed = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(viewed.viewerVote, { optionIndex: 0, canChangeVote: true, canCancelVote: true });
  assert.equal(JSON.stringify(database.poll_votes), beforeClaim);
  assert.equal(calls.filter(row => row.rpc?.startsWith('claim_')).length, 0);
  // Even before reconciliation, the fresh account cast must not add a row.
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 409);
  const claim = await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(claim.data.optionIndex, 0);
  assert.equal(claim.data.canChangeVote, true);
  assert.equal(database.poll_votes[0].user_id, AUTH_USER_ID);
  assert.equal(database.poll_votes[0].guest_id_hash, hash);
  assert.equal(database.poll_votes[0].id, id);
  assert.equal(database.poll_votes.length, 1);
  assert.equal(JSON.stringify({ votes: database.polls[0].votes, participants: database.polls[0].participants }), aggregate);
  assertViewerVote((await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200)).viewerVote,
    { optionIndex: 0, canChangeVote: true, canCancelVote: true });
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 409);
  assertNoAccountIdentity(claim);
  assert.ok(!JSON.stringify(claim).includes(hash));
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 409);
  await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote((await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200)).viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  assert.equal(database.poll_votes[0].user_id, AUTH_USER_ID);
  assert.equal(database.poll_votes[0].guest_id_hash, hash);
  assert.equal(database.poll_votes[0].id, id);
  assert.deepEqual(database.polls[0].votes, [0, 1]);
  assert.equal(database.polls[0].participants, 1);
});

test('guest/account conflict prefers account without third vote or aggregate correction', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  authUser = { id: AUTH_USER_ID, is_anonymous: false };
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: `askio_guest_id=${VOTER_ID}` }), context()), 200);
  const before = JSON.stringify(database.polls[0]);
  const ledger = JSON.stringify(database.poll_votes);
  const claim = await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(claim.data.optionIndex, 1);
  const viewed = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(viewed.viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 409);
  assert.equal(database.poll_votes.length, 2);
  assert.equal(JSON.stringify(database.polls[0]), before);
  assert.equal(JSON.stringify(database.poll_votes), ledger);
});

test('legacy-to-guest claim preserves original row and aggregates without exposing voter ID', async () => {
  authUser = null;
  database.polls[0].votes = [10, 8]; database.polls[0].participants = 18;
  database.poll_votes.push({ id: 71, poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null,
    guest_id_hash: null, option_index: 1, created_at: '2026-09-01' });
  const response = await voteClaim.POST(request('POST', { voterId: VOTER_ID }), context());
  const cookie = responseGuestCookie(response);
  const json = await responseJson(response, 200);
  assert.equal(json.data.optionIndex, 1);
  assert.equal(database.poll_votes[0].id, 71);
  assert.equal(database.poll_votes[0].created_at, '2026-09-01');
  assert.equal(database.poll_votes[0].user_id, null);
  assert.match(database.poll_votes[0].guest_id_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(database.polls[0].votes, [10, 8]);
  assert.equal(database.polls[0].participants, 18);
  assert.equal(database.poll_votes.length, 1);
  assertViewerVote((await responseJson(await detail.GET(request('GET', undefined, { cookie }), context()), 200)).viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  assert.ok(!JSON.stringify(json).includes(VOTER_ID));
});

test('guest missing secret/schema never falls back to unsafe legacy mutations', async () => {
  authUser = null;
  delete process.env.GUEST_ID_SECRET;
  try {
    assertNoSecrets(await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 503));
    assertNoSecrets(await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 1 }), context()), 503));
    await responseJson(await detail.GET(request(), context()), 200);
    assert.equal(calls.filter(row => row.rpc).length, 0);
  } finally { process.env.GUEST_ID_SECRET = 'mock-only-guest-identity-key-not-a-credential'; }
  rpcFailure = { code: 'PGRST202', message: `cast_guest_poll_vote ${RAW_ERROR}` };
  const missing = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 503);
  assert.equal(missing.code, 'DUAL_VOTING_MIGRATION_REQUIRED'); assertNoSecrets(missing);
  assert.equal(calls.filter(row => row.rpc === 'increment_poll_vote').length, 0);
});

test('missing session allows guest; supplied invalid Auth or Auth outage never downgrades to guest', async () => {
  authUser = null;
  authFailure = { name: 'AuthSessionMissingError', status: 400 };
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  reset(); authUser = null;
  authFailure = { name: 'AuthSessionMissingError', status: 400 };
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: 'sb-test-auth-token=invalid' }), context()), 401);
  assert.equal(calls.filter(row => row.rpc).length, 0);
  authFailure = { name: 'AuthRetryableFetchError', status: 503 };
  assertNoSecrets(await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 503));
  authThrows = true;
  await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 503);
  assert.equal(calls.filter(row => row.rpc).length, 0);
});

test('guest cross-site and IP mutation rate limits stay enforced independently of cookie rotation', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE, origin: 'https://evil.invalid' }), context()), 403);
  await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE, 'sec-fetch-site': 'cross-site' }), context()), 403);
  assert.equal(calls.filter(row => row.rpc).length, 0);
  for (let index = 0; index < 20; index += 1) {
    await responseJson(await votes.POST(request('POST', { optionIndex: 'invalid' }, {}, '198.51.100.214'), context()), 400);
  }
  const limited = await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }, '198.51.100.214'), context());
  await responseJson(limited, 429);
  assert.match(limited.headers.get('cache-control'), /private.*no-store/);
  assert.equal(calls.filter(row => row.rpc).length, 0);
});

test('public question remains readable during Auth failure without fallback viewer or guest identity', async () => {
  database.poll_votes.push({ poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null, guest_id_hash: null, option_index: 1 });
  for (const scenario of ['expired', 'outage', 'throws']) {
    authFailure = scenario === 'expired' ? { name: 'AuthApiError', status: 401 }
      : scenario === 'outage' ? { name: 'AuthRetryableFetchError', status: 503 } : null;
    authThrows = scenario === 'throws';
    const response = await detail.GET(request('GET', undefined, { 'x-voter-id': VOTER_ID }), context());
    const json = await responseJson(response, 200);
    assert.ok(json.poll); assert.equal(json.viewerVote, null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(calls.filter(row => row.rpc).length, 0);
    assertNoAccountIdentity(json);
  }
});

test('case B: guest to Google to logout to Kakao manages the same row without transferring ownership', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  authUser = { id: AUTH_USER_ID, is_anonymous: false, app_metadata: { provider: 'google' } };
  await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  const ledger = JSON.stringify(database.poll_votes);
  authUser = null;
  const loggedOut = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(loggedOut.viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  authUser = { id: REPORTER_ID, is_anonymous: false, app_metadata: { provider: 'kakao' } };
  const json = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(json.viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  const claim = await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(claim.data.optionIndex, 1);
  assert.equal(claim.data.canChangeVote, true);
  assert.equal(claim.data.canCancelVote, true);
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 409);
  const changed = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(database.poll_votes.length, 1);
  assert.deepEqual(database.polls[0].votes, [1, 0]);
  assert.equal(database.polls[0].participants, 1);
  assert.equal(JSON.stringify(database.poll_votes.map(row => ({ ...row, option_index: 1 }))), ledger);
  for (const result of [loggedOut, json, claim, changed]) {
    assertNoAccountIdentity(result);
    assert.ok(!JSON.stringify(result).includes(REPORTER_ID));
    assert.ok(!JSON.stringify(result).includes(database.poll_votes[0].guest_id_hash));
    assert.ok(!JSON.stringify(result).includes(database.poll_votes[0].voter_id));
  }
});

test('case C: Kakao account ballot takes priority over another account browser ballot and can change only its own row', async () => {
  authUser = { id: AUTH_USER_ID, is_anonymous: false, app_metadata: { provider: 'google' } };
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  const googleRow = JSON.stringify(database.poll_votes[0]);
  authUser = { id: REPORTER_ID, is_anonymous: false, app_metadata: { provider: 'kakao' } };
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: `askio_guest_id=${VOTER_ID}` }), context()), 200);
  const before = JSON.stringify(database.poll_votes);
  const aggregate = JSON.stringify(database.polls[0]);
  const viewed = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(viewed.viewerVote, { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  const claimed = await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(claimed.data.optionIndex, 1);
  assert.equal(claimed.data.canChangeVote, true);
  assert.equal(JSON.stringify(database.poll_votes), before);
  assert.equal(JSON.stringify(database.polls[0]), aggregate);
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 409);
  const changed = await responseJson(await votes.PATCH(request('PATCH', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(changed.data.canChangeVote, true);
  assert.equal(JSON.stringify(database.poll_votes[0]), googleRow);
  assert.equal(database.poll_votes.length, 2);
  assert.equal(database.polls[0].participants, 2);
  assert.deepEqual(database.polls[0].votes, [2, 0]);
  assertNoAccountIdentity(viewed); assertNoAccountIdentity(claimed); assertNoAccountIdentity(changed);
});

test('older deployed claim conflict resolves browser management without masking other permission errors', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
  database.poll_votes[0].user_id = AUTH_USER_ID;
  authUser = { id: REPORTER_ID, is_anonymous: false };
  const before = JSON.stringify(database);
  rpcFailure = { code: '42501', message: 'VOTE_REQUIRES_ACCOUNT' };
  const resolved = await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(resolved.data.optionIndex, 1);
  assert.equal(resolved.data.canChangeVote, true);
  assert.equal(resolved.data.canCancelVote, true);
  assert.equal(JSON.stringify(database), before);
  assertNoAccountIdentity(resolved);
  rpcFailure = { code: '42501', message: RAW_ERROR };
  assertNoSecrets(await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 500));
  assert.equal(JSON.stringify(database), before);
});

test('provider order: guest to Kakao then Google changes one existing ballot without ownership transfer', async () => {
  authUser = null;
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  authUser = { id: REPORTER_ID, is_anonymous: false, app_metadata: { provider: 'kakao' } };
  await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
  const original = { ...database.poll_votes[0] };
  const kakao = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: kakao.viewerVote.managementToken }, { cookie: GUEST_COOKIE }), context()), 200);
  authUser = null;
  assertViewerVote((await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200)).viewerVote,
    { optionIndex: 1, canChangeVote: true, canCancelVote: true });
  authUser = { id: AUTH_USER_ID, is_anonymous: false, app_metadata: { provider: 'google' } };
  const google = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  const changed = await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 0, managementToken: google.viewerVote.managementToken }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.equal(database.poll_votes.length, 1);
  assert.deepEqual({ ...database.poll_votes[0], option_index: original.option_index }, original);
  assert.deepEqual(database.polls[0].votes, [1, 0]); assert.equal(database.polls[0].participants, 1);
  assertNoAccountIdentity(changed);
});

test('guest/account/browser-linked cancellation atomically removes one contribution and permits a fresh vote', async () => {
  for (const kind of ['guest', 'account', 'browser-linked-other-account']) {
    reset();
    authUser = kind === 'account' ? { id: AUTH_USER_ID, is_anonymous: false } : null;
    database.polls[0].votes = [20, 30]; database.polls[0].participants = 50;
    const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
    const oldId = database.poll_votes[0].id;
    let token = created.data.managementToken;
    if (kind === 'browser-linked-other-account') {
      authUser = { id: AUTH_USER_ID, is_anonymous: false };
      await responseJson(await voteClaim.POST(request('POST', {}, { cookie: GUEST_COOKIE }), context()), 200);
      authUser = { id: REPORTER_ID, is_anonymous: false };
      token = (await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200)).viewerVote.managementToken;
    }
    const response = await voteRoutes.DELETE(request('DELETE', { managementToken: token,
      userId: OTHER_REPORTER_ID, guestHash: 'f'.repeat(64), voterId: VOTER_ID, ownerType: 'account' }, { cookie: GUEST_COOKIE }), context());
    const cancelled = await responseJson(response, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(cancelled.data.viewerVote, null);
    assert.deepEqual(cancelled.data.votes, [20, 30]); assert.equal(cancelled.data.participants, 50);
    assert.equal(database.poll_votes.length, 0);
    assertNoAccountIdentity(cancelled); assertNoSecrets(cancelled);
    const call = calls.find(row => row.rpc === 'cancel_managed_poll_vote');
    assert.equal(String(call.payload.p_expected_vote_id), String(oldId));
    assert.notEqual(call.payload.p_user_id, OTHER_REPORTER_ID);
    assert.notEqual(call.payload.p_guest_id_hash, 'f'.repeat(64));
    if (kind === 'browser-linked-other-account') {
      authUser = { id: AUTH_USER_ID, is_anonymous: false };
      const formerOwner = await responseJson(await detail.GET(request('GET', undefined, { cookie: `askio_guest_id=${VOTER_ID}` }), context()), 200);
      assert.equal(formerOwner.viewerVote, null);
      authUser = { id: REPORTER_ID, is_anonymous: false };
    }
    const fresh = await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context()), 200);
    assert.equal(database.poll_votes.length, 1); assert.notEqual(database.poll_votes[0].id, oldId);
    assert.deepEqual(fresh.data.votes, [20, 31]); assert.equal(fresh.data.participants, 51);
    const before = JSON.stringify(database);
    const stale = await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: token }, { cookie: GUEST_COOKIE }), context()), 409);
    assert.equal(stale.code, 'VOTE_MANAGEMENT_CONFLICT'); assert.equal(JSON.stringify(database), before);
  }
});

test('account conflict cancellation never deletes the untouched browser ballot, including concurrent retries', async () => {
  authUser = { id: AUTH_USER_ID, is_anonymous: false };
  await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  const untouched = JSON.stringify(database.poll_votes[0]);
  authUser = { id: REPORTER_ID, is_anonymous: false };
  await responseJson(await votes.POST(request('POST', { optionIndex: 1 }, { cookie: `askio_guest_id=${VOTER_ID}` }), context()), 200);
  const current = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  const token = current.viewerVote.managementToken;
  const responses = await Promise.all([0, 1].map(() => voteRoutes.DELETE(request('DELETE', { managementToken: token }, { cookie: GUEST_COOKIE }), context())));
  assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
  assert.equal(database.poll_votes.length, 1); assert.equal(JSON.stringify(database.poll_votes[0]), untouched);
  assert.deepEqual(database.polls[0].votes, [1, 0]); assert.equal(database.polls[0].participants, 1);
  const success = await responses.find(row => row.status === 200).json();
  assertViewerVote(success.data.viewerVote, { optionIndex: 0, canChangeVote: true, canCancelVote: true });
  assert.notEqual(success.data.viewerVote.managementToken, token);
  const before = JSON.stringify(database);
  await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: token }, { cookie: GUEST_COOKIE }), context()), 409);
  await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: token }, { cookie: GUEST_COOKIE }), context()), 409);
  assert.equal(JSON.stringify(database), before);
  assertNoAccountIdentity(success); assertNoSecrets(success);
});

test('same intent double-cancel and cancel/change contracts never produce negative or duplicate counts', async () => {
  for (const concurrent of ['cancel-cancel', 'cancel-change', 'change-cancel']) {
    reset(); authUser = null;
    const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
    const token = created.data.managementToken;
    const cancel = () => voteRoutes.DELETE(request('DELETE', { managementToken: token }, { cookie: GUEST_COOKIE }), context());
    const change = () => voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: token }, { cookie: GUEST_COOKIE }), context());
    const actions = concurrent === 'cancel-cancel' ? [cancel, cancel] : concurrent === 'cancel-change' ? [cancel, change] : [change, cancel];
    const responses = await Promise.all(actions.map(action => action()));
    assert.ok(responses.every(row => [200, 409].includes(row.status)));
    if (concurrent === 'cancel-cancel') assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal(database.poll_votes.length, 0); assert.equal(database.polls[0].participants, 0);
    assert.deepEqual(database.polls[0].votes, [0, 0]);
  }
});

test('missing/tampered/cross-actor management tokens fail closed before managed RPC invocation', async () => {
  authUser = null;
  const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  const token = created.data.managementToken;
  const before = JSON.stringify(database);
  for (const invalid of [undefined, '', 'not-a-token', '0'.repeat(64), `${token.slice(0, 63)}${token[63] === 'f' ? 'e' : 'f'}`]) {
    const patch = await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: invalid }, { cookie: GUEST_COOKIE }), context()), 409);
    const cancel = await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: invalid }, { cookie: GUEST_COOKIE }), context()), 409);
    assert.equal(patch.code, 'VOTE_MANAGEMENT_CONFLICT'); assert.equal(cancel.code, 'VOTE_MANAGEMENT_CONFLICT');
    assertNoSecrets(patch); assertNoSecrets(cancel);
  }
  authUser = { id: AUTH_USER_ID, is_anonymous: false };
  await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: token }, { cookie: GUEST_COOKIE }), context()), 409);
  assert.equal(calls.filter(row => ['cancel_managed_poll_vote', 'change_managed_poll_vote'].includes(row.rpc)).length, 0);
  assert.equal(JSON.stringify(database), before);
});

test('legacy header-only result cannot cancel or gain invented browser management before safe claim', async () => {
  authUser = null;
  database.poll_votes.push({ poll_id: POLL_ID, voter_id: VOTER_ID, user_id: null, guest_id_hash: null, option_index: 0 });
  database.polls[0].votes = [1, 0]; database.polls[0].participants = 1;
  const seen = await responseJson(await detail.GET(request('GET', undefined, { 'x-voter-id': VOTER_ID, cookie: GUEST_COOKIE }), context()), 200);
  assertViewerVote(seen.viewerVote, { optionIndex: 0, canChangeVote: false, canCancelVote: false });
  const before = JSON.stringify(database);
  await responseJson(await voteRoutes.DELETE(request('DELETE', { voterId: VOTER_ID, managementToken: '0'.repeat(64) }, { cookie: GUEST_COOKIE }), context()), 409);
  assert.equal(JSON.stringify(database), before);
  const claimed = await responseJson(await voteClaim.POST(request('POST', { voterId: VOTER_ID }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.match(claimed.data.managementToken, /^[0-9a-f]{64}$/);
  await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: claimed.data.managementToken }, { cookie: GUEST_COOKIE }), context()), 200);
  assert.deepEqual(database.polls[0].votes, [0, 0]); assert.equal(database.poll_votes.length, 0);
});

test('cancellation counter safety rejects inconsistent historical state without any mutation', async () => {
  for (const invalid of ['zero-option', 'zero-participants', 'negative', 'out-of-range', 'length', 'fraction']) {
    reset(); authUser = null;
    const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
    if (invalid === 'zero-option') database.polls[0].votes = [0, 0];
    if (invalid === 'zero-participants') database.polls[0].participants = 0;
    if (invalid === 'negative') database.polls[0].votes = [-1, 0];
    if (invalid === 'out-of-range') database.poll_votes[0].option_index = 8;
    if (invalid === 'length') database.polls[0].votes = [1];
    if (invalid === 'fraction') database.polls[0].participants = 0.5;
    const before = JSON.stringify(database);
    assertNoSecrets(await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: created.data.managementToken }, { cookie: GUEST_COOKIE }), context()), 409));
    assert.equal(JSON.stringify(database), before);
  }
});

test('managed RPC failures and hidden races remain generic and never reveal identity or backend error', async () => {
  authUser = null;
  const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  for (const [error, status] of [
    [{ code: 'PGRST202', message: `cancel_managed_poll_vote ${RAW_ERROR}` }, 503],
    [{ code: 'P0002', message: 'CONTENT_NOT_AVAILABLE', details: RAW_ERROR }, 404],
    [{ code: 'P0002', message: 'VOTE_NOT_FOUND', details: RAW_ERROR }, 409],
    [{ code: 'P0001', message: 'VOTE_MANAGEMENT_CONFLICT', details: RAW_ERROR }, 409],
    [{ code: 'P0001', message: 'INVALID_POLL_VOTE_DATA', details: RAW_ERROR }, 409],
    [{ code: '42501', message: RAW_ERROR, details: PRIVATE_TEXT }, 500],
  ]) {
    rpcFailure = error;
    const before = JSON.stringify(database);
    const json = await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: created.data.managementToken }, { cookie: GUEST_COOKIE }), context()), status);
    assertNoSecrets(json); assertNoAccountIdentity(json); assert.equal(JSON.stringify(database), before);
  }
  rpcFailure = { code: 'PGRST202', message: `change_managed_poll_vote ${RAW_ERROR}` };
  assertNoSecrets(await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: created.data.managementToken }, { cookie: GUEST_COOKIE }), context()), 503));
  rpcFailure = { code: 'P0001', message: 'INVALID_POLL_VOTE_DATA' };
  await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: created.data.managementToken }, { cookie: GUEST_COOKIE }), context()), 409);
});

test('cancel rejects cross-origin, failed Auth and rate limits without downgrading to guest or writing', async () => {
  for (const invalid of ['origin', 'cross-site', 'expired', 'outage', 'anonymous']) {
    reset();
    const headers = { cookie: `sb-test-auth-token=mock-session; ${GUEST_COOKIE}` };
    let status = 403;
    if (invalid === 'origin') headers.origin = 'https://evil.invalid';
    if (invalid === 'cross-site') headers['sec-fetch-site'] = 'cross-site';
    if (invalid === 'expired') { authFailure = { name: 'AuthApiError', status: 401 }; status = 401; }
    if (invalid === 'outage') { authFailure = { name: 'AuthRetryableFetchError', status: 503 }; status = 503; }
    if (invalid === 'anonymous') { authUser.is_anonymous = true; status = 401; }
    assertNoSecrets(await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: '0'.repeat(64) }, headers), context()), status));
    assert.equal(calls.filter(row => row.rpc).length, 0);
  }
  reset(); authUser = null;
  const ip = '198.51.100.234';
  for (let index = 0; index < 20; index++) {
    await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: '0'.repeat(64) }, { cookie: GUEST_COOKIE }, ip), context()), 409);
  }
  const limited = await voteRoutes.DELETE(request('DELETE', { managementToken: '0'.repeat(64) }, { cookie: GUEST_COOKIE }, ip), context());
  await responseJson(limited, 429); assert.equal(limited.headers.get('cache-control'), 'private, no-store');
  assert.equal(calls.filter(row => row.rpc).length, 0);
});

test('account management remains available with service-key signing when guest HMAC configuration is absent', async () => {
  const secret = process.env.GUEST_ID_SECRET;
  try {
    delete process.env.GUEST_ID_SECRET;
    const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }), context()), 200);
    assert.match(created.data.managementToken, /^[0-9a-f]{64}$/);
    const changed = await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: created.data.managementToken }), context()), 200);
    const cancelled = await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: changed.data.managementToken }), context()), 200);
    assert.equal(cancelled.data.viewerVote, null); assert.deepEqual(database.polls[0].votes, [0, 0]);
    assert.equal(calls.filter(row => row.rpc === 'cancel_managed_poll_vote').at(-1).payload.p_guest_id_hash, null);
    assertNoAccountIdentity(cancelled);
  } finally { process.env.GUEST_ID_SECRET = secret; }
});

test('management proof pins poll and exact bigint ledger ID and rejects unsafe numeric rounding', async () => {
  authUser = null;
  const created = await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200);
  database.polls.push({ ...database.polls[0], id: 'custom_second-poll', votes: [1, 0] });
  database.poll_votes.push({ ...database.poll_votes[0], id: 5_000, poll_id: 'custom_second-poll' });
  const before = JSON.stringify(database);
  await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: created.data.managementToken }, { cookie: GUEST_COOKIE }), context('custom_second-poll')), 409);
  assert.equal(JSON.stringify(database), before);
  database.poll_votes[0].id = '9223372036854775807';
  const read = await responseJson(await detail.GET(request('GET', undefined, { cookie: GUEST_COOKIE }), context()), 200);
  await responseJson(await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: read.viewerVote.managementToken,
    expectedVoteId: '5000', voteId: '5000', p_expected_vote_id: '5000' }, { cookie: GUEST_COOKIE }), context()), 200);
  const rpc = calls.filter(row => row.rpc === 'change_managed_poll_vote').at(-1);
  assert.equal(rpc.payload.p_expected_vote_id, '9223372036854775807');
  database.poll_votes[0].id = Number.MAX_SAFE_INTEGER + 1;
  const unsafeBefore = JSON.stringify(database);
  assertNoSecrets(await responseJson(await voteRoutes.DELETE(request('DELETE', { managementToken: read.viewerVote.managementToken }, { cookie: GUEST_COOKIE }), context()), 500));
  assert.equal(JSON.stringify(database), unsafeBefore);
});

test('successful cast/change followed by another-tab cancellation returns explicit null viewer rather than fabricated state', async () => {
  for (const action of ['cast', 'change']) {
    reset(); authUser = null;
    let token;
    if (action === 'change') {
      token = (await responseJson(await votes.POST(request('POST', { optionIndex: 0 }, { cookie: GUEST_COOKIE }), context()), 200)).data.managementToken;
    }
    let cancelled = false;
    queryHook = query => {
      const rpc = calls.filter(call => call.rpc).at(-1)?.rpc;
      if (!cancelled && query.table === 'poll_votes'
        && rpc === (action === 'cast' ? 'cast_guest_poll_vote' : 'change_managed_poll_vote')) {
        cancelled = true;
        database.poll_votes.splice(0);
        database.polls[0].votes = [0, 0]; database.polls[0].participants = 0;
      }
    };
    const response = action === 'cast'
      ? await votes.POST(request('POST', { optionIndex: 1 }, { cookie: GUEST_COOKIE }), context())
      : await voteRoutes.PATCH(request('PATCH', { optionIndex: 1, managementToken: token }, { cookie: GUEST_COOKIE }), context());
    const json = await responseJson(response, 200);
    assert.equal(cancelled, true);
    assert.equal(json.data.viewerVote, null);
    assert.equal(json.data.optionIndex, undefined);
    assert.equal(json.data.managementToken, undefined);
    // The mutation succeeded, but its aggregate snapshot is no longer the
    // current viewer state. UI must refresh rather than invent a new result.
    assert.deepEqual(json.data.votes, [0, 1]); assert.equal(json.data.participants, 1);
    assert.deepEqual(database.polls[0].votes, [0, 0]); assert.equal(database.poll_votes.length, 0);
    assertNoAccountIdentity(json); assertNoSecrets(json);
  }
});

let failed = 0;
try {
  for (const { name, run } of tests) {
    reset();
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }
} finally {
  console.error = originalConsoleError;
  if (originalAdminKey === undefined) delete process.env.ADMIN_DASHBOARD_KEY;
  else process.env.ADMIN_DASHBOARD_KEY = originalAdminKey;
  if (originalGuestSecret === undefined) delete process.env.GUEST_ID_SECRET;
  else process.env.GUEST_ID_SECRET = originalGuestSecret;
  if (originalServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
}
console.log(`${tests.length - failed}/${tests.length} mocked API regression checks passed. No live DB mutations were performed.`);
if (failed) process.exitCode = 1;
