/** Max executed casts per UTC day that earn points (issue #11). */
export const SCORING_CASTS_PER_UTC_DAY = 5;

/** Profitable-close bonus requires realized PnL ≥ this many USDC (after fees). */
export const PROFITABLE_CLOSE_MIN_USDC = 0.25;

/** Return bonus thresholds (percentage points, e.g. 10 means 10%). */
export const RETURN_BONUS_10_PCT = 10;
export const RETURN_BONUS_25_PCT = 25;

export const POINTS_TRADE_EXECUTED = 1;
export const POINTS_PROFITABLE_CLOSE = 10;
export const POINTS_RETURN_10_BONUS = 10;
export const POINTS_RETURN_25_BONUS = 25;
