/**
 * Earshot email backup. The phone uploads one zip part per request; this forwards it to Resend as an email.
 * Locked down two ways: a shared key (EARSHOT_BACKUP_KEY) and a fixed recipient (EARSHOT_EMAIL_TO), so it can't be used to email anyone else.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-earshot-key, x-part, x-parts, x-title, x-filename, x-transcript',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  const key = process.env.EARSHOT_BACKUP_KEY, to = process.env.EARSHOT_EMAIL_TO, resend = process.env.RESEND_API_KEY;
  if (!key || !to || !resend) return json(500, { ok: false, error: 'Email backup is not set up on the server yet.' });
  if (req.headers.get('x-earshot-key') !== key) return json(401, { ok: false, error: 'Wrong backup key. Check Settings → Email backup.' });

  const part = Number(req.headers.get('x-part') ?? 1), parts = Number(req.headers.get('x-parts') ?? 1);
  const title = decodeURIComponent(req.headers.get('x-title') ?? 'Recording').slice(0, 120);
  const filename = decodeURIComponent(req.headers.get('x-filename') ?? 'recording.zip').replace(/[^\w.\- ]/g, '_');
  const transcript = decodeURIComponent(req.headers.get('x-transcript') ?? '');
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return json(400, { ok: false, error: 'Empty upload.' });

  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
  const subject = parts > 1 ? `Earshot: ${title} (part ${part} of ${parts})` : `Earshot: ${title}`;
  const html = `<p>${esc(title)}${parts > 1 ? ` · part ${part} of ${parts}` : ''}</p>` +
    (transcript ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(transcript)}</pre>` : part === 1 ? '<p><i>No transcript.</i></p>' : '');

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resend}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EARSHOT_EMAIL_FROM ?? 'Earshot <onboarding@resend.dev>', to: [to], subject, html,
      attachments: [{ filename, content: Buffer.from(bytes).toString('base64') }],
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out.id) return json(502, { ok: false, error: out.message ?? `Email service said ${r.status}` });
  return json(200, { ok: true, id: out.id });
}
