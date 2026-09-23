import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteRecording, patchRecording } from '../storage/db';
import { audioFileName, saveToDevice, shareFile, transcriptFileName, transcriptToText } from '../storage/export';
import { enqueueTranscription } from '../transcribe/queue';
import { useStore } from '../state/store';
import { Button, Confirm } from '../ui/Controls';
import { IconBack, IconBookmark, IconPause, IconPlay, IconSave, IconShare, IconText, IconTrash } from '../ui/Icons';
import { formatBytes, formatTime } from '../ui/format';
import { WordArt } from '../ui/WordArt';
import { IS_TESTER } from '../demo';

export function Detail({ id, onBack, toast }: { id: string; onBack: () => void; toast: (t: string, k?: 'ok' | 'err') => void }) {
  const s = useStore();
  const rec = s.recordings.find((r) => r.id === id);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [title, setTitle] = useState(rec?.title ?? '');
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const url = useMemo(() => (rec ? URL.createObjectURL(rec.audio) : ''), [rec?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { if (rec) setTitle(rec.title); }, [rec?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rec) return (
    <div className="screen"><Button variant="ghost" icon={<IconBack />} onClick={onBack}>Archive</Button><p>This recording was deleted.</p></div>
  );

  const seek = (t: number) => { if (audio.current) { audio.current.currentTime = t; audio.current.play(); } };
  const commitTitle = async () => {
    const t = title.trim();
    if (t && t !== rec.title) { await patchRecording(rec.id, { title: t }); await s.refresh(); toast('Renamed'); }
    else setTitle(rec.title);
  };
  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast(typeof r === 'string' ? `${ok} ${r}` : ok); }
    catch (e) { if (!/cancel/i.test((e as Error)?.message ?? '')) toast('That didn’t work. Check storage space and try again.', 'err'); }
    finally { setBusy(null); }
  };
  const activeChunk = rec.transcript?.chunks.findIndex((c) => pos >= c.start && pos < (c.end || c.start + 5)) ?? -1;

  return (
    <div className="screen detail">
      <header className="detail__top">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to archive"><IconBack /></button>
        <WordArt text="Recording" size={28} />
      </header>
      <input className="title-input" value={title} aria-label="Recording title" onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <p className="fine">{new Date(rec.createdAt).toLocaleString()}. {formatTime(rec.durationSec)}, {rec.bitDepth}-bit {rec.sampleRate / 1000} kHz WAV, {formatBytes(rec.sizeBytes)}.</p>

      <div className="player">
        <button type="button" className="play-btn" aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}>{playing ? <IconPause /> : <IconPlay />}</button>
        <div className="player__track">
          <input type="range" min={0} max={rec.durationSec} step={0.1} value={pos} aria-label="Playback position"
            style={{ ['--pct' as string]: `${(pos / rec.durationSec) * 100}%` }}
            onChange={(e) => { const t = Number(e.target.value); setPos(t); if (audio.current) audio.current.currentTime = t; }} />
          {rec.bookmarks.map((b, i) => (
            <button key={i} type="button" className="player__mark" style={{ left: `${(b / rec.durationSec) * 100}%` }}
              aria-label={`Jump to bookmark at ${formatTime(b)}`} onClick={() => seek(b)}><IconBookmark size={14} /></button>
          ))}
          <div className="player__times"><span>{formatTime(pos)}</span><span>{formatTime(rec.durationSec)}</span></div>
        </div>
        <audio ref={audio} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} />
      </div>

      <div className="action-row">
        <Button variant="ghost" icon={<IconShare />} busy={busy === 'share'}
          onClick={() => run('share', () => shareFile(rec.audio, audioFileName(rec), rec.title))}>Share audio</Button>
        <Button variant="ghost" icon={<IconSave />} busy={busy === 'save'}
          onClick={() => run('save', () => saveToDevice(rec.audio, audioFileName(rec)), 'Saved to')}>Save to phone</Button>
      </div>

      <section className="transcript">
        <div className="transcript__head">
          <WordArt text="Transcript" size={24} />
          {rec.transcriptStatus === 'done' && (
            <button type="button" className="icon-btn" aria-label="Share transcript"
              onClick={() => run('tshare', () => shareFile(new Blob([transcriptToText(rec)], { type: 'text/plain' }), transcriptFileName(rec), rec.title))}>
              <IconText /></button>
          )}
        </div>
        {rec.transcriptStatus === 'done' && rec.transcript ? (
          rec.transcript.chunks.length ? (
            <ol className="transcript__lines">
              {rec.transcript.chunks.map((c, i) => (
                <li key={i} className={i === activeChunk ? 'is-now' : ''}>
                  <button type="button" onClick={() => seek(c.start)}><time>{formatTime(c.start)}</time><span>{c.text.trim()}</span></button>
                </li>
              ))}
            </ol>
          ) : <p>{rec.transcript.text || 'No speech was detected in this recording.'}</p>
        ) : rec.transcriptStatus === 'working' || rec.transcriptStatus === 'queued' ? (
          <div className="transcript__busy"><span className="spinner" /> {rec.transcriptStatus === 'working' ? 'Transcribing on your phone. Longer recordings take a few minutes.' : 'Waiting in line…'}</div>
        ) : (
          <>
            {rec.transcriptStatus === 'failed' && <p className={`banner${IS_TESTER ? '' : ' banner--err'}`}>{rec.transcriptError}</p>}
            {!IS_TESTER && <Button icon={<IconText />} onClick={() => { enqueueTranscription(rec.id, s.settings.transcribeModel, s.settings.language).then(s.refresh); }}>
              {rec.transcriptStatus === 'failed' ? 'Try again' : 'Transcribe'}</Button>}
          </>
        )}
        <p className="fine">Transcripts are a best guess made on your phone. Your audio never leaves your phone.</p>
      </section>

      <Button variant="danger" icon={<IconTrash />} onClick={() => setConfirmDel(true)}>Delete recording</Button>
      <Confirm open={confirmDel} title="Delete this recording?" body="The audio and transcript are removed from Earshot. Copies you saved or shared are not affected."
        confirmLabel="Delete recording" danger onCancel={() => setConfirmDel(false)}
        onConfirm={async () => { await deleteRecording(rec.id); await s.refresh(); toast('Recording deleted'); onBack(); }} />
    </div>
  );
}
