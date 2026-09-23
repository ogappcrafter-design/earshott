export const EQ_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MIN_DB = -15;
export const EQ_MAX_DB = 15;

export type EqGains = number[];

export interface EqPreset {
  id: string;
  name: string;
  gains: EqGains;
}

export const EQ_PRESETS: EqPreset[] = [
  { id: 'flat', name: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'speech', name: 'Clear speech', gains: [-8, -6, -3, 0, 2, 4, 6, 5, 2, -2] },
  { id: 'restaurant', name: 'Noisy room', gains: [-12, -10, -7, -3, 1, 4, 7, 6, 2, -4] },
  { id: 'tv', name: 'TV and movies', gains: [-2, 0, 1, 1, 2, 3, 5, 4, 2, 0] },
  { id: 'lecture', name: 'Lecture hall', gains: [-10, -8, -4, 0, 2, 3, 5, 5, 3, -1] },
  { id: 'nature', name: 'Outdoors', gains: [-6, -4, -2, 0, 0, 1, 3, 4, 5, 3] },
];

export const clampGain = (db: number) =>
  Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, Number.isFinite(db) ? db : 0));

export const normalizeGains = (gains: number[] | undefined): EqGains =>
  EQ_BANDS.map((_, i) => clampGain(gains?.[i] ?? 0));

/** Q giving roughly one-octave bandwidth per peaking filter. */
export const BAND_Q = 1.41;

export const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`);
