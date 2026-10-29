import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/600.css';
import './styles.css';
import App from './App';
import { CrashGuard } from './ui/CrashGuard';

// Catch errors outside React too, so one bad frame doesn't take the page down
window.addEventListener('unhandledrejection', (e) => { console.warn('Unhandled', e.reason); e.preventDefault(); });

createRoot(document.getElementById('root')!).render(<StrictMode><CrashGuard><App /></CrashGuard></StrictMode>);

// Black box recorder: if the app dies, Settings → Diagnostics shows the last things it did
import { logError } from './storage/db';
window.addEventListener('error', (e) => logError('window.error', e.error ?? e.message));
document.addEventListener('visibilitychange', () => logError('visibility', document.visibilityState));
// Crash reports go to the developer automatically (state snapshot every 4 s instead of filling the log)
import { startCrashWatch } from './storage/report';
startCrashWatch();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => undefined);
