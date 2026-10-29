/**
 * Earshot crash reports. When the app dies, the next launch posts its black-box log here.
 * Nothing personal is sent (no audio, no transcripts): only the app's own event log and device basics.
 * Reports show up in this project's Vercel runtime logs, tagged EARSHOT_REPORT.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  const text = await req.text();
  if (!text || text.length > 40_000) return new Response('bad size', { status: 400, headers: CORS });
  try { JSON.parse(text); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  console.log('EARSHOT_REPORT ' + text);
  return new Response('ok', { status: 200, headers: CORS });
}
