import {
  fetchSeedRows,
  getExecutionMode,
  loadSeedEntries,
  loadSeedEnvironment,
  matchesSeedContent,
} from "./seed-polls-common.mjs";

const STATUS_ORDER = [
  "unchanged",
  "safe-to-update",
  "blocked-by-activity",
  "missing",
];

async function fetchCount(supabase, table, pollId) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("poll_id", pollId);

  if (error) {
    throw new Error(`Could not inspect ${table} activity for ${pollId}.`);
  }
  return count ?? 0;
}

async function fetchActivityByPoll(supabase, ids) {
  const entries = await Promise.all(ids.map(async (pollId) => {
    const [pollVotes, comments] = await Promise.all([
      fetchCount(supabase, "poll_votes", pollId),
      fetchCount(supabase, "comments", pollId),
    ]);
    return [pollId, { pollVotes, comments }];
  }));
  return new Map(entries);
}

function classify(entries, existingRows, activityByPoll) {
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  return entries.map((entry) => {
    const expected = entry.row;
    const existing = existingById.get(expected.id);
    if (!existing) {
      return { entry, status: "missing", participants: 0, pollVotes: 0, comments: 0 };
    }

    const activity = activityByPoll.get(expected.id) ?? { pollVotes: 0, comments: 0 };
    const participants = existing.participants ?? 0;
    if (matchesSeedContent(existing, expected)) {
      return { entry, status: "unchanged", participants, ...activity };
    }

    const hasActivity = existing.participants !== 0
      || activity.pollVotes !== 0
      || activity.comments !== 0;
    return {
      entry,
      status: hasActivity ? "blocked-by-activity" : "safe-to-update",
      participants,
      ...activity,
    };
  });
}

function printReport(classified) {
  for (const status of STATUS_ORDER) {
    const rows = classified.filter((item) => item.status === status);
    console.log(`${status}: ${rows.length}`);
    for (const item of rows) {
      console.log(
        `- ${item.entry.row.id} (participants=${item.participants}, poll_votes=${item.pollVotes}, comments=${item.comments})`,
      );
    }
  }
}

async function applySafeUpdates(supabase, classified) {
  const results = [];
  for (const item of classified) {
    if (item.status !== "safe-to-update") continue;
    const row = item.entry.row;
    const { data, error } = await supabase.rpc("sync_seed_poll_content", {
      p_poll_id: row.id,
      p_title: row.title,
      p_category: row.category,
      p_options: row.options,
      p_official_fact: row.official_fact,
      p_edit_lock_mode: row.edit_lock_mode,
      p_edit_lock_minutes: row.edit_lock_minutes,
      p_edit_lock_participants: row.edit_lock_participants,
    });

    if (error) {
      const migrationHint = error.code === "PGRST202"
        ? " Apply the seed sync RPC migration before running --apply."
        : "";
      throw new Error(`Seed sync failed for ${row.id}.${migrationHint}`);
    }
    results.push({ id: row.id, status: data?.status ?? "unknown" });
  }
  return results;
}

async function main() {
  const entries = await loadSeedEntries();
  const { targetUrl, isProductionLike, supabase } = loadSeedEnvironment();
  const mode = getExecutionMode(process.argv.slice(2), isProductionLike);
  console.log(`Target Supabase: ${targetUrl}`);
  console.log(`Mode: ${mode.dryRun ? "DRY RUN (no changes)" : "APPLY"}`);

  const ids = entries.map((entry) => entry.row.id);
  const existingRows = await fetchSeedRows(supabase, ids);
  const activityByPoll = await fetchActivityByPoll(supabase, ids);
  const classified = classify(entries, existingRows, activityByPoll);
  printReport(classified);

  if (mode.dryRun) {
    console.log("Dry run complete. No rows were changed.");
    console.log("Use --apply --confirm-production to update safe hosted seed polls.");
    return;
  }

  const results = await applySafeUpdates(supabase, classified);
  const updated = results.filter((result) => result.status === "updated").length;
  const skipped = results.length - updated;
  console.log(`Apply complete. Updated: ${updated}; skipped after atomic recheck: ${skipped}.`);
}

main().catch((error) => {
  console.error(`Seed sync failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
