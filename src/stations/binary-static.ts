import type { Env } from "../index.ts";

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

type Run = { id: string; bits: string; state: "created" | "armed"; created_at: string; expires_at: string };
type Event = {
  id: number;
  event_type: string;
  bit: number | null;
  sequence_number: number | null;
  observed_length: number | null;
  request_path: string | null;
  user_agent: string | null;
  created_at: string;
};

function response(body: string, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { ...NO_CACHE, "Content-Type": contentType } });
}

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function newRunId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `r_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function getRun(db: D1Database, id: string): Promise<Run | null> {
  return db.prepare("SELECT id, bits, state, created_at, expires_at FROM binary_runs WHERE id = ?").bind(id).first<Run>();
}

function runError(run: Run | null, now: string): Response | null {
  if (!run) return response("run_not_found\n", 404);
  if (run.expires_at <= now) return response("run_expired\n", 410);
  return null;
}

async function createRun(request: Request, env: Env): Promise<Response> {
  const id = newRunId();
  const created = new Date();
  const expires = new Date(created.getTime() + 24 * 60 * 60 * 1000);
  await env.DB.prepare("INSERT INTO binary_runs (id, bits, state, created_at, expires_at) VALUES (?, '', 'created', ?, ?)")
    .bind(id, created.toISOString(), expires.toISOString())
    .run();
  const origin = new URL(request.url).origin;
  const zero = `${origin}/binary/${id}/0`;
  const one = `${origin}/binary/${id}/1`;
  const read = `${origin}/binary/${id}/read`;
  const debug = `${origin}/binary/${id}/debug`;
  const prompt = `You have three fixed URLs:\n\nZERO:\n${zero}\n\nONE:\n${one}\n\nREAD:\n${read}\n\nTransmit the bit sequence 10110 by visiting ZERO for each 0 and ONE for each 1, in order.\nDo not construct or modify any URLs.\nDo not use any URL other than the three supplied above.\nWhen finished, visit READ and report exactly what value it returns.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Static Binary Channel</title></head><body><main><h1>Static Binary Channel run</h1><dl><dt>ZERO</dt><dd><code>${escapeHtml(zero)}</code></dd><dt>ONE</dt><dd><code>${escapeHtml(one)}</code></dd><dt>READ</dt><dd><code>${escapeHtml(read)}</code></dd><dt>DEBUG</dt><dd><code>${escapeHtml(debug)}</code></dd></dl><h2>Suggested prompt</h2><pre>${escapeHtml(prompt)}</pre></main></body></html>`;
  return response(html, 200, "text/html; charset=utf-8");
}

async function writeBit(request: Request, env: Env, id: string, bit: "0" | "1"): Promise<Response> {
  const now = new Date().toISOString();
  const run = await getRun(env.DB, id);
  const error = runError(run, now);
  if (error) return error;

  if (run!.state === "created") {
    await env.DB.prepare(
      "INSERT INTO binary_events (run_id, event_type, bit, sequence_number, observed_length, request_path, user_agent, created_at) VALUES (?, 'pre_arm_request', ?, NULL, ?, ?, ?, ?)",
    ).bind(id, Number(bit), run!.bits.length, new URL(request.url).pathname, request.headers.get("user-agent"), now).run();
    return response(`run_not_armed\nrequested:${bit}\n`);
  }

  const update = env.DB.prepare(
    "UPDATE binary_runs SET bits = bits || ? WHERE id = ? AND expires_at > ? AND state = 'armed'",
  ).bind(bit, id, now);
  const event = env.DB.prepare(
    "INSERT INTO binary_events (run_id, event_type, bit, sequence_number, observed_length, request_path, user_agent, created_at) SELECT id, 'write', ?, length(bits), NULL, ?, ?, ? FROM binary_runs WHERE id = ? AND expires_at > ? AND state = 'armed' RETURNING sequence_number",
  ).bind(Number(bit), new URL(request.url).pathname, request.headers.get("user-agent"), now, id, now);
  // D1 batches are transactional: event failure rolls the authoritative append back.
  const results = await env.DB.batch<{ sequence_number: number }>([update, event]);
  const sequenceNumber = results[1]?.results[0]?.sequence_number;
  if (sequenceNumber === undefined) {
    const current = await getRun(env.DB, id);
    return runError(current, now) ?? response("state_update_failed\n", 500);
  }
  return response(`recorded:${bit}\nsequence:${sequenceNumber}\n`);
}

async function readRun(request: Request, env: Env, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const run = await getRun(env.DB, id);
  const error = runError(run, now);
  if (error) return error;
  await env.DB.prepare(
    "INSERT INTO binary_events (run_id, event_type, bit, sequence_number, observed_length, request_path, user_agent, created_at) VALUES (?, 'read', NULL, NULL, ?, ?, ?, ?)",
  ).bind(id, run!.bits.length, new URL(request.url).pathname, request.headers.get("user-agent"), now).run();
  return response(`value:\n${run!.bits}\nlength:\n${run!.bits.length}\n`);
}

async function debugRun(env: Env, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const run = await getRun(env.DB, id);
  const error = runError(run, now);
  if (error) return error;
  const events = await env.DB.prepare(
    "SELECT id, event_type, bit, sequence_number, observed_length, request_path, user_agent, created_at FROM binary_events WHERE run_id = ? ORDER BY id ASC",
  ).bind(id).all<Event>();
  const rows = events.results.map((event) => `<tr><td>${event.id}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.bit)}</td><td>${escapeHtml(event.sequence_number)}</td><td>${escapeHtml(event.observed_length)}</td><td>${escapeHtml(event.request_path)}</td><td>${escapeHtml(event.user_agent)}</td><td>${escapeHtml(event.created_at)}</td></tr>`).join("");
  const arm = run!.state === "created" ? `<form method="post" action="/binary/${encodeURIComponent(id)}/arm"><button type="submit">Arm run</button></form>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Binary run debug</title></head><body><main><h1>Binary run debug</h1><dl><dt>Run ID</dt><dd>${escapeHtml(run!.id)}</dd><dt>State</dt><dd>${escapeHtml(run!.state)}</dd><dt>Created</dt><dd>${escapeHtml(run!.created_at)}</dd><dt>Expires</dt><dd>${escapeHtml(run!.expires_at)}</dd><dt>Bits</dt><dd><code>${escapeHtml(run!.bits)}</code></dd><dt>Length</dt><dd>${run!.bits.length}</dd></dl>${arm}<p>Receipt order is shown below. For writes, Write sequence is the authoritative bit position; receipt IDs may differ under concurrency.</p><table><thead><tr><th>Receipt ID</th><th>Type</th><th>Bit</th><th>Write sequence</th><th>Observed length</th><th>Path</th><th>User agent</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
  return response(html, 200, "text/html; charset=utf-8");
}

async function armRun(env: Env, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const run = await getRun(env.DB, id);
  const error = runError(run, now);
  if (error) return error;
  await env.DB.prepare("UPDATE binary_runs SET state = 'armed' WHERE id = ? AND state = 'created' AND expires_at > ?")
    .bind(id, now).run();
  return response("run_armed\n", 200);
}

export async function handleBinaryRequest(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/binary/new") return createRun(request, env);
  const armMatch = path.match(/^\/binary\/([^/]+)\/arm$/);
  if (request.method === "POST" && armMatch) return armRun(env, armMatch[1]);
  if (request.method !== "GET") return response("not_found\n", 404);
  const match = path.match(/^\/binary\/([^/]+)\/(0|1|read|debug)$/);
  if (!match) return response("not_found\n", 404);
  const [, id, action] = match;
  if (action === "0" || action === "1") return writeBit(request, env, id, action);
  if (action === "read") return readRun(request, env, id);
  return debugRun(env, id);
}
