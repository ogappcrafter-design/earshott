import { useState } from 'react';
import { useStore } from '../state/store';
import { Slider, Toggle } from './Controls';
import { formatTime } from './format';
import { sfx } from './sfx';
import type { HumFilter, AudioZoom } from '../audio/engine';

interface SpyPanelProps {
  onStealth: () => void;
  onGhostSave: () => Promise<void>;
  ghostAvailSec: number;
  vadActive: boolean;
  toast: (t:string, k?:'ok'|'err') => void;
}

export function SpyPanel({ onStealth, onGhostSave, ghostAvailSec, vadActive, toast }: SpyPanelProps) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const e = s.settings.engine;

  const handleGhost = async () => {
    if (saving) return;
    setSaving(true);
    sfx.on();
    try { await onGhostSave(); }
    finally { setSaving(false); }
  };

  const ZoomBtn = ({ z, label }: { z: AudioZoom; label: string }) => (
    <button type="button"
      className={`seg-btn${e.audioZoom===z?' is-on':''}`}
      onClick={() => { sfx.tap(); s.setEngine({ audioZoom: z }); }}
    >{label}</button>
  );

  const HumBtn = ({ h, label }: { h: HumFilter; label: string }) => (
    <button type="button"
      className={`seg-btn${e.humFilter===h?' is-on':''}`}
      onClick={() => { sfx.tap(); s.setEngine({ humFilter: h }); }}
    >{label}</button>
  );

  return (
    <div className="spy-panel">
      <button
        id="tour-stealth"
        type="button"
        className="spy-panel__toggle"
        onClick={() => { sfx.tap(); setOpen((x)=>!x); }}
        aria-expanded={open}
      >
        <span className="spy-panel__icon">🎯</span>
        <span>Spy tools</span>
        {vadActive && <span className="spy-badge spy-badge--vad">LIVE</span>}
        {s.settings.boostMode && <span className="spy-badge spy-badge--boost">80dB</span>}
        <span className={`spy-panel__chevron${open?' is-open':''}`}>▾</span>
      </button>

      {open && (
        <div className="spy-panel__body">

          {/* ── Signal Boost ── */}
          <div className="spy-row">
            <Toggle
              label="Signal Boost"
              checked={s.settings.boostMode}
              onChange={(v) => {
                sfx.tap();
                s.setSettings((x)=>({...x, boostMode:v}));
                if (v) toast('80 dB mode on — be careful with headphones', 'ok');
              }}
              hint={s.settings.boostMode ? 'Gain slider goes to 80 dB. Use with caution.' : 'Unlocks gain up to 80 dB'}
            />
          </div>

          {/* ── Spectral Denoiser ── */}
          <Slider
            label="Spectral denoiser"
            value={Math.round(e.spectralAmount*100)}
            min={0} max={100} step={5}
            onChange={(v) => s.setEngine({ spectralAmount: v/100 })}
            format={(v) => `${v}%`}
            hint="STFT Wiener filter — strips steady hiss/noise before the gate."
          />

          {/* ── Mains Hum Notch ── */}
          <div className="spy-row spy-row--labeled">
            <span className="spy-row__label">Hum notch</span>
            <div className="seg">
              <HumBtn h="off"   label="Off" />
              <HumBtn h="50hz"  label="50 Hz" />
              <HumBtn h="60hz"  label="60 Hz" />
            </div>
          </div>

          {/* ── Audio Zoom ── */}
          <div className="spy-row spy-row--labeled">
            <span className="spy-row__label">Audio zoom</span>
            <div className="seg">
              <ZoomBtn z="off"  label="Flat" />
              <ZoomBtn z="near" label="Near" />
              <ZoomBtn z="mid"  label="Mid"  />
              <ZoomBtn z="far"  label="Far"  />
            </div>
          </div>
          {e.audioZoom!=='off' && (
            <p className="fine" style={{margin:0}}>
              {e.audioZoom==='near' && 'Mild clarity boost for conversations in the same room.'}
              {e.audioZoom==='mid'  && 'Cuts rumble & air, pushes speech at 3–10 m range.'}
              {e.audioZoom==='far'  && 'Aggressive mid-focus — pulls speech out at 10 m+.'}
            </p>
          )}

          {/* ── Ghost Save ── */}
          <div className="spy-row spy-row--ghost">
            <div>
              <strong style={{fontSize:'.9rem'}}>Ghost Save</strong>
              <p className="fine" style={{margin:'2px 0 0'}}>
                {ghostAvailSec > 1
                  ? `${formatTime(ghostAvailSec)} buffered — saves what already happened`
                  : 'Buffer fills after ~5 s of listening'}
              </p>
            </div>
            <button
              id="tour-ghost"
              type="button"
              className={`btn btn--primary spy-ghost-btn${saving?' is-loading':''}`}
              disabled={saving || ghostAvailSec < 1}
              onClick={handleGhost}
            >
              {saving ? '…' : `Save last ${Math.round(Math.min(s.settings.ghostSec, ghostAvailSec))} s`}
            </button>
          </div>

          <div className="spy-row spy-row--labeled" style={{alignItems:'center',gap:8}}>
            <span className="spy-row__label">Ghost buffer length</span>
            <div className="seg">
              {([15,30,45] as const).map((sec)=>(
                <button key={sec} type="button"
                  className={`seg-btn${s.settings.ghostSec===sec?' is-on':''}`}
                  onClick={()=>{sfx.tap();s.setSettings((x)=>({...x,ghostSec:sec}));}}>
                  {sec}s
                </button>
              ))}
            </div>
          </div>

          {/* ── Trip Wire (VAD Auto-Record) ── */}
          <div id="tour-vad">
            <Toggle
              label="Trip Wire"
              checked={s.settings.vadEnabled}
              onChange={(v) => {
                sfx.tap();
                s.setSettings((x)=>({...x, vadEnabled:v}));
                if (v) toast('Auto-record on — it\'ll start when it hears something');
              }}
              hint="Records automatically when it detects a voice. Stops on sustained silence."
            />
          </div>
          {s.settings.vadEnabled && (
            <>
              <Slider
                label="Trigger sensitivity"
                value={Math.round(s.settings.vadSensitivity*100)}
                min={10} max={100} step={5}
                onChange={(v)=>s.setSettings((x)=>({...x,vadSensitivity:v/100}))}
                format={(v)=>`${v}%`}
                hint="Higher = triggers on quieter sounds."
              />
              <Slider
                label="Stop after silence"
                value={s.settings.vadSilenceTimeoutSec}
                min={1} max={10} step={0.5}
                onChange={(v)=>s.setSettings((x)=>({...x,vadSilenceTimeoutSec:v}))}
                format={(v)=>`${v} s`}
                hint="Seconds of silence before recording stops."
              />
            </>
          )}

          {/* ── Stealth Launch ── */}
          <button
            type="button"
            className="btn btn--ghost spy-stealth-btn"
            onClick={() => { sfx.off(); setOpen(false); onStealth(); }}
          >
            🌑 Go Stealth
          </button>
          <p className="fine center" style={{margin:'0 0 4px'}}>Screen blacks out. Recording continues invisibly.</p>
        </div>
      )}
    </div>
  );
}
