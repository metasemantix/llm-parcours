import type { Env } from "../index.ts";

const NO_CACHE = { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" };
type Station = "trail" | "alias";
type Run = { id: string; station: Station; bits: string; state: "created" | "armed"; next_step: number; zero_token: string | null; one_token: string | null; read_token: string | null; created_at: string; expires_at: string };
type Event = { id: number; event_type: string; bit: number | null; sequence_number: number | null; step_number: number | null; suffix: string | null; request_path: string | null; observed_length: number | null; is_replay: number; user_agent: string | null; created_at: string };

const reply = (body: string, status = 200, type = "text/plain; charset=utf-8") => new Response(body, { status, headers: { ...NO_CACHE, "Content-Type": type } });
const htmlEscape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const token = (bytes = 8) => { const data = new Uint8Array(bytes); crypto.getRandomValues(data); return Array.from(data, b => b.toString(16).padStart(2, "0")).join(""); };
const runId = () => `r_${token(16)}`;
const safeSuffix = /^[a-zA-Z0-9_-]+$/;

async function getRun(db: D1Database, id: string, station: Station) {
  return db.prepare("SELECT id, station, bits, state, next_step, zero_token, one_token, read_token, created_at, expires_at FROM experiment_runs WHERE id = ? AND station = ?").bind(id, station).first<Run>();
}
function invalid(run: Run | null, now: string) {
  if (!run) return reply("run_not_found\n", 404);
  if (run.expires_at <= now) return reply("run_expired\n", 410);
  return null;
}
function links(origin: string, run: Run) {
  const base = `${origin}/binary-trail/${run.id}/${run.next_step}`;
  return `<nav><a href="${htmlEscape(`${base}/0/${run.zero_token}`)}">ZERO</a> <a href="${htmlEscape(`${base}/1/${run.one_token}`)}">ONE</a> <a href="${htmlEscape(`${base}/read/${run.read_token}`)}">READ</a></nav>`;
}

async function create(request: Request, env: Env, station: Station) {
  const id = runId(), created = new Date(), expires = new Date(created.getTime() + 86400000);
  const values = station === "trail" ? [token(), token(), token()] : [null, null, null];
  await env.DB.prepare("INSERT INTO experiment_runs (id, station, bits, state, next_step, zero_token, one_token, read_token, created_at, expires_at) VALUES (?, ?, '', 'created', 0, ?, ?, ?, ?, ?)")
    .bind(id, station, ...values, created.toISOString(), expires.toISOString()).run();
  const origin = new URL(request.url).origin;
  if (station === "trail") {
    const entry = `${origin}/binary-trail/${id}/entry`, debug = `${origin}/binary-trail/${id}/debug`;
    const prompt = `Visit this entry page:\n${entry}\n\nTransmit the bit sequence 01010101.\nAt each page, use only the ZERO, ONE, and READ links presented by that page.\nDo not construct or modify URLs.\nWhen finished, follow READ and report exactly what it returns.`;
    return reply(`<!doctype html><html><body><main><h1>Circular Trail run</h1><p>Arm this run from DEBUG before giving the entry URL or suggested prompt to the tested agent.</p><p>ENTRY: <a href="${entry}">${entry}</a></p><p>DEBUG: <a href="${debug}">${debug}</a></p><h2>Suggested prompt (use after arming)</h2><pre>${htmlEscape(prompt)}</pre></main></body></html>`, 200, "text/html; charset=utf-8");
  }
  const aliases = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const list = (action: string) => aliases.map(s => { const url = `${origin}/binary-alias/${id}/${action}/${s}`; return `<li><a href="${url}">${url}</a></li>`; }).join("");
  const debug = `${origin}/binary-alias/${id}/debug`;
  return reply(`<!doctype html><html><body><main><h1>URL Suffix / Alias run</h1><h2>ZERO aliases</h2><ul>${list("0")}</ul><h2>ONE aliases</h2><ul>${list("1")}</ul><h2>READ aliases</h2><ul>${list("read")}</ul><p>DEBUG: <a href="${debug}">${debug}</a></p><p>Template-derived negative control: the server accepts any safe suffix in <code>/0/{suffix}</code>, <code>/1/{suffix}</code>, and <code>/read/{suffix}</code>; navigation to model-constructed URLs is not assumed.</p></main></body></html>`, 200, "text/html; charset=utf-8");
}

async function arm(env: Env, id: string, station: Station) {
  const now = new Date().toISOString(), run = await getRun(env.DB, id, station), error = invalid(run, now); if (error) return error;
  await env.DB.prepare("UPDATE experiment_runs SET state = 'armed' WHERE id = ? AND station = ? AND state = 'created' AND expires_at > ?").bind(id, station, now).run();
  return reply("run_armed\n");
}
async function logSimple(request: Request, env: Env, run: Run, event: string, bit: number | null, step: number | null, suffix: string, replay = 0) {
  await env.DB.prepare("INSERT INTO experiment_events (run_id, station, event_type, bit, sequence_number, step_number, suffix, request_path, observed_length, is_replay, user_agent, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)")
    .bind(run.id, run.station, event, bit, step, suffix, new URL(request.url).pathname, run.bits.length, replay, request.headers.get("user-agent"), new Date().toISOString()).run();
}

async function trailAction(request: Request, env: Env, id: string, step: number, action: "0" | "1" | "read", suffix: string) {
  const now = new Date().toISOString(), run = await getRun(env.DB, id, "trail"), error = invalid(run, now); if (error) return error;
  const expected = action === "0" ? run!.zero_token : action === "1" ? run!.one_token : run!.read_token;
  if (step !== run!.next_step || suffix !== expected) {
    await logSimple(request, env, run!, "replay", action === "read" ? null : Number(action), step, suffix, 1);
    const currentLinks = links(new URL(request.url).origin, run!);
    return reply(`<!doctype html><html><body><main><p>trail_step_already_used</p>${currentLinks}</main></body></html>`, 409, "text/html; charset=utf-8");
  }
  if (action === "read") {
    await logSimple(request, env, run!, "read", null, step, suffix);
    return reply(`<!doctype html><html><body><main><p>value:</p><pre>${htmlEscape(run!.bits)}</pre><p>length:${run!.bits.length}</p>${links(new URL(request.url).origin, run!)}</main></body></html>`, 200, "text/html; charset=utf-8");
  }
  if (run!.state === "created") { await logSimple(request, env, run!, "pre_arm_request", Number(action), step, suffix); return reply("run_not_armed\n"); }
  const next = [token(), token(), token()];
  const update = env.DB.prepare("UPDATE experiment_runs SET bits = bits || ?, next_step = next_step + 1, zero_token = ?, one_token = ?, read_token = ? WHERE id = ? AND station = 'trail' AND state = 'armed' AND expires_at > ? AND next_step = ? AND ? = CASE ? WHEN '0' THEN zero_token WHEN '1' THEN one_token ELSE read_token END AND NOT EXISTS (SELECT 1 FROM experiment_events WHERE run_id = ? AND station = 'trail' AND event_type = 'write' AND step_number = ?)")
    .bind(action, ...next, id, now, step, suffix, action, id, step);
  const event = env.DB.prepare("INSERT INTO experiment_events (run_id, station, event_type, bit, sequence_number, step_number, suffix, request_path, observed_length, is_replay, user_agent, created_at) SELECT id, 'trail', 'write', ?, length(bits), ?, ?, ?, NULL, 0, ?, ? FROM experiment_runs WHERE id = ? AND station = 'trail' AND next_step = ? AND NOT EXISTS (SELECT 1 FROM experiment_events WHERE run_id = ? AND station = 'trail' AND event_type = 'write' AND step_number = ?) RETURNING sequence_number")
    .bind(Number(action), step, suffix, new URL(request.url).pathname, request.headers.get("user-agent"), now, id, step + 1, id, step);
  const result = await env.DB.batch<{ sequence_number: number }>([update, event]);
  const sequence = result[1]?.results[0]?.sequence_number;
  if (sequence === undefined) { const current = await getRun(env.DB, id, "trail"); await logSimple(request, env, current!, "replay", Number(action), step, suffix, 1); return reply(`<!doctype html><html><body><main><p>trail_step_already_used</p>${links(new URL(request.url).origin, current!)}</main></body></html>`, 409, "text/html; charset=utf-8"); }
  const current = await getRun(env.DB, id, "trail");
  return reply(`<!doctype html><html><body><main><p>recorded: ${action}</p><p>sequence: ${sequence}</p>${links(new URL(request.url).origin, current!)}</main></body></html>`, 200, "text/html; charset=utf-8");
}

async function aliasAction(request: Request, env: Env, id: string, action: "0" | "1" | "read", suffix: string) {
  const now = new Date().toISOString(), run = await getRun(env.DB, id, "alias"), error = invalid(run, now); if (error) return error;
  if (action === "read") { await logSimple(request, env, run!, "read", null, null, suffix); return reply(`value:\n${run!.bits}\nlength:\n${run!.bits.length}\n`); }
  if (run!.state === "created") { await logSimple(request, env, run!, "pre_arm_request", Number(action), null, suffix); return reply(`run_not_armed\nrequested:${action}\n`); }
  const update = env.DB.prepare("UPDATE experiment_runs SET bits = bits || ? WHERE id = ? AND station = 'alias' AND state = 'armed' AND expires_at > ? AND NOT EXISTS (SELECT 1 FROM experiment_events WHERE run_id = ? AND station = 'alias' AND event_type = 'write' AND bit = ? AND suffix = ?)").bind(action, id, now, id, Number(action), suffix);
  const event = env.DB.prepare("INSERT INTO experiment_events (run_id, station, event_type, bit, sequence_number, step_number, suffix, request_path, observed_length, is_replay, user_agent, created_at) SELECT id, 'alias', 'write', ?, length(bits), NULL, ?, ?, NULL, 0, ?, ? FROM experiment_runs WHERE id = ? AND station = 'alias' AND NOT EXISTS (SELECT 1 FROM experiment_events WHERE run_id = ? AND station = 'alias' AND event_type = 'write' AND bit = ? AND suffix = ?) RETURNING sequence_number").bind(Number(action), suffix, new URL(request.url).pathname, request.headers.get("user-agent"), now, id, id, Number(action), suffix);
  const result = await env.DB.batch<{ sequence_number: number }>([update, event]);
  const sequence = result[1]?.results[0]?.sequence_number;
  if (sequence === undefined) { await logSimple(request, env, run!, "replay", Number(action), null, suffix, 1); return reply("alias_already_used\n", 409); }
  return reply(`recorded:${action}\nsequence:${sequence}\n`);
}

async function debug(env: Env, id: string, station: Station) {
  const now = new Date().toISOString(), run = await getRun(env.DB, id, station), error = invalid(run, now); if (error) return error;
  const events = await env.DB.prepare("SELECT id, event_type, bit, sequence_number, step_number, suffix, request_path, observed_length, is_replay, user_agent, created_at FROM experiment_events WHERE run_id = ? AND station = ? ORDER BY id ASC").bind(id, station).all<Event>();
  const rows = events.results.map(e => `<tr><td>${e.id}</td><td>${htmlEscape(e.event_type)}</td><td>${htmlEscape(e.bit)}</td><td>${htmlEscape(e.sequence_number)}</td><td>${htmlEscape(e.step_number)}</td><td>${htmlEscape(e.suffix)}</td><td>${htmlEscape(e.is_replay)}</td><td>${htmlEscape(e.observed_length)}</td><td>${htmlEscape(e.request_path)}</td><td>${htmlEscape(e.user_agent)}</td><td>${htmlEscape(e.created_at)}</td></tr>`).join("");
  const base = station === "trail" ? "binary-trail" : "binary-alias";
  const form = run!.state === "created" ? `<form method="post" action="/${base}/${htmlEscape(id)}/arm"><button type="submit">Arm run</button></form>` : "";
  return reply(`<!doctype html><html><body><main><h1>${station} run debug</h1><dl><dt>Run ID</dt><dd>${htmlEscape(id)}</dd><dt>Station</dt><dd>${station}</dd><dt>State</dt><dd>${run!.state}</dd><dt>Created</dt><dd>${run!.created_at}</dd><dt>Expires</dt><dd>${run!.expires_at}</dd><dt>Bits</dt><dd><code>${htmlEscape(run!.bits)}</code></dd><dt>Length</dt><dd>${run!.bits.length}</dd><dt>Next trail step</dt><dd>${run!.next_step}</dd></dl>${form}<p>Receipt order and authoritative write sequence are separate.</p><table><thead><tr><th>Receipt</th><th>Type</th><th>Bit</th><th>Write sequence</th><th>Step</th><th>Suffix</th><th>Replay</th><th>Observed length</th><th>Path</th><th>User agent</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`, 200, "text/html; charset=utf-8");
}

export async function handleDynamicRequest(request: Request, env: Env, station: Station) {
  const prefix = station === "trail" ? "/binary-trail" : "/binary-alias", path = new URL(request.url).pathname;
  if (request.method === "GET" && path === `${prefix}/new`) return create(request, env, station);
  const armMatch = path.match(new RegExp(`^${prefix}/([^/]+)/arm$`));
  if (request.method === "POST" && armMatch) return arm(env, armMatch[1], station);
  if (request.method !== "GET") return reply("not_found\n", 404);
  const simple = path.match(new RegExp(`^${prefix}/([^/]+)/(entry|debug)$`));
  if (simple) {
    if (simple[2] === "debug") return debug(env, simple[1], station);
    if (station !== "trail") return reply("not_found\n", 404);
    const now = new Date().toISOString(), run = await getRun(env.DB, simple[1], station), error = invalid(run, now); if (error) return error;
    if (run!.state === "created") return reply("<!doctype html><html><body><main><p>run_not_armed</p></main></body></html>", 200, "text/html; charset=utf-8");
    return reply(`<!doctype html><html><body><main><h1>Circular Trail entry</h1>${links(new URL(request.url).origin, run!)}</main></body></html>`, 200, "text/html; charset=utf-8");
  }
  if (station === "trail") { const match = path.match(/^\/binary-trail\/([^/]+)\/(\d+)\/(0|1|read)\/([a-zA-Z0-9_-]+)$/); if (match) return trailAction(request, env, match[1], Number(match[2]), match[3] as "0" | "1" | "read", match[4]); }
  else { const match = path.match(/^\/binary-alias\/([^/]+)\/(0|1|read)\/([a-zA-Z0-9_-]+)$/); if (match && safeSuffix.test(match[3])) return aliasAction(request, env, match[1], match[2] as "0" | "1" | "read", match[3]); }
  return reply("not_found\n", 404);
}
