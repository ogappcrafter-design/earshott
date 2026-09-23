import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sfx } from './sfx';

export function Slider({ id, label, value, min, max, step = 1, onChange, format, hint }: { id?: string;
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string; hint?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label id={id} className="slider">
      <span className="slider__row"><span>{label}</span><span className="slider__val">{format ? format(value) : value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="slider__hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle"
      onClick={() => { sfx.tap(); onChange(!checked); }}>
      <span className="toggle__text"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className={`toggle__track${checked ? ' is-on' : ''}`}><span className="toggle__thumb" /></span>
    </button>
  );
}

export function Button({ children, onClick, variant = 'primary', disabled, icon, busy }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: ReactNode; busy?: boolean;
}) {
  return (
    <button type="button" className={`btn btn--${variant}`} disabled={disabled || busy}
      onClick={() => { sfx.tap(); onClick?.(); }}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
}

export interface ToastMsg { id: number; text: string; kind: 'ok' | 'err' }
export function Toasts({ items }: { items: ToastMsg[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast--${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function Confirm({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [open]);
  if (!open) return null;
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{body}</p>
        <div className="dialog__actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const push = (text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    (kind === 'ok' ? sfx.success : sfx.error)();
    setItems((s) => [...s, { id, text, kind }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  };
  return { items, push };
}

export function EmptyState({ art, title, body, action }: { art: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__art">{art}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}
