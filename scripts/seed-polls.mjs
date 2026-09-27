import {
  assertExistingRowsSafe,
  fetchSeedRows,
  getCategoryCounts,
  getExecutionMode,
  loadSeedEntries,
  loadSeedEnvironment,
} from "./seed-polls-common.mjs";

async function main() {
  const entries = await loadSeedEntries();
  const { targetUrl, isProductionLike, supabase } = loadSeedEnvironment();
  console.log(`Target Supabase: ${targetUrl}`);
  const mode = getExecutionMode(process.argv.slice(2), isProductionLike);
  console.log(`Mode: ${mode.dryRun ? "DRY RUN (no changes)" : "APPLY"}`);

  const rows = entries.map((entry) => entry.row);
  const ids = rows.map((row) => row.id);
  const expectedById = new Map(rows.map((row) => [row.id, row]));
  const existingRows = await fetchSeedRows(supabase, ids);
  assertExistingRowsSafe(existingRows, expectedById);
  const existingIds = new Set(existingRows.map((row) => row.id));
  const missingRows = rows.filter((row) => !existingIds.has(row.id));

  console.log(`Validated seed polls: ${rows.length}`);
  console.log(`Already present: ${existingRows.length}`);
  console.log(`Missing: ${missingRows.length}`);
  console.log("Category counts:");
  for (const [category, count] of Object.entries(getCategoryCounts(entries))) {
    console.log(`- ${category}: ${count}`);
  }

  if (mode.dryRun) {
    console.log("Dry run complete. Use --apply to write, and add --confirm-production for hosted Supabase.");
    return;
  }

  if (missingRows.length > 0) {
    const { error } = await supabase
      .from("polls")
      .upsert(missingRows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(`Seed insert failed: ${error.message}`);
  }

  const finalRows = await fetchSeedRows(supabase, ids);
  assertExistingRowsSafe(finalRows, expectedById);
  if (finalRows.length !== rows.length) {
    throw new Error(`Seed verification failed: expected ${rows.length}, found ${finalRows.length}.`);
  }

  console.log(`Seed apply complete. Newly requested: ${missingRows.length}; total present: ${finalRows.length}.`);
}

main().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
