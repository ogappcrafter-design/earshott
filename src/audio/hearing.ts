import { EQ_BANDS, clampGain } from './eq';

export const TEST_FREQS = [250, 500, 1000, 2000, 4000, 8000] as const;
/** Descending tone levels in dBFS. The quietest level heard becomes that frequency's threshold. */
export const TEST_LEVELS = [-20, -30, -40, -50, -60, -70] as const;
/** Reference: the threshold a typical listener reaches on phone earbuds at this test's quietest step. */
export const REFERENCE_DB = -70;
const MAX_BOOST = 15;

/**
 * Convert per-frequency thresholds (dBFS, quietest level heard; null = never heard) into EQ gains,
 * using the half-gain rule: boost by half the measured shortfall, capped for comfort.
 */
export function thresholdsToEq(thresholds: Record<number, number | null>): number[] {
  const boostAt = (f: number) => {
    const t = thresholds[f];
    const heard = t === null || t === undefined ? TEST_LEVELS[0] + 10 : t;
    return Math.min(MAX_BOOST, Math.max(0, (heard - REFERENCE_DB) / 2));
  };
  const pts = TEST_FREQS.map((f) => ({ x: Math.log2(f), y: boostAt(f) }));
  return EQ_BANDS.map((band) => {
    const x = Math.log2(band);
    if (x <= pts[0].x) return clampGain(pts[0].y * 0.5);
    if (x >= pts[pts.length - 1].x) return clampGain(pts[pts.length - 1].y);
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i].x && x <= pts[i + 1].x) {
        const t = (x - pts[i].x) / (pts[i + 1].x - pts[i].x);
        return clampGain(Math.round((pts[i].y + t * (pts[i + 1].y - pts[i].y)) * 10) / 10);
      }
    }
    return 0;
  });
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
