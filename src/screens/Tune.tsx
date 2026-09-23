import { EQ_BANDS, EQ_MAX_DB, EQ_MIN_DB, EQ_PRESETS, formatHz } from '../audio/eq';
import { useStore } from '../state/store';
import { WordArt } from '../ui/WordArt';
import { Button, Slider, Toggle } from '../ui/Controls';

export function Tune({ onHearingCheck }: { onHearingCheck: () => void }) {
  const s = useStore();
  const e = s.settings.engine;
  const pick = (id: string, gains: number[]) => s.setSettings((x) => ({ ...x, eqPresetId: id, engine: { ...x.engine, eq: [...gains] } }));
  const setBand = (i: number, v: number) => {
    const eq = [...e.eq]; eq[i] = v;
    s.setSettings((x) => ({ ...x, eqPresetId: 'custom', engine: { ...x.engine, eq } }));
  };
  return (
    <div className="screen">
      <header className="screen__head"><WordArt text="Tune" /></header>
      <div className="presets" role="radiogroup" aria-label="EQ presets">
        {s.settings.hearingEq && (
          <button type="button" role="radio" aria-checked={s.settings.eqPresetId === 'hearing'}
            className={`preset preset--mine${s.settings.eqPresetId === 'hearing' ? ' is-on' : ''}`}
            onClick={() => pick('hearing', s.settings.hearingEq!)}>My ears</button>
        )}
        {EQ_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={s.settings.eqPresetId === p.id}
            className={`preset${s.settings.eqPresetId === p.id ? ' is-on' : ''}`} onClick={() => pick(p.id, p.gains)}>{p.name}</button>
        ))}
        {s.settings.eqPresetId === 'custom' && <span className="preset is-on" aria-current="true">Custom</span>}
      </div>

      <section className="eq" aria-label="10-band equalizer">
        {EQ_BANDS.map((hz, i) => (
          <label key={hz} className="eq__band">
            <span className="eq__val">{e.eq[i] > 0 ? '+' : ''}{e.eq[i]}</span>
            <input type="range" min={EQ_MIN_DB} max={EQ_MAX_DB} step={1} value={e.eq[i]}
              aria-label={`${formatHz(hz)} hertz`} onChange={(ev) => setBand(i, Number(ev.target.value))} />
            <span className="eq__hz">{formatHz(hz)}</span>
          </label>
        ))}
      </section>

      <section className="panel">
        <Slider label="Left / right balance" value={Math.round(e.balance * 100)} min={-100} max={100} step={5}
          onChange={(v) => s.setEngine({ balance: v / 100 })} format={(v) => (v === 0 ? 'Center' : v < 0 ? `Left ${-v}%` : `Right ${v}%`)} />
        <Slider label="Loudness ceiling" value={e.limiterDb} min={-24} max={0}
          onChange={(v) => s.setEngine({ limiterDb: v })} format={(v) => `${v} dB`}
          hint="Caps sudden loud sounds like dropped dishes. Lower is safer for your ears." />
        <Toggle label="Phone noise filter" checked={e.deviceNoiseSuppression}
          onChange={(v) => s.setEngine({ deviceNoiseSuppression: v })}
          hint="Uses your phone’s built-in filter on top of Earshot’s. Turn off for music." />
      </section>
      <Button variant="ghost" onClick={onHearingCheck}>{s.settings.hearingEq ? 'Redo tone check' : 'Build my ear curve'}</Button>
    </div>
  );
}
