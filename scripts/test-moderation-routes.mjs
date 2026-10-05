// API regression checks against mocked Supabase contracts. This script never
// loads environment files, opens a network connection, or writes service data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const originalAdminKey = process.env.ADMIN_DASHBOARD_KEY;
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
  database = {
    polls: [{
      id: POLL_ID, title: "모의 질문", category: "커뮤니티", options: ["선택 1", "선택 2"],
      votes: [0, 0], participants: 0, official_fact: null, option_image_paths: null,
      created_at: new Date().toISOString(), edit_lock_mode: "first_vote", is_hidden: false,
    }],
    comments: [], poll_votes: [], comment_reactions: [], deleted_official_polls: [],
    profiles: [{ id: AUTH_USER_ID, nickname: PROFILE_NICKNAME, avatar_url: PROFILE_AVATAR,
      onboarding_completed: false, created_at: "2026-10-01", updated_at: "2026-10-01" }],
    poll_ownership: [{ poll_id: POLL_ID, owner_token_hash: createHash("sha256").update(OWNER_TOKEN).digest("hex") }],
    reports: new Set(),
  };
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
              Array.isArray(value) ? value.includes(row[field]) : row[field] === value));
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
      if (name === "ensure_user_profile" || name === "recommend_user_profile_nickname") {
        assert.equal(role, "service");
        let profile = database.profiles.find((row) => row.id === payload.p_user_id);
        if (!profile) {
          profile = { id: payload.p_user_id, nickname: "파란여우1937", avatar_url: null, onboarding_completed: false };
          database.profiles.push(profile);
        }
        if (name === "recommend_user_profile_nickname") profile.nickname = "졸린수달6142";
        return { data: { nickname: profile.nickname, avatar_url: profile.avatar_url,
          onboarding_completed: profile.onboarding_completed }, error: null };
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
      if (name === "submit_content_report") {
        const key = `${payload.p_target_type}:${payload.p_target_id}:${payload.p_reporter_hash}`;
        const duplicate = database.reports.has(key);
        database.reports.add(key);
        return { data: { duplicate }, error: null };
      }
      if (name === "set_comment_reaction") {
        return { data: { likeCount: 1, dislikeCount: 0, userReaction: payload.p_reaction }, error: null };
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
  "next/server": { NextResponse: class extends Response {
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
  const requestHeaders = { "x-forwarded-for": ip ?? `203.0.113.${clientNumber++}`, ...headers };
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

const tests = [];
function test(name, run) { tests.push({ name, run }); }
const detail = loadModule("app/api/polls/[id]/route.ts");
const list = loadModule("app/api/polls/route.ts");
const votes = loadModule("app/api/polls/[id]/vote/route.ts");
const comments = loadModule("app/api/polls/[id]/comments/route.ts");
const reactions = loadModule("app/api/comments/[id]/react/route.ts");
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
  rpcFailure = { code: "P0002", message: "CONTENT_NOT_AVAILABLE" };
  await responseJson(await votes.PATCH(request("PATCH", { optionIndex: 0, voterId: VOTER_ID }), context()), 404);
  rpcFailure = { code: "P0002", message: "Existing vote not found." };
  await responseJson(await votes.PATCH(request("PATCH", { optionIndex: 0, voterId: VOTER_ID }), context()), 409);
});

test("reaction success uses atomic RPC while preserving response contract", async () => {
  database.comments.push({ id: COMMENT_ID, poll_id: POLL_ID, is_hidden: false });
  const json = await responseJson(await reactions.POST(request("POST", { userFingerprint: "test-fingerprint", reaction: "like" }), context(COMMENT_ID)), 200);
  assert.deepEqual(json, { likeCount: 1, dislikeCount: 0, userReaction: "like" });
  assert.equal(calls.find((call) => call.rpc)?.rpc, "set_comment_reaction");
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

test("anonymous create/comment/reply/reaction all fail401 before DB access", async () => {
  authUser = null;
  for (const response of [
    await list.POST(request("POST", createBody)),
    await comments.POST(request("POST", { text: "의견" }), context()),
    await comments.POST(request("POST", { text: "답글", parentId: COMMENT_ID }), context()),
    await reactions.POST(request("POST", { userFingerprint: "test-fingerprint", reaction: "like" }), context(COMMENT_ID)),
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
    assertNoSecrets(await responseJson(await comments.POST(request("POST", { text: "의견" }), context()), 401));
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

test("logout session removal blocks new mutations while preserving existing data", async () => {
  await responseJson(await comments.POST(request("POST", { text: "로그인 의견" }), context()), 200);
  const before = JSON.stringify(database);
  authUser = null;
  await responseJson(await comments.POST(request("POST", { text: "로그아웃 의견" }), context()), 401);
  assert.equal(JSON.stringify(database), before);
});

test("anonymous voting/change/duplicate protection still use existing voter RPCs", async () => {
  authUser = null;
  const voteBody = { optionIndex: 0, voterId: VOTER_ID };
  await responseJson(await votes.POST(request("POST", voteBody), context()), 200);
  await responseJson(await votes.POST(request("POST", voteBody), context()), 409);
  await responseJson(await votes.PATCH(request("PATCH", { ...voteBody, optionIndex: 1 }), context()), 200);
  assert.deepEqual(database.polls[0].votes, [0, 1]);
  assert.equal(database.polls[0].participants, 1);
  assert.equal(database.poll_votes.length, 1);
  assert.ok(calls.filter((call) => call.rpc).every((call) => call.payload.p_voter_id === VOTER_ID));
});

test("anonymous reporting remains available independently of Auth", async () => {
  authUser = null;
  await responseJson(await reports.POST(request("POST", reportBody())), 200);
  assert.equal(calls.at(-1).rpc, "submit_content_report");
});

test("authenticated insert DB failure never leaks internal error or user credentials", async () => {
  queryHook = (query) => { if (query.insert) queryFailure = { table: "comments", error: { code: "XX000", message: RAW_ERROR } }; };
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
      assert.ok(!["user_id", "author_user_id", "email", "user_metadata"].includes(key), "Response exposed a private account field.");
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
  assert.deepEqual(json.data, { nickname: PROFILE_NICKNAME, avatar_url: PROFILE_AVATAR, onboarding_completed: false });
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
  assert.equal(database.comments[0].user_name, "익명");
  assert.equal(json.data.user_name, "익명");
  assert.equal(json.data.displayName, "익명");
  assert.ok(!Object.hasOwn(json.data, "avatar_url"));
  assert.ok(!Object.hasOwn(json.data, "nickname"));
  assert.equal(json.data.is_anonymous, true);
  assertNoAccountIdentity(json, { anonymous: true });
  const publicJson = await responseJson(await detail.GET(request(), context()), 200);
  assert.equal(publicJson.comments[0].user_name, "익명");
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
  assert.equal(json.data.user_name, "익명");
  assertNoAccountIdentity(json, { anonymous: true });
});

test("public comment projection ignores stored OAuth names for account rows and preserves legacy names", async () => {
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
  for (const value of [undefined, "https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/%2fevil.invalid", "/%5cevil.invalid", "/%0aevil", "/api/polls", "/auth/login", "/vote/../auth/callback", "/%61uth/login", "/bad%escape"]) {
    assert.equal(getSafeAuthReturnPath(value), "/");
  }
  assert.equal(getSafeAuthReturnPath("/create"), "/create");
  assert.equal(getSafeAuthReturnPath(`/vote/${POLL_ID}`), `/vote/${POLL_ID}`);
});

test("PKCE callback success redirects safely without caching or exposing code", async () => {
  const response = await callback.GET(new Request("https://example.invalid/auth/callback?code=test-code&next=/create"));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://example.invalid/create");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(exchangedCode, "test-code");
  const unsafe = await callback.GET(new Request("https://example.invalid/auth/callback?code=test-code&next=//evil.invalid"));
  assert.equal(unsafe.headers.get("location"), "https://example.invalid/");
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
}
console.log(`${tests.length - failed}/${tests.length} mocked API regression checks passed. No live DB mutations were performed.`);
if (failed) process.exitCode = 1;
