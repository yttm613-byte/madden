/* neural4d-gen.mjs — generate a player GLB from PLAYER_MODEL_PROMPT.md via Neural4D.
 *
 *   N4D_API_KEY=sk-... node tools/neural4d-gen.mjs [out.glb]
 *
 * Sends the spec verbatim (the "## THE PROMPT" section of PLAYER_MODEL_PROMPT.md —
 * every line of it exists because the current free asset violated it), polls until
 * the job finishes, and writes the .glb. Grade the result with tools/adopt-model.mjs
 * before wiring it into the game.
 *
 * Zero dependencies: Node 18+ global fetch. The repo's npm deps are unavailable when
 * registry.npmjs.org is outside the sandbox egress allowlist, and this step must work
 * regardless of that.
 *
 * Neural4D publishes its contract as a dashboard PDF of page images, so the layout
 * below was read out of their own web client instead (the Nuxt runtime config names
 * BASE_URL and GENERATE_BASE_URL, and the bundles call the /models/* routes). Note
 * the port: the whole API is on :3000, which is why every path 404s on :443.
 * Override N4D_BASE / N4D_GEN_PATH / N4D_STATUS_PATH if they move.
 */
import fs from 'fs';
import path from 'path';

const KEY = process.env.N4D_API_KEY;
if (!KEY) { console.error('N4D_API_KEY is not set — get one at https://www.neural4d.com/api'); process.exit(1); }

const BASE        = process.env.N4D_BASE        || 'https://alb.neural4d.com:3000';
// Two surfaces exist and only one key type reaches each: the developer API documented
// on the blog, and the /models/* routes their own web client uses. Try both rather
// than betting on one — a wrong guess here costs a confusing 404, not a failed model.
const GEN_PATHS   = (process.env.N4D_GEN_PATH    || '/api/generateModelWithText,/models/generate').split(',');
const STATUS_PATH = process.env.N4D_STATUS_PATH || '/models/checkModelConversionStatus';
const DL_PATH     = process.env.N4D_DL_PATH     || '/models/getModelDownloading';
const OUT         = process.argv[2] || 'assets/fbplayer_src.glb';
const SPEC        = process.env.N4D_SPEC        || 'PLAYER_MODEL_PROMPT.md';
const POLL_MS     = +(process.env.N4D_POLL_MS   || 10000);
const TIMEOUT_MS  = +(process.env.N4D_TIMEOUT_MS|| 15 * 60 * 1000);

// ---- the prompt ------------------------------------------------------------------
// Everything between "## THE PROMPT" and the "## WHY EACH LINE IS THERE" rationale
// table. The rationale is for humans arguing with the generator, not for the generator.
const md = fs.readFileSync(SPEC, 'utf8');
const m = md.match(/## THE PROMPT\s*\n([\s\S]*?)\n---\s*\n\s*## WHY EACH LINE/);
if (!m) { console.error(`could not find the "## THE PROMPT" section in ${SPEC}`); process.exit(1); }
const prompt = m[1].replace(/^\s*---\s*$/gm, '').trim();
console.log(`prompt: ${prompt.length} chars from ${SPEC}`);

const headers = { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function jsonOrThrow(res, what) {
  const body = await res.text();
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${body.slice(0, 400)}`);
  try { return JSON.parse(body); }
  catch { throw new Error(`${what}: expected JSON, got ${body.slice(0, 200)}`); }
}

// Response shapes vary by provider version; dig for the fields we need rather than
// pinning one layout and breaking on the next release.
const dig = (o, re, depth = 0) => {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(o)) {
    if (re.test(k) && (typeof v === 'string' || typeof v === 'number')) return String(v);
    const hit = dig(v, re, depth + 1);
    if (hit) return hit;
  }
  return null;
};

// ---- submit ----------------------------------------------------------------------
let submitted = null;
for (const p of GEN_PATHS) {
  console.log(`POST ${BASE}${p}`);
  let res;
  try {
    res = await fetch(BASE + p, {
      method: 'POST', headers,
      body: JSON.stringify({ prompt, modelCount: 1, disablePbr: 0 }),
    });
  } catch (e) {
    const code = (e.cause && e.cause.code) || e.message;
    const port = new URL(BASE).port;
    console.error(`\ncannot reach ${BASE} (${code})`);
    if (port && port !== '443')
      console.error(`The whole Neural4D API is on port ${port}. Sandboxes that allow only 443\n` +
                    `reach the host but not the API — allow ${new URL(BASE).hostname}:${port} in the\n` +
                    `environment's network egress settings, or run this where that port is open.`);
    process.exit(1);
  }
  if (res.status === 404) { console.log('  404 — not this surface, trying the next'); continue; }
  submitted = await jsonOrThrow(res, 'generate');
  break;
}
if (!submitted) { console.error(`no generate endpoint answered on ${BASE} — tried ${GEN_PATHS.join(', ')}`); process.exit(1); }

const uuid = dig(submitted, /^(uuid|id|taskId|task_id|jobId)$/i);
if (!uuid) { console.error('no job id in response:', JSON.stringify(submitted).slice(0, 600)); process.exit(1); }
console.log(`job ${uuid} — generation is advertised at under 90s, polling every ${POLL_MS / 1000}s`);

// ---- poll ------------------------------------------------------------------------
const started = Date.now();
let url = null;
while (!url) {
  if (Date.now() - started > TIMEOUT_MS) { console.error(`timed out after ${TIMEOUT_MS / 1000}s`); process.exit(1); }
  await new Promise(r => setTimeout(r, POLL_MS));
  // Their web client polls this as a POST carrying modelIds; the documented developer
  // surface takes a uuid on the query string. Try the POST, fall back to the GET.
  let res = await fetch(BASE + STATUS_PATH, {
    method: 'POST', headers, body: JSON.stringify({ modelIds: [uuid], modelSize: 2 }),
  });
  if (res.status === 404 || res.status === 405)
    res = await fetch(`${BASE}${STATUS_PATH}?uuid=${encodeURIComponent(uuid)}`, { headers });
  const st = await jsonOrThrow(res, 'status');
  const state = dig(st, /^(status|state)$/i) || '?';
  let found = dig(st, /glb|modelUrl|model_url|downloadUrl|fileUrl/i);
  // A finished job may only expose its file through the download route.
  if (!found && /(succe|finish|done|complete)/i.test(state)) {
    const dl = await fetch(BASE + DL_PATH, {
      method: 'POST', headers, body: JSON.stringify({ modelIds: [uuid], modelSize: 2 }),
    });
    if (dl.ok) found = dig(await dl.json().catch(() => ({})), /glb|url/i);
  }
  console.log(`  [${((Date.now() - started) / 1000).toFixed(0)}s] ${state}`);
  if (found && /^https?:\/\//.test(found)) url = found;
  else if (/fail|error|cancel/i.test(state)) { console.error('job failed:', JSON.stringify(st).slice(0, 600)); process.exit(1); }
}

// ---- download --------------------------------------------------------------------
console.log(`GET ${url}`);
const dl = await fetch(url);
if (!dl.ok) { console.error(`download: HTTP ${dl.status}`); process.exit(1); }
const buf = Buffer.from(await dl.arrayBuffer());
if (buf.slice(0, 4).toString('latin1') !== 'glTF') {
  console.error(`not a GLB — magic was ${JSON.stringify(buf.slice(0, 4).toString('latin1'))}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, buf);
console.log(`\nwrote ${OUT} — ${(buf.length / 1e6).toFixed(2)}MB`);
console.log(`next: node tools/adopt-model.mjs ${OUT}`);
