import { DEFAULT_ENGINE_SETTINGS, type EngineSettings } from '../audio/engine';
import { normalizeGains } from '../audio/eq';
import type { BitDepth } from '../audio/wav';

export interface AppSettings {
  engine: EngineSettings;
  eqPresetId: string | 'custom' | 'hearing';
  hearingEq: number[] | null;
  activeVoiceId: string | null;
  bitDepth: BitDepth;
  transcribeModel: string;
  language: string | null;
  autoTranscribe: boolean;
  onboarded: boolean;
  headphoneAck: boolean;
  sounds: boolean;
  listenView: 'ring' | 'sources';
  scopeSensitivity: number;
  // ── Spy Suite ──────────────────────────────────────────────────────────
  boostMode: boolean;              // unlocks 80 dB gain slider (default: false)
  vadEnabled: boolean;             // auto-record on voice detection
  vadSensitivity: number;          // 0..1 (default 0.5)
  vadSilenceTimeoutSec: number;    // seconds of silence before auto-stop (default 2)
  ghostSec: number;                // how many seconds of ghost buffer to save (default 30)
  tutorialSeen: boolean;           // skip intro walkthrough after first run
}

export const DEFAULT_SETTINGS: AppSettings = {
  engine: DEFAULT_ENGINE_SETTINGS,
  eqPresetId: 'speech',
  hearingEq: null,
  activeVoiceId: null,
  bitDepth: 24,
  transcribeModel: 'onnx-community/whisper-base.en',
  language: null,
  autoTranscribe: true,
  onboarded: false,
  headphoneAck: false,
  sounds: true,
  listenView: 'sources',
  scopeSensitivity: 0.7,
  boostMode: false,
  vadEnabled: false,
  vadSensitivity: 0.5,
  vadSilenceTimeoutSec: 2,
  ghostSec: 30,
  tutorialSeen: false,
};

const KEY = 'earshot.settings.v1';

export function loadSettings(storage: Pick<Storage,'getItem'> = localStorage): AppSettings {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const p = JSON.parse(raw) as Partial<AppSettings>;
    const engine = { ...DEFAULT_ENGINE_SETTINGS, ...(p.engine ?? {}) };
    engine.eq = normalizeGains(engine.eq);
    engine.mutes = Array.isArray(engine.mutes) ? engine.mutes.slice(0,3) : [];
    engine.lock = (engine.lock && typeof engine.lock==='object') ? engine.lock : null;
    if (!engine.humFilter) engine.humFilter = 'off';
    if (!engine.audioZoom) engine.audioZoom = 'off';
    if (engine.spectralAmount == null) engine.spectralAmount = 0.5;
    return { ...DEFAULT_SETTINGS, ...p, engine, hearingEq: p.hearingEq ? normalizeGains(p.hearingEq) : null };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: AppSettings, storage: Pick<Storage,'setItem'> = localStorage){
  try{storage.setItem(KEY,JSON.stringify(s));}catch{/* storage full */}
}
