"use client";

import {
  POINTS_PROFITABLE_CLOSE,
  POINTS_RETURN_10_BONUS,
  POINTS_RETURN_25_BONUS,
  POINTS_TRADE_EXECUTED,
  PROFITABLE_CLOSE_MIN_USDC,
  RETURN_BONUS_10_PCT,
  RETURN_BONUS_25_PCT,
} from "@/lib/scoring/constants";

export function ScoringTable() {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gold">
        Scoring
      </h2>
      <div className="space-y-2">
        <ScoringRow label="Executed trade" points={POINTS_TRADE_EXECUTED} />
        <ScoringRow
          label={`Profitable close (>= $${PROFITABLE_CLOSE_MIN_USDC.toFixed(2)} after fees)`}
          points={POINTS_PROFITABLE_CLOSE}
        />
        <ScoringRow
          label={`Return bonus >= ${RETURN_BONUS_10_PCT}%`}
          points={POINTS_RETURN_10_BONUS}
        />
        <ScoringRow
          label={`Return bonus >= ${RETURN_BONUS_25_PCT}%`}
          points={POINTS_RETURN_25_BONUS}
        />
      </div>
    </section>
  );
}

function ScoringRow({ label, points }: { label: string; points: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-300">{label}</span>
      <span className="text-gold font-mono text-xs font-medium">+{points}</span>
    </div>
  );
}
