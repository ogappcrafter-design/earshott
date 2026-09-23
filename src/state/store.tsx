import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AudioEngine, EngineStartError, type EngineSettings } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { defaultTitle, listRecordings, listVoices, newId, saveRecording, type Recording, type VoiceProfile } from '../storage/db';
import { enqueueTranscription, onTranscribe } from '../transcribe/queue';
import { loadSettings, saveSettings, type AppSettings } from './settings';
import { setSfxEnabled } from '../ui/sfx';
import { IS_TESTER } from '../demo';
import { VAD } from '../audio/vad';

export interface Store {
  settings: AppSettings;
  setSettings: (fn: (s:AppSettings)=>AppSettings) => void;
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
  stopRecording: () => Promise<Recording|null>;
  addBookmark: () => void;
  saveGhostRecording: () => Promise<Recording|null>;
  ghostAvailSec: number;
  vadActive: boolean;
  recordings: Recording[];
  voices: VoiceProfile[];
  refresh: () => Promise<void>;
  downloadProgress: number | null;
  activeVoice: VoiceProfile | null;
  usingTestSignal: boolean;
  setTestSignal: (on:boolean) => Promise<void>;
  notice: string | null;
}

const Ctx = createContext<Store|null>(null);
export const useStore = () => { const s=useContext(Ctx); if(!s) throw new Error('Store missing'); return s; };

export function StoreProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef(new AudioEngine());
  const engine = engineRef.current;
  const [settings, setSettingsState] = useState<AppSettings>(()=>loadSettings());
  const [live, setLive] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordStartedAt, setRecordStartedAt] = useState<number|null>(null);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [error, setError] = useState<string|null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<number|null>(null);
  const [usingTestSignal, setUsingTestSignal] = useState(false);
  const [notice, setNotice] = useState<string|null>(null);
  const [ghostAvailSec, setGhostAvailSec] = useState(0);
  const [vadActive, setVadActive] = useState(false);

  const vadRef = useRef<VAD|null>(null);
  const vadTickRef = useRef<ReturnType<typeof setInterval>|null>(null);

  const activeVoice = useMemo(()=>voices.find((v)=>v.id===settings.activeVoiceId)??null,[voices,settings.activeVoiceId]);
  const effectiveEngine = useMemo<EngineSettings>(()=>({
    ...settings.engine,
    focusTarget: activeVoice ? {lowHz:activeVoice.lowHz,highHz:activeVoice.highHz,medianHz:activeVoice.medianHz} : null,
  }),[settings.engine,activeVoice]);

  const setSettings = useCallback((fn:(s:AppSettings)=>AppSettings)=>{
    setSettingsState((prev)=>{const next=fn(prev);saveSettings(next);return next;});
  },[]);
  const setEngine = useCallback((patch:Partial<EngineSettings>)=>setSettings((s)=>({...s,engine:{...s.engine,...patch}})),[setSettings]);

  useEffect(()=>{if(engine.running) engine.update(effectiveEngine);},[effectiveEngine,engine]);
  useEffect(()=>{setSfxEnabled(settings.sounds);},[settings.sounds]);

  const refresh = useCallback(async()=>{
    const [r,v]=await Promise.all([listRecordings(),listVoices()]);
    setRecordings(r); setVoices(v);
  },[]);
  useEffect(()=>{refresh().catch(()=>setError('Your archive could not be opened. Restart the app to try again.'));},[refresh]);
  useEffect(()=>onTranscribe((e)=>{
    if(e.type==='download') setDownloadProgress(e.progress>=100?null:e.progress);
    else{if(e.type!=='status') setDownloadProgress(null); refresh();}
  }),[refresh]);

  const startLive = useCallback(async()=>{
    setError(null);
    try{await engine.start(effectiveEngine,{demo:usingTestSignal});setLive(true);return true;}
    catch(e){
      if(IS_TESTER){
        try{
          await engine.start(effectiveEngine,{demo:true});
          setUsingTestSignal(true);setLive(true);
          setNotice('Microphone not available in this preview — using a built-in test signal.');
          return true;
        }catch{/**/}
      }
      const code = e instanceof EngineStartError?e.code:'unknown';
      setError(code==='permission-denied'
        ?'Microphone access is off. Turn it on in Android Settings > Apps > Earshot > Permissions.'
        :code==='no-microphone'?'No microphone was found. Check that nothing else is using it.'
        :code==='unsupported'?'This phone\'s system WebView is too old. Update Android System WebView from the Play Store.'
        :'The microphone could not start. Close other recording apps and try again.');
      return false;
    }
  },[engine,effectiveEngine,usingTestSignal]);

  const stopLive = useCallback(async()=>{
    await engine.stop();setLive(false);setMonitoring(false);setRecording(false);setRecordStartedAt(null);setGhostAvailSec(0);
  },[engine]);

  const setTestSignal = useCallback(async(on:boolean)=>{
    const wasMonitoring=engine.monitoring;
    await engine.stop();setLive(false);setRecording(false);setRecordStartedAt(null);setMonitoring(false);
    setUsingTestSignal(on);setNotice(null);setError(null);
    try{
      await engine.start(effectiveEngine,{demo:on});setLive(true);
      if(wasMonitoring){engine.setMonitoring(true);setMonitoring(true);}
    }catch{setError('The microphone isn\'t available here.');}
  },[engine,effectiveEngine]);

  const toggleMonitor = useCallback(async()=>{
    if(!engine.running&&!(await startLive())) return;
    const next=!engine.monitoring; engine.setMonitoring(next); setMonitoring(next);
  },[engine,startLive]);

  const startRecording = useCallback(async()=>{
    if(!engine.running&&!(await startLive())) return;
    engine.startRecording();setRecording(true);setRecordStartedAt(Date.now());setBookmarks([]);
  },[engine,startLive]);

  const addBookmark = useCallback(()=>{
    if(recordStartedAt) setBookmarks((b)=>[...b,(Date.now()-recordStartedAt)/1000]);
  },[recordStartedAt]);

  const stopRecording = useCallback(async()=>{
    const sr=engine.sampleRate;
    const samples=await engine.stopRecording();
    setRecording(false);setRecordStartedAt(null);
    if(samples.length<sr*0.5){setError('That recording was under half a second, so it was not saved.');return null;}
    const wav=encodeWav([samples],sr,settings.bitDepth);
    const rec: Recording = {
      id:newId(),title:defaultTitle(),createdAt:Date.now(),durationSec:samples.length/sr,sampleRate:sr,
      bitDepth:settings.bitDepth,sizeBytes:wav.byteLength,audio:new Blob([wav],{type:'audio/wav'}),
      bookmarks,voiceProfileId:settings.activeVoiceId,transcript:null,transcriptStatus:'none',
    };
    try{await saveRecording(rec);}
    catch{setError('Your phone is out of storage space, so the recording could not be saved.');return null;}
    await refresh();
    if(settings.autoTranscribe) enqueueTranscription(rec.id,settings.transcribeModel,settings.language).then(refresh);
    return rec;
  },[engine,settings,bookmarks,refresh]);

  /** Save the ghost buffer as a recording. */
  const saveGhostRecording = useCallback(async()=>{
    const result = await engine.saveGhost(settings.ghostSec);
    if (!result || result.samples.length < result.sampleRate * 0.5) {
      setError('Not enough buffered audio yet — listen for at least 5 seconds first.');
      return null;
    }
    const wav = encodeWav([result.samples], result.sampleRate, settings.bitDepth);
    const rec: Recording = {
      id:newId(), title:`Ghost — ${defaultTitle()}`, createdAt:Date.now(),
      durationSec:result.samples.length/result.sampleRate, sampleRate:result.sampleRate,
      bitDepth:settings.bitDepth, sizeBytes:wav.byteLength,
      audio:new Blob([wav],{type:'audio/wav'}),
      bookmarks:[], voiceProfileId:settings.activeVoiceId, transcript:null, transcriptStatus:'none',
    };
    try{await saveRecording(rec);}
    catch{setError('Storage full — could not save.');return null;}
    await refresh();
    if(settings.autoTranscribe) enqueueTranscription(rec.id,settings.transcribeModel,settings.language).then(refresh);
    return rec;
  },[engine,settings,refresh]);

  // Ghost buffer availability ticker
  useEffect(()=>{
    if(!live) return;
    const id = setInterval(()=>{
      // Approximate based on time since startLive — actual data in worklet
      setGhostAvailSec((prev)=>Math.min(settings.ghostSec, prev + 0.5));
    },500);
    return ()=>clearInterval(id);
  },[live, settings.ghostSec]);

  useEffect(()=>{
    if(!live) setGhostAvailSec(0);
  },[live]);

  // VAD (Voice Activity Detection) — auto-record trip wire
  useEffect(()=>{
    if(!live || !settings.vadEnabled){
      if(vadTickRef.current){clearInterval(vadTickRef.current);vadTickRef.current=null;}
      vadRef.current?.reset();
      setVadActive(false);
      return;
    }
    const vad = new VAD({
      sampleRate: engine.sampleRate,
      sensitivity: settings.vadSensitivity,
      silenceTimeoutMs: settings.vadSilenceTimeoutSec * 1000,
    });
    vad.onVoiceStart = ()=>{
      setVadActive(true);
      if(!recording){ engine.startRecording();setRecording(true);setRecordStartedAt(Date.now());setBookmarks([]); }
    };
    vad.onVoiceSilence = ()=>{
      setVadActive(false);
      if(recording){
        engine.stopRecording().then(async(samples)=>{
          setRecording(false);setRecordStartedAt(null);
          if(samples.length < engine.sampleRate*0.5) return;
          const wav=encodeWav([samples],engine.sampleRate,settings.bitDepth);
          const rec: Recording={
            id:newId(),title:defaultTitle(),createdAt:Date.now(),durationSec:samples.length/engine.sampleRate,
            sampleRate:engine.sampleRate,bitDepth:settings.bitDepth,sizeBytes:wav.byteLength,
            audio:new Blob([wav],{type:'audio/wav'}),bookmarks:[],voiceProfileId:settings.activeVoiceId,
            transcript:null,transcriptStatus:'none',
          };
          try{await saveRecording(rec);}catch{return;}
          await refresh();
          if(settings.autoTranscribe) enqueueTranscription(rec.id,settings.transcribeModel,settings.language).then(refresh);
        });
      }
    };
    vadRef.current=vad;
    vadTickRef.current=setInterval(()=>{
      const buf=engine.getAnalyserBuffer();
      if(buf) vad.processAnalyserBuffer(buf);
    },100);
    return ()=>{
      if(vadTickRef.current){clearInterval(vadTickRef.current);vadTickRef.current=null;}
      vad.reset();
    };
  },[live, settings.vadEnabled, settings.vadSensitivity, settings.vadSilenceTimeoutSec, engine, recording, settings, refresh]);

  useEffect(()=>{
    const onHide=()=>{if(document.hidden&&engine.monitoring&&!engine.recording){engine.setMonitoring(false);setMonitoring(false);}};
    document.addEventListener('visibilitychange',onHide);
    return ()=>document.removeEventListener('visibilitychange',onHide);
  },[engine]);

  const value: Store = {
    settings,setSettings,setEngine,engine,live,monitoring,recording,recordStartedAt,bookmarks,error,
    startLive,stopLive,toggleMonitor,startRecording,stopRecording,addBookmark,
    saveGhostRecording,ghostAvailSec,vadActive,
    recordings,voices,refresh,downloadProgress,activeVoice,usingTestSignal,setTestSignal,notice,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
