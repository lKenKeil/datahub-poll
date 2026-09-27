import {
  assertExistingRowsSafe,
  fetchSeedRows,
  getExecutionMode,
  loadSeedEntries,
  loadSeedEnvironment,
} from "./seed-polls-common.mjs";

async function main() {
  const entries = await loadSeedEntries();
  const { targetUrl, isProductionLike, supabase } = loadSeedEnvironment();
  console.log(`Target Supabase: ${targetUrl}`);
  const mode = getExecutionMode(process.argv.slice(2), isProductionLike);
  console.log(`Mode: ${mode.dryRun ? "DRY RUN (no changes)" : "REMOVE"}`);

  const rows = entries.map((entry) => entry.row);
  const ids = rows.map((row) => row.id);
  const expectedById = new Map(rows.map((row) => [row.id, row]));
  const existingRows = await fetchSeedRows(supabase, ids);

  // Validate every candidate before deleting the first row. A seed-shaped ID
  // with changed identity is left untouched for manual review.
  assertExistingRowsSafe(existingRows, expectedById);
  console.log(`Matching seed polls found: ${existingRows.length}`);

  if (mode.dryRun) {
    console.log("Dry run complete. Use --apply to remove, and add --confirm-production for hosted Supabase.");
    return;
  }

  for (const row of existingRows) {
    const { error } = await supabase.rpc("delete_poll_with_dependents", {
      p_poll_id: row.id,
    });
    if (error && error.code !== "P0002") {
      throw new Error(`Seed removal failed for ${row.id}: ${error.message}`);
    }
  }

  const remainingRows = await fetchSeedRows(supabase, ids);
  if (remainingRows.length > 0) {
    throw new Error(`Seed removal verification failed: ${remainingRows.length} rows remain.`);
  }
  console.log(`Seed removal complete. Removed: ${existingRows.length}.`);
}

main().catch((error) => {
  console.error(`Seed removal failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
});
