import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;

export const SEED_ID_PREFIX = "seed_v1_";
export const EXPECTED_SEED_COUNT = 30;

const DB_CATEGORIES = new Set([
  "학술/통계",
  "IT/테크",
  "사회/경제",
  "라이프스타일",
  "커뮤니티",
]);
const INTEREST_CATEGORIES = new Set([
  "연애·관계",
  "게임",
  "음식",
  "스포츠",
  "IT·제품",
  "엔터·콘텐츠",
  "라이프/가치관",
]);
const UNSAFE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const seedDataPath = path.resolve(scriptDirectory, "../data/seed-polls.json");

function fail(message) {
  throw new Error(message);
}

function codePointLength(value) {
  return Array.from(value).length;
}

function requireSafeString(value, label, minimum, maximum) {
  if (typeof value !== "string") fail(`${label} must be a string.`);
  const normalized = value.trim();
  const length = codePointLength(normalized);
  if (length < minimum || length > maximum) {
    fail(`${label} must contain ${minimum}-${maximum} characters.`);
  }
  if (UNSAFE_CONTROL_CHARACTERS.test(normalized)) {
    fail(`${label} contains an unsupported control character.`);
  }
  return normalized;
}

function normalizeEditLock(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label}.editLock must be an object.`);
  }
  const allowedKeys = new Set(["mode", "minutes", "participants"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    fail(`${label}.editLock contains an unexpected field.`);
  }
  const mode = value.mode;
  const minutes = value.minutes ?? null;
  const participants = value.participants ?? null;
  if (mode === "first_vote" && minutes === null && participants === null) {
    return { mode, minutes: null, participants: null };
  }
  if (
    mode === "time"
    && Number.isInteger(minutes)
    && minutes >= 1
    && minutes <= 1440
    && participants === null
  ) {
    return { mode, minutes, participants: null };
  }
  if (
    mode === "participants"
    && minutes === null
    && Number.isInteger(participants)
    && participants >= 1
    && participants <= 1000
  ) {
    return { mode, minutes: null, participants };
  }
  if (
    mode === "time_or_participants"
    && Number.isInteger(minutes)
    && minutes >= 1
    && minutes <= 1440
    && Number.isInteger(participants)
    && participants >= 1
    && participants <= 1000
  ) {
    return { mode, minutes, participants };
  }
  fail(`${label}.editLock is invalid.`);
}

function normalizeSeedEntry(value, index) {
  const label = `seed[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }

  const seedKey = requireSafeString(value.seedKey, `${label}.seedKey`, 3, 64);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(seedKey)) {
    fail(`${label}.seedKey must use lowercase letters, numbers, and single hyphens.`);
  }
  if (!INTEREST_CATEGORIES.has(value.interestCategory)) {
    fail(`${label}.interestCategory is invalid.`);
  }
  if (!DB_CATEGORIES.has(value.category)) {
    fail(`${label}.category is invalid.`);
  }

  const title = requireSafeString(value.title, `${label}.title`, 3, 120);
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 6) {
    fail(`${label}.options must contain 2-6 values.`);
  }
  const options = value.options.map((option, optionIndex) => (
    requireSafeString(option, `${label}.options[${optionIndex}]`, 1, 50)
  ));
  if (new Set(options.map((option) => option.toLocaleLowerCase("ko-KR"))).size !== options.length) {
    fail(`${label}.options must be unique.`);
  }

  if (value.description !== undefined && value.official_fact !== undefined) {
    fail(`${label} cannot contain both description and official_fact.`);
  }
  const descriptionValue = value.description ?? value.official_fact;
  const description = descriptionValue === undefined || descriptionValue === null
    ? null
    : requireSafeString(descriptionValue, `${label}.description`, 1, 300);
  const editLock = normalizeEditLock(value.editLock, label);
  const id = `${SEED_ID_PREFIX}${seedKey}`;
  if (id.length > 200) fail(`${label} creates an ID longer than 200 characters.`);

  return {
    seedKey,
    interestCategory: value.interestCategory,
    row: {
      id,
      title,
      category: value.category,
      options,
      votes: options.map(() => 0),
      participants: 0,
      official_fact: description,
      option_image_paths: null,
      edit_lock_mode: editLock.mode,
      edit_lock_minutes: editLock.minutes,
      edit_lock_participants: editLock.participants,
    },
  };
}

export async function loadSeedEntries() {
  const source = await readFile(seedDataPath, "utf8");
  const parsed = JSON.parse(source);
  if (!Array.isArray(parsed)) fail("Seed data must be a JSON array.");
  if (parsed.length !== EXPECTED_SEED_COUNT) {
    fail(`Seed data must contain exactly ${EXPECTED_SEED_COUNT} polls.`);
  }
  const entries = parsed.map(normalizeSeedEntry);
  if (new Set(entries.map((entry) => entry.seedKey)).size !== entries.length) {
    fail("Seed keys must be unique.");
  }
  if (new Set(entries.map((entry) => entry.row.id)).size !== entries.length) {
    fail("Generated seed poll IDs must be unique.");
  }
  return entries;
}

export function getCategoryCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.interestCategory] = (counts[entry.interestCategory] ?? 0) + 1;
    return counts;
  }, {});
}

export function loadSeedEnvironment() {
  loadEnvConfig(process.cwd());
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
  const target = new URL(supabaseUrl);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  return {
    targetUrl: target.origin,
    isProductionLike: !localHosts.has(target.hostname),
    supabase: createClient(target.origin, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
}

export function getExecutionMode(argv, isProductionLike) {
  const knownFlags = new Set(["--apply", "--dry-run", "--confirm-production"]);
  const unknownFlags = argv.filter((argument) => !knownFlags.has(argument));
  if (unknownFlags.length > 0) fail(`Unknown option: ${unknownFlags.join(", ")}`);
  if (argv.includes("--apply") && argv.includes("--dry-run")) {
    fail("Use either --apply or --dry-run, not both.");
  }
  const apply = argv.includes("--apply");
  if (apply && isProductionLike && !argv.includes("--confirm-production")) {
    fail("Hosted Supabase writes require --confirm-production together with --apply.");
  }
  return { apply, dryRun: !apply };
}

export async function fetchSeedRows(supabase, ids) {
  const { data, error } = await supabase
    .from("polls")
    .select("id,title,category,options,votes,participants,official_fact,option_image_paths,edit_lock_mode,edit_lock_minutes,edit_lock_participants")
    .in("id", ids);
  if (error) fail(`Could not inspect existing seed polls: ${error.message}`);
  return data ?? [];
}

export function matchesSeedIdentity(existing, expected) {
  return existing.id === expected.id
    && existing.title === expected.title
    && existing.category === expected.category
    && JSON.stringify(existing.options) === JSON.stringify(expected.options)
    && (existing.official_fact ?? null) === expected.official_fact
    && existing.option_image_paths === null
    && existing.edit_lock_mode === expected.edit_lock_mode
    && (existing.edit_lock_minutes ?? null) === expected.edit_lock_minutes
    && (existing.edit_lock_participants ?? null) === expected.edit_lock_participants;
}

export function assertExistingRowsSafe(existingRows, expectedById) {
  for (const existing of existingRows) {
    const expected = expectedById.get(existing.id);
    if (!expected || !matchesSeedIdentity(existing, expected)) {
      fail(`Seed ID collision or modified seed identity detected: ${existing.id}. No rows were changed.`);
    }
  }
}
