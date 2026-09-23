import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioEngine, EngineStartError, type EngineSettings } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { defaultTitle, listRecordings, listVoices, newId, saveRecording, type Recording, type VoiceProfile } from '../storage/db';
import { enqueueTranscription, onTranscribe } from '../transcribe/queue';
import { loadSettings, saveSettings, type AppSettings } from './settings';
import { setSfxEnabled } from '../ui/sfx';
import { IS_TESTER } from '../demo';

export interface Store {
  settings: AppSettings;
  setSettings: (fn: (s: AppSettings) => AppSettings) => void;
  setEngine: (patch: Partial<EngineSettings>) => void;
  engine: AudioEngine;
  live: boolean;
  monitoring: boolean;
  recording: boolean;
  recordStartedAt: number | null;
  bookmarks: number[];
  error: string | null;
  startLive: () => Promise<boolean>;
  stopLive: () => Promise<void>;
  toggleMonitor: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Recording | null>;
  addBookmark: () => void;
  recordings: Recording[];
  voices: VoiceProfile[];
  refresh: () => Promise<void>;
  downloadProgress: number | null;
  activeVoice: VoiceProfile | null;
  usingTestSignal: boolean;
  setTestSignal: (on: boolean) => Promise<void>;
  notice: string | null;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => { const s = useContext(Ctx); if (!s) throw new Error('Store missing'); return s; };

export function StoreProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef(new AudioEngine());
  const engine = engineRef.current;
  const [settings, setSettingsState] = useState<AppSettings>(() => loadSettings());
  const [live, setLive] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [usingTestSignal, setUsingTestSignal] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activeVoice = useMemo(() => voices.find((v) => v.id === settings.activeVoiceId) ?? null, [voices, settings.activeVoiceId]);
  const effectiveEngine = useMemo<EngineSettings>(() => ({
    ...settings.engine,
    focusTarget: activeVoice ? { lowHz: activeVoice.lowHz, highHz: activeVoice.highHz, medianHz: activeVoice.medianHz } : null,
  }), [settings.engine, activeVoice]);

  const setSettings = useCallback((fn: (s: AppSettings) => AppSettings) => {
    setSettingsState((prev) => { const next = fn(prev); saveSettings(next); return next; });
  }, []);
  const setEngine = useCallback((patch: Partial<EngineSettings>) => setSettings((s) => ({ ...s, engine: { ...s.engine, ...patch } })), [setSettings]);

  useEffect(() => { if (engine.running) engine.update(effectiveEngine); }, [effectiveEngine, engine]);
  useEffect(() => { setSfxEnabled(settings.sounds); }, [settings.sounds]);

  const refresh = useCallback(async () => {
    const [r, v] = await Promise.all([listRecordings(), listVoices()]);
    setRecordings(r); setVoices(v);
  }, []);
  useEffect(() => { refresh().catch(() => setError('Your archive could not be opened. Restart the app to try again.')); }, [refresh]);
  useEffect(() => onTranscribe((e) => {
    if (e.type === 'download') setDownloadProgress(e.progress >= 100 ? null : e.progress);
    else { if (e.type !== 'status') setDownloadProgress(null); refresh(); }
  }), [refresh]);

  const startLive = useCallback(async () => {
    setError(null);
    try { await engine.start(effectiveEngine, { demo: usingTestSignal }); setLive(true); return true; }
    catch (e) {
      if (IS_TESTER) {
        try {
          await engine.start(effectiveEngine, { demo: true });
          setUsingTestSignal(true); setLive(true);
          setNotice('The microphone isn’t available in this preview, so you’re hearing a built-in noisy-room test signal. Every control still works on it.');
          return true;
        } catch { /* fall through to the normal error */ }
      }
      const code = e instanceof EngineStartError ? e.code : 'unknown';
      setError(code === 'permission-denied'
        ? 'Microphone access is off. Turn it on in Android Settings > Apps > Earshot > Permissions.'
        : code === 'no-microphone' ? 'No microphone was found. Check that nothing else is using it.'
        : code === 'unsupported' ? 'This phone’s system WebView is too old. Update Android System WebView from the Play Store.'
        : 'The microphone could not start. Close other recording apps and try again.');
      return false;
    }
  }, [engine, effectiveEngine, usingTestSignal]);

  const stopLive = useCallback(async () => {
    await engine.stop(); setLive(false); setMonitoring(false); setRecording(false); setRecordStartedAt(null);
  }, [engine]);

  const setTestSignal = useCallback(async (on: boolean) => {
    const wasMonitoring = engine.monitoring;
    await engine.stop(); setLive(false); setRecording(false); setRecordStartedAt(null); setMonitoring(false);
    setUsingTestSignal(on); setNotice(null); setError(null);
    try {
      await engine.start(effectiveEngine, { demo: on }); setLive(true);
      if (wasMonitoring) { engine.setMonitoring(true); setMonitoring(true); }
    } catch {
      setError('The microphone isn’t available here. Switch the test signal back on to keep testing.');
    }
  }, [engine, effectiveEngine]);

  const toggleMonitor = useCallback(async () => {
    if (!engine.running && !(await startLive())) return;
    const next = !engine.monitoring; engine.setMonitoring(next); setMonitoring(next);
  }, [engine, startLive]);

  const startRecording = useCallback(async () => {
    if (!engine.running && !(await startLive())) return;
    engine.startRecording(); setRecording(true); setRecordStartedAt(Date.now()); setBookmarks([]);
  }, [engine, startLive]);

  const addBookmark = useCallback(() => {
    if (recordStartedAt) setBookmarks((b) => [...b, (Date.now() - recordStartedAt) / 1000]);
  }, [recordStartedAt]);

  const stopRecording = useCallback(async () => {
    const sr = engine.sampleRate;
    const samples = await engine.stopRecording();
    setRecording(false); setRecordStartedAt(null);
    if (samples.length < sr * 0.5) { setError('That recording was under half a second, so it was not saved.'); return null; }
    const wav = encodeWav([samples], sr, settings.bitDepth);
    const rec: Recording = {
      id: newId(), title: defaultTitle(), createdAt: Date.now(), durationSec: samples.length / sr, sampleRate: sr,
      bitDepth: settings.bitDepth, sizeBytes: wav.byteLength, audio: new Blob([wav], { type: 'audio/wav' }),
      bookmarks, voiceProfileId: settings.activeVoiceId, transcript: null, transcriptStatus: 'none',
    };
    try { await saveRecording(rec); }
    catch { setError('Your phone is out of storage space, so the recording could not be saved.'); return null; }
    await refresh();
    if (settings.autoTranscribe) enqueueTranscription(rec.id, settings.transcribeModel, settings.language).then(refresh);
    return rec;
  }, [engine, settings, bookmarks, refresh]);

  useEffect(() => {
    const onHide = () => { if (document.hidden && engine.monitoring && !engine.recording) { engine.setMonitoring(false); setMonitoring(false); } };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [engine]);

  const value: Store = {
    settings, setSettings, setEngine, engine, live, monitoring, recording, recordStartedAt, bookmarks, error,
    startLive, stopLive, toggleMonitor, startRecording, stopRecording, addBookmark, recordings, voices, refresh,
    downloadProgress, activeVoice, usingTestSignal, setTestSignal, notice,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
