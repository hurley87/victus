/**
 * Calendar UTC month string YYYY-MM for leaderboard / scoring_events.month.
 */
export function utcMonthFromTimestamp(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Half-open UTC day range [start, end) for the calendar day of `isoTimestamp`.
 */
export function utcDayRangeFromTimestamp(isoTimestamp: string): {
  startIso: string;
  endIso: string;
} {
  const d = new Date(isoTimestamp);
  const start = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function utcCurrentMonthString(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function utcMonthBounds(month: string): { startIso: string; endIso: string } {
  const [ys, ms] = month.split("-");
  const y = Number(ys);
  const m = Number(ms);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}
