import { useEffect, useState } from 'react';
import { Scope, type ScopeSnapshot } from '../ui/Scope';
import { fmtHz, type Source } from '../audio/sources';
import { MAX_MUTES } from '../audio/engine';
import { newId, saveVoice } from '../storage/db';
import { useStore } from '../state/store';
import { Sieve } from '../ui/Sieve';
import { WordArt } from '../ui/WordArt';
import { Confirm, Slider } from '../ui/Controls';
import { IconBookmark, IconHeadphones } from '../ui/Icons';
import { formatTime } from '../ui/format';
import { sfx } from '../ui/sfx';
import { Toggle } from '../ui/Controls';
import { IS_TESTER } from '../demo';
import { SpyPanel } from '../ui/SpyPanel';

export function Listen({ toast }: { toast: (t:string, k?:'ok'|'err')=>void }) {
  const s = useStore();
  const [elapsed, setElapsed] = useState(0);
  const [askHeadphones, setAskHeadphones] = useState(false);
  const [stealth, setStealth] = useState(false);
  const e = s.settings.engine;
  const view = s.settings.listenView;
  const [picked, setPicked] = useState<Source|null>(null);
  const [, setSnap] = useState<ScopeSnapshot>({voices:[],bands:[]});
  const [naming, setNaming] = useState<string|null>(null);

  const lockOn = (src: Source) => {
    sfx.on();
    const lock = src.kind==='voice'
      ? {kind:'voice' as const,label:src.label,lowHz:src.lowHz,medianHz:src.medianHz,highHz:src.highHz,hue:src.hue}
      : {kind:'band' as const,label:src.label,lowHz:src.lowHz,highHz:src.highHz,peakHz:src.peakHz};
    s.setEngine({lock,voiceFocus:Math.max(0.8,e.voiceFocus)});
    toast(`Locked on ${src.label}`); setPicked(null);
  };
  const mute = (src: Source) => {
    if(e.mutes.length>=MAX_MUTES){toast(`You can mute up to ${MAX_MUTES} sounds. Unmute one first.`,'err');return;}
    const lo=src.kind==='voice'?src.lowHz*0.8:src.lowHz, hi=src.kind==='voice'?src.highHz*3:src.highHz;
    const center=Math.sqrt(lo*hi);
    s.setEngine({mutes:[...e.mutes,{label:src.label,centerHz:center,q:Math.max(0.7,center/Math.max(1,hi-lo))}]});
    sfx.off(); toast(`${src.label} muted`); setPicked(null);
  };
  const saveVoiceFrom = async(src:Source,name:string)=>{
    if(src.kind!=='voice'||!name.trim()) return;
    await saveVoice({id:newId(),name:name.trim(),lowHz:src.lowHz,medianHz:src.medianHz,highHz:src.highHz,createdAt:Date.now(),colorHue:src.hue});
    await s.refresh(); setNaming(null); toast(`${name.trim()} saved to Voices`);
  };

  useEffect(()=>{
    if(!s.recordStartedAt){setElapsed(0);return;}
    const id=setInterval(()=>setElapsed((Date.now()-s.recordStartedAt!)/1000),250);
    return ()=>clearInterval(id);
  },[s.recordStartedAt]);

  const monitor = () => {
    if(!s.monitoring&&!s.settings.headphoneAck){setAskHeadphones(true);return;}
    (s.monitoring?sfx.off:sfx.on)();
    s.toggleMonitor();
  };
  const record = async() => {
    if(s.recording){const r=await s.stopRecording();if(r) toast(`Saved to your archive (${formatTime(r.durationSec)})`);}
    else{sfx.on();await s.startRecording();}
  };

  const handleGhostSave = async() => {
    const r = await s.saveGhostRecording();
    if(r) toast(`Ghost saved — ${formatTime(r.durationSec)} to archive`, 'ok');
  };

  // Gain slider max depends on boost mode
  const gainMax = s.settings.boostMode ? 80 : 30;

  return (
    <div className="screen listen">
      <header className="screen__head">
        <WordArt text="Listen" />
        {!e.lock&&s.activeVoice&&e.voiceFocus>0&&(
          <span className="chip" style={{['--hue' as string]:s.activeVoice.colorHue}}>Locked on {s.activeVoice.name}</span>
        )}
      </header>

      <div className="seg seg--view" role="radiogroup" aria-label="Visualizer" id="tour-soundmap">
        {(['sources','ring'] as const).map((v)=>(
          <button key={v} type="button" role="radio" aria-checked={view===v} className={view===v?'is-on':''}
            onClick={()=>{sfx.tap();s.setSettings((x)=>({...x,listenView:v}));}}>{v==='sources'?'Sound map':'Ring'}</button>
        ))}
      </div>

      {view==='ring' ? (
        <div className="listen__stage">
          <Sieve analyser={s.engine.analyser} active={s.live} focus={s.activeVoice} focusAmount={e.voiceFocus} />
          <button id="tour-power" type="button" className={`hear-btn${s.monitoring?' is-on':''}`} onClick={monitor}
            aria-pressed={s.monitoring} aria-label={s.monitoring?'Stop listening':'Start listening'}>
            <IconHeadphones size={36} />
            <span>{s.monitoring?'Listening':'Tap to hear'}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="scope-wrap">
            <Scope analyser={s.live?s.engine.rawAnalyser:null} active={s.live} sensitivity={s.settings.scopeSensitivity}
              lock={e.lock} mutes={e.mutes} selectedId={picked?.id??null}
              onSelect={(src)=>{sfx.tap();setPicked(src);setNaming(null);}} onSnapshot={setSnap} />
            {!s.live&&(
              <button type="button" className="scope-start" onClick={()=>{sfx.on();s.startLive();}}>
                <IconHeadphones size={28} /><span>Start the mic to map sounds</span>
              </button>
            )}
          </div>
          <p className="fine scope-help">Tap a sound to select it. Pinch to zoom, drag to scroll, double-tap to see everything.</p>
          {picked&&(
            <div className="pick-sheet" style={{['--hue' as string]:picked.kind==='voice'?picked.hue:45}}>
              <div className="pick-sheet__head">
                <strong>{picked.label}</strong>
                <small>{picked.kind==='voice'
                  ?`Voice-like sound around ${Math.round(picked.medianHz)} Hz`
                  :`Steady sound from ${fmtHz(picked.lowHz)} to ${fmtHz(picked.highHz)} Hz`}</small>
                <button type="button" className="icon-btn" aria-label="Close" onClick={()=>setPicked(null)}>×</button>
              </div>
              {naming!==null?(
                <div className="pick-sheet__name">
                  <input autoFocus maxLength={24} value={naming} placeholder="Whose voice is this?" onChange={(ev)=>setNaming(ev.target.value)} />
                  <button type="button" className="btn btn--primary" disabled={!naming.trim()} onClick={()=>saveVoiceFrom(picked,naming)}>Save</button>
                </div>
              ):(
                <div className="pick-sheet__actions">
                  <button type="button" className="btn btn--primary" onClick={()=>lockOn(picked)}>Lock on</button>
                  <button type="button" className="btn btn--ghost" onClick={()=>mute(picked)}>Mute it</button>
                  {picked.kind==='voice'&&<button type="button" className="btn btn--ghost" onClick={()=>setNaming('')}>Save voice</button>}
                </div>
              )}
            </div>
          )}
          <div className="lock-row">
            {e.lock&&(
              <button type="button" className="chip chip--lock" style={{['--hue' as string]:e.lock.kind==='voice'?e.lock.hue:160}}
                onClick={()=>{sfx.off();s.setEngine({lock:null});}} aria-label={`Unlock ${e.lock.label}`}>
                Locked: {e.lock.label} ×
              </button>
            )}
            {e.mutes.map((m,i)=>(
              <button key={i} type="button" className="chip chip--mute" aria-label={`Unmute ${m.label}`}
                onClick={()=>s.setEngine({mutes:e.mutes.filter((_,k)=>k!==i)})}>Muted: {m.label} ×</button>
            ))}
          </div>
          <button id="tour-power" type="button" className={`hear-pill${s.monitoring?' is-on':''}`} onClick={monitor} aria-pressed={s.monitoring}>
            <IconHeadphones size={22} /><span>{s.monitoring?'Listening':'Tap to hear'}</span>
          </button>
        </>
      )}

      {s.error&&<p className="banner banner--err" role="alert">{s.error}</p>}
      {s.notice&&!s.error&&<p className="banner">{s.notice}</p>}
      {s.settings.vadEnabled&&(
        <div className={`vad-status${s.vadActive?' vad-status--active':''}`}>
          <span className="vad-status__dot" />
          <span>{s.vadActive?'Voice detected — recording':'Trip Wire armed — listening…'}</span>
        </div>
      )}
      {IS_TESTER&&(
        <div className="panel panel--tester">
          <Toggle label="Test signal" checked={s.usingTestSignal} onChange={(v)=>s.setTestSignal(v)}
            hint="A fake noisy room with one talker. Flip Noise reduction and Clear speech on/off to hear the difference." />
        </div>
      )}

      {/* Recording bar */}
      <div className="rec-bar">
        <button type="button" className={`rec-btn${s.recording?' is-rec':''}`} onClick={record}
          aria-label={s.recording?'Stop recording':'Start recording'}><span /></button>
        <div className="rec-bar__info">
          <strong>{s.recording?formatTime(elapsed):'Record'}</strong>
          <small>{s.recording?`${s.bookmarks.length} bookmark${s.bookmarks.length===1?'':'s'}`:IS_TESTER?`${s.settings.bitDepth}-bit WAV`:`${s.settings.bitDepth}-bit WAV with transcript`}</small>
        </div>
        {s.recording&&(
          <button type="button" className="icon-btn" onClick={()=>{sfx.tap();s.addBookmark();}} aria-label="Bookmark this moment">
            <IconBookmark />
          </button>
        )}
      </div>

      {/* Main controls */}
      <section className="panel">
        <Slider id="tour-gain" label="Volume boost" value={e.volumeDb} min={0} max={gainMax}
          onChange={(v)=>s.setEngine({volumeDb:v})}
          format={(v)=>`+${v} dB`}
          hint={s.settings.boostMode&&e.volumeDb>30?'⚠ High gain — use carefully with headphones':''}
        />
        {view==='sources'&&(
          <Slider label="Map sensitivity" value={Math.round(s.settings.scopeSensitivity*100)} min={0} max={100} step={5}
            onChange={(v)=>s.setSettings((x)=>({...x,scopeSensitivity:v/100}))} format={(v)=>`${v}%`}
            hint="Higher shows fainter sounds." />
        )}
        <div id="tour-nr">
          <Slider label="Noise reduction" value={Math.round(e.noiseReduction*100)} min={0} max={100} step={5}
            onChange={(v)=>s.setEngine({noiseReduction:v/100})} format={(v)=>`${v}%`} />
        </div>
        {s.voices.length>0?(
          <>
            <div className="voice-pick" role="radiogroup" aria-label="Voice to focus on">
              <button type="button" role="radio" aria-checked={!s.settings.activeVoiceId} className={!s.settings.activeVoiceId?'is-on':''}
                onClick={()=>s.setSettings((x)=>({...x,activeVoiceId:null}))}>Anyone</button>
              {s.voices.map((v)=>(
                <button key={v.id} type="button" role="radio" aria-checked={s.settings.activeVoiceId===v.id}
                  className={s.settings.activeVoiceId===v.id?'is-on':''} style={{['--hue' as string]:v.colorHue}}
                  onClick={()=>{s.setSettings((x)=>({...x,activeVoiceId:v.id}));if(e.voiceFocus===0) s.setEngine({voiceFocus:0.7});}}>
                  {v.name}
                </button>
              ))}
            </div>
            {(s.settings.activeVoiceId||e.lock)&&(
              <Slider label="Focus strength" value={Math.round(e.voiceFocus*100)} min={0} max={100} step={5}
                onChange={(v)=>s.setEngine({voiceFocus:v/100})} format={(v)=>`${v}%`} />
            )}
          </>
        ):e.lock?(
          <Slider label="Lock strength" value={Math.round(e.voiceFocus*100)} min={0} max={100} step={5}
            onChange={(v)=>s.setEngine({voiceFocus:v/100})} format={(v)=>`${v}%`} />
        ):<p className="fine">Tap a sound on the map, or add a voice on the Voices tab, to lock on.</p>}
      </section>

      {/* Spy Panel */}
      <SpyPanel
        onStealth={()=>setStealth(true)}
        onGhostSave={handleGhostSave}
        ghostAvailSec={s.ghostAvailSec}
        vadActive={s.vadActive}
        toast={toast}
      />

      {/* Stealth overlay */}
      {stealth&&(
        <StealthOverlay onExit={async()=>{
          setStealth(false);
          if(s.recording){
            const r=await s.stopRecording();
            if(r) toast(`Stealth recording saved (${formatTime(r.durationSec)})`,'ok');
          }
        }} recording={s.recording} recordStartedAt={s.recordStartedAt} />
      )}

      <Confirm open={askHeadphones} title="Earbuds in?"
        body="Live listening through the phone speaker causes loud feedback squeal. Use wired or USB-C earbuds for the least delay."
        confirmLabel="They're in" onCancel={()=>setAskHeadphones(false)}
        onConfirm={()=>{setAskHeadphones(false);s.setSettings((x)=>({...x,headphoneAck:true}));sfx.on();s.toggleMonitor();}} />
    </div>
  );
}

/* ── Stealth overlay (inline — minimal deps) ───────────────────────────── */
import { useCallback, useRef } from 'react';

function StealthOverlay({ onExit, recording, recordStartedAt }: {
  onExit: ()=>Promise<void>;
  recording: boolean;
  recordStartedAt: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [taps, setTaps] = useState(0);
  const [hint, setHint] = useState(false);
  const tapTimeout = useRef<ReturnType<typeof setTimeout>|null>(null);
  const wakeLock = useRef<unknown>(null);
  const exiting = useRef(false);

  useEffect(()=>{
    const acquire=async()=>{
      try{
        if('wakeLock' in navigator){
          wakeLock.current=await (navigator as any).wakeLock.request('screen');
        }
      }catch{/**/}
    };
    acquire();
    return ()=>{ (wakeLock.current as any)?.release?.().catch(()=>undefined); };
  },[]);

  useEffect(()=>{
    if(!recordStartedAt){setElapsed(0);return;}
    const id=setInterval(()=>setElapsed((Date.now()-recordStartedAt)/1000),1000);
    return()=>clearInterval(id);
  },[recordStartedAt]);

  const handleTap = useCallback(()=>{
    if(exiting.current) return;
    if(tapTimeout.current) clearTimeout(tapTimeout.current);
    setTaps((c)=>{
      const next=c+1;
      if(next>=3){
        exiting.current=true;
        onExit();
        return 0;
      }
      setHint(true);
      tapTimeout.current=setTimeout(()=>{setTaps(0);setHint(false);},1500);
      return next;
    });
  },[onExit]);

  return(
    <div className="stealth" onClick={handleTap} role="button" aria-label="Stealth — triple-tap to exit">
      <div className={`stealth__dot${recording?' stealth__dot--rec':''}`} />
      {recording&&<div className="stealth__timer">{formatTime(elapsed)}</div>}
      {hint&&<div className="stealth__hint">Triple-tap to exit{taps>=2?'…':''}</div>}
    </div>
  );
}
