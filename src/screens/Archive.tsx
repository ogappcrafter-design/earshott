import { useMemo, useState } from 'react';
import { searchRecordings } from '../storage/db';
import { useStore } from '../state/store';
import { WordArt } from '../ui/WordArt';
import { EmptyState } from '../ui/Controls';
import { IconArchive, IconSearch } from '../ui/Icons';
import { formatBytes, formatTime } from '../ui/format';

const statusText = { none: 'No transcript', queued: 'Waiting to transcribe', working: 'Transcribing…', done: 'Transcript ready', failed: 'Transcript failed' } as const;

export function Archive({ onOpen }: { onOpen: (id: string) => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const list = useMemo(() => searchRecordings(s.recordings, q), [s.recordings, q]);
  return (
    <div className="screen">
      <header className="screen__head"><WordArt text="Archive" /></header>
      {s.downloadProgress !== null && (
        <div className="banner">Downloading the transcriber, one time only: {Math.round(s.downloadProgress)}%</div>
      )}
      {s.recordings.length > 0 && (
        <label className="search"><IconSearch size={18} />
          <input type="search" value={q} placeholder="Search titles and transcripts" onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {s.recordings.length === 0 ? (
        <EmptyState art={<IconArchive size={56} />} title="Nothing recorded yet"
          body="Tap the red button on the Listen tab. Every recording lands here with its transcript." />
      ) : list.length === 0 ? (
        <p className="fine">No recordings match “{q}”.</p>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id}>
              <button type="button" className="card rec-card" onClick={() => onOpen(r.id)}>
                <div className="rec-card__wave" aria-hidden="true">
                  {Array.from({ length: 14 }, (_, i) => <i key={i} style={{ height: `${25 + ((r.createdAt / (i + 3)) % 70)}%` }} />)}
                </div>
                <div className="rec-card__main">
                  <strong>{r.title}</strong>
                  <small>{formatTime(r.durationSec)} long, {formatBytes(r.sizeBytes)}</small>
                  <small className={`status status--${r.transcriptStatus}`}>{statusText[r.transcriptStatus]}</small>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
