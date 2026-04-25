import "server-only";

import { isUniqueViolation } from "@/lib/execution/reserve";
import { supabaseAdmin } from "@/lib/supabase/server";

import type { CommodusAutotraderStatus } from "./types";

const TERMINAL: CommodusAutotraderStatus[] = [
  "hold_posted",
  "executed",
  "failed",
  "dry_run",
  "skipped",
];

/**
 * Idempotent run reservation keyed by `slot_key`. On unique conflict from a
 * concurrent insert, recurses to load the row created by the other worker.
 */
export async function reserveAutotraderRun(
  slotKey: string,
): Promise<{
  runId: string;
  existingStatus: string | null;
  skip: boolean;
}> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("commodus_autotrader_runs")
    .select("id, status")
    .eq("slot_key", slotKey)
    .maybeSingle();

  if (readErr) {
    throw new Error(`commodus run: read ${readErr.message}`);
  }

  if (existing) {
    if (TERMINAL.includes(existing.status as CommodusAutotraderStatus)) {
      return { runId: existing.id, existingStatus: existing.status, skip: true };
    }
    const { error: upErr } = await supabaseAdmin
      .from("commodus_autotrader_runs")
      .update({ status: "in_progress" })
      .eq("id", existing.id);
    if (upErr) {
      throw new Error(`commodus run: update ${upErr.message}`);
    }
    return { runId: existing.id, existingStatus: null, skip: false };
  }

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("commodus_autotrader_runs")
    .insert({ slot_key: slotKey, status: "in_progress", analysis: {} })
    .select("id")
    .single();

  if (insErr) {
    if (isUniqueViolation(insErr)) {
      return reserveAutotraderRun(slotKey);
    }
    throw new Error(`commodus run: insert ${insErr.message}`);
  }
  if (!inserted) {
    throw new Error("commodus run: insert returned no id");
  }
  return { runId: inserted.id, existingStatus: null, skip: false };
}
