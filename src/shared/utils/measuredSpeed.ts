/**
 * Turning a measured writing speed (tokens per second, from a speed test) into the same Fast / OK / Slow
 * words the estimate on Model Tuning uses, so the two can be set side by side.
 *
 * Thresholds are about conversation, not benchmarks: a reply is some 50 to 100 tokens, so 30+ tokens/s
 * is a second or two (Fast), 8 to 30 is a few seconds to ten (OK), and under 8 is a wait of ten seconds
 * to a minute for every reply (Slow). In the test that set these, models that fit in GPU memory measured
 * 70 to 137 tokens/s and ones that spilled onto the CPU 2 to 13.
 */
export type MeasuredTier = 'Fast' | 'OK' | 'Slow';

export const MEASURED_FAST_TOKENS_PER_SEC = 30;
export const MEASURED_OK_TOKENS_PER_SEC = 8;

export function measuredSpeedTier(tokensPerSec: number): MeasuredTier {
  if (tokensPerSec >= MEASURED_FAST_TOKENS_PER_SEC) return 'Fast';
  if (tokensPerSec >= MEASURED_OK_TOKENS_PER_SEC) return 'OK';
  return 'Slow';
}

const RANK: Record<MeasuredTier, number> = { Slow: 0, OK: 1, Fast: 2 };

/** True when the estimate promised a better speed than the test measured. (Slower than hoped is the
 * surprise worth flagging; faster than estimated is just good news.) */
export function estimateWasTooOptimistic(estimate: MeasuredTier | string, measured: MeasuredTier): boolean {
  const guess = RANK[estimate as MeasuredTier];
  return guess !== undefined && guess > RANK[measured];
}
