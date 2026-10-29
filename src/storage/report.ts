import { readErrorLog } from './db';

/** Automatic crash reporting: if the app dies while open, the next launch sends its black-box log to the developer. */
const REPORT_URL = 'https://earshott.vercel.app/api/report';
const CRUMB = 'earshot.crumb.v1', SESS = 'earshot.sess.v1', PENDING = 'earshot.pendingReport.v1';
declare const __BUILD__: string;

let crumbSource: (() => Record<string, unknown>) | null = null;
/** The store tells us what the app is doing, so a crash report says what was happening at the time. */
export function setCrumbSource(fn: () => Record<string, unknown>) { crumbSource = fn; }

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

function crumb(): Record<string, unknown> {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  let extra: Record<string, unknown> = {};
  try { extra = crumbSource?.() ?? {}; } catch { /* ignore */ }
  return { at: Date.now(), visible: !document.hidden, heapMB: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
    heapLimitMB: m ? Math.round(m.jsHeapSizeLimit / 1048576) : null, ...extra };
}
const writeCrumb = () => set(CRUMB, JSON.stringify(crumb()));

async function post(body: string) {
  try {
    const r = await fetch(REPORT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true });
    if (!r.ok) throw new Error(String(r.status));
    try { localStorage.removeItem(PENDING); } catch { /* ignore */ }
  } catch { set(PENDING, body); } // offline: try again next launch
}

let sentThisSession = 0;
export function sendReport(reason: string, lastCrumb?: string | null) {
  if (sentThisSession >= 3) return;
  sentThisSession++;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  let parsedCrumb: unknown = null; try { parsedCrumb = lastCrumb ? JSON.parse(lastCrumb) : null; } catch { /* ignore */ }
  const body = JSON.stringify({
    reason, build: typeof __BUILD__ === 'string' ? __BUILD__ : 'dev', at: new Date().toISOString(),
    native: !!cap?.isNativePlatform?.(), ua: navigator.userAgent, deviceMemoryGB: nav.deviceMemory ?? null,
    cores: navigator.hardwareConcurrency ?? null, lastState: parsedCrumb, log: readErrorLog(),
  }).slice(0, 38_000);
  void post(body);
}

/** Call once at startup. */
export function startCrashWatch() {
  const pending = get(PENDING); if (pending) void post(pending);
  const prev = get(SESS), last = get(CRUMB);
  // "open" means the app was on screen and never got the chance to say goodbye: that's a crash
  if (prev === 'open') sendReport('closed-while-open', last);
  set(SESS, 'open');
  window.addEventListener('pagehide', () => { writeCrumb(); set(SESS, 'closed'); });
  document.addEventListener('visibilitychange', () => { writeCrumb(); set(SESS, document.hidden ? 'hidden' : 'open'); });
  window.addEventListener('error', (e) => { writeCrumb(); sendReport('js-error: ' + String(e.message).slice(0, 200), get(CRUMB)); });
  writeCrumb(); setInterval(writeCrumb, 4000);
}
