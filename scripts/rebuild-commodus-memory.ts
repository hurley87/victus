import { rebuildCommodusSocialMemoryFromCasts } from "@/lib/commodus/social/memory";

async function main() {
  const outcome = await rebuildCommodusSocialMemoryFromCasts();
  console.log(
    JSON.stringify(
      {
        ok: true,
        threads: summarize(outcome.threads),
        users: summarize(outcome.users),
      },
      null,
      2,
    ),
  );
}

function summarize(results: Array<{ status: string }>) {
  return {
    total: results.length,
    updated: results.filter((result) => result.status === "updated").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
