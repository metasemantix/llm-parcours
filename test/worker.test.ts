import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import worker, { type Env } from "../src/index.ts";

type Run = { id: string; bits: string; state: "created" | "armed"; created_at: string; expires_at: string };
type Event = { id: number; run_id: string; event_type: string; bit: number | null; sequence_number: number | null; observed_length: number | null; request_path: string; user_agent: string | null; created_at: string };
type Observation = { id: string; observed_at: string; method: string; request_target: string; referrer: string | null; user_agent: string | null };

class FakeStatement {
  private values: unknown[] = [];
  private db: FakeD1;
  private sql: string;
  constructor(db: FakeD1, sql: string) { this.db = db; this.sql = sql; }
  get query() { return this.sql; }
  get bindings() { return this.values; }
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    if (this.sql.startsWith("SELECT id, bits")) return (this.db.runs.get(String(this.values[0])) ?? null) as T | null;
    if (this.sql.startsWith("UPDATE binary_runs")) {
      const [bit, id, now] = this.values.map(String);
      const run = this.db.runs.get(id);
      if (!run || run.expires_at <= now || run.state !== "armed") return null;
      run.bits += bit;
      return { sequence_number: run.bits.length } as T;
    }
    throw new Error(`Unhandled first: ${this.sql}`);
  }
  async run(): Promise<D1Result> {
    if (this.sql.startsWith("INSERT INTO bulk_input_observations")) {
      if (this.db.failObservationInsert) throw new Error("simulated insertion failure");
      const [id, observed_at, method, request_target, referrer, user_agent] = this.values;
      this.db.observations.push({ id: String(id), observed_at: String(observed_at), method: String(method), request_target: String(request_target), referrer: referrer as string | null, user_agent: user_agent as string | null });
    } else if (this.sql.startsWith("INSERT INTO binary_runs")) {
      const [id, created_at, expires_at] = this.values.map(String);
      this.db.runs.set(id, { id, bits: "", state: "created", created_at, expires_at });
    } else if (this.sql.startsWith("INSERT INTO binary_events")) {
      const isRead = this.sql.includes("'read'");
      const isPreArm = this.sql.includes("'pre_arm_request'");
      const [run_id, ...rest] = this.values;
      const event: Event = isRead
        ? { id: ++this.db.eventId, run_id: String(run_id), event_type: "read", bit: null, sequence_number: null, observed_length: Number(rest[0]), request_path: String(rest[1]), user_agent: rest[2] as string | null, created_at: String(rest[3]) }
        : isPreArm
          ? { id: ++this.db.eventId, run_id: String(run_id), event_type: "pre_arm_request", bit: Number(rest[0]), sequence_number: null, observed_length: Number(rest[1]), request_path: String(rest[2]), user_agent: rest[3] as string | null, created_at: String(rest[4]) }
          : { id: ++this.db.eventId, run_id: String(run_id), event_type: "write", bit: Number(rest[0]), sequence_number: Number(rest[1]), observed_length: null, request_path: String(rest[2]), user_agent: rest[3] as string | null, created_at: String(rest[4]) };
      this.db.events.push(event);
    } else if (this.sql.startsWith("UPDATE binary_runs SET state")) {
      const run = this.db.runs.get(String(this.values[0]));
      if (run && run.state === "created" && run.expires_at > String(this.values[1])) run.state = "armed";
    } else throw new Error(`Unhandled run: ${this.sql}`);
    return { success: true, meta: {} } as D1Result;
  }
  async all<T>(): Promise<D1Result<T>> {
    if (!this.sql.startsWith("SELECT id, event_type")) throw new Error(`Unhandled all: ${this.sql}`);
    return { success: true, meta: {}, results: this.db.events.filter((event) => event.run_id === this.values[0]) as T[] } as D1Result<T>;
  }
}

class FakeD1 {
  runs = new Map<string, Run>();
  events: Event[] = [];
  eventId = 0;
  failNextWriteEvent = false;
  failObservationInsert = false;
  observations: Observation[] = [];
  prepare(sql: string) { return new FakeStatement(this, sql); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const runs = new Map([...this.runs].map(([id, run]) => [id, { ...run }]));
    const events = this.events.map((event) => ({ ...event }));
    const eventId = this.eventId;
    try {
      const [update, insert] = statements as FakeStatement[];
      const [bit, id, now] = update.bindings.map(String);
      const run = this.runs.get(id);
      if (run && run.expires_at > now && run.state === "armed") run.bits += bit;
      if (this.failNextWriteEvent) {
        this.failNextWriteEvent = false;
        throw new Error("simulated telemetry failure");
      }
      const [eventBit, path, userAgent, createdAt, eventRunId, eventNow] = insert.bindings;
      const eventRun = this.runs.get(String(eventRunId));
      const results: { sequence_number: number }[] = [];
      if (eventRun && eventRun.expires_at > String(eventNow) && eventRun.state === "armed") {
        const sequence_number = eventRun.bits.length;
        this.events.push({ id: ++this.eventId, run_id: eventRun.id, event_type: "write", bit: Number(eventBit), sequence_number, observed_length: null, request_path: String(path), user_agent: userAgent as string | null, created_at: String(createdAt) });
        results.push({ sequence_number });
      }
      return [{ success: true, results: [], meta: {} }, { success: true, results, meta: {} }] as D1Result<T>[];
    } catch (error) {
      this.runs = runs;
      this.events = events;
      this.eventId = eventId;
      throw error;
    }
  }
}

describe("Static Binary Channel Worker", () => {
  let db: FakeD1;
  let env: Env;
  beforeEach(() => { db = new FakeD1(); env = { DB: db as unknown as D1Database }; });

  const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://example.test${path}`, init), env);
  async function create(arm = true) {
    const response = await call("/binary/new");
    const html = await response.text();
    const id = html.match(/\/binary\/(r_[a-f0-9]+)\/0/)?.[1];
    assert.ok(id);
    if (arm) assert.equal((await call(`/binary/${id}/arm`, { method: "POST" })).status, 200);
    return id!;
  }
  const readValue = async (id: string) => (await (await call(`/binary/${id}/read`)).text()).match(/value:\n(.*)\nlength:/)?.[1];

  it("creates a run with an empty initial value and fixed absolute URLs", async () => {
    const id = await create();
    assert.equal(await readValue(id), "");
    assert.equal(db.runs.get(id)?.bits, "");
    const setup = await (await call("/binary/new")).text();
    assert.match(setup, /<a href="https:\/\/example\.test\/binary\/r_[a-f0-9]+\/0">https:\/\/example\.test/);
  });

  for (const [bit, expected] of [["0", "0"], ["1", "1"]]) it(`one ${bit} write stores ${expected}`, async () => {
    const id = await create();
    assert.equal((await call(`/binary/${id}/${bit}`)).status, 200);
    assert.equal(await readValue(id), expected);
  });

  for (const [bits, expected] of [["10110", "10110"], ["00000", "00000"], ["11111", "11111"]]) it(`writes ${bits} in order`, async () => {
    const id = await create();
    for (const bit of bits) await call(`/binary/${id}/${bit}`);
    assert.equal(await readValue(id), expected);
  });

  it("read records an event without mutating bits", async () => {
    const id = await create();
    await call(`/binary/${id}/1`);
    await readValue(id); await readValue(id);
    assert.equal(db.runs.get(id)?.bits, "1");
    assert.deepEqual(db.events.map((event) => event.event_type), ["write", "read", "read"]);
  });

  it("returns deterministic errors for unknown runs", async () => {
    const response = await call("/binary/missing/0");
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "run_not_found\n");
  });

  it("does not mutate expired runs", async () => {
    db.runs.set("expired", { id: "expired", bits: "1", state: "armed", created_at: "2000-01-01T00:00:00.000Z", expires_at: "2000-01-02T00:00:00.000Z" });
    const response = await call("/binary/expired/0");
    assert.equal(response.status, 410);
    assert.equal(await response.text(), "run_expired\n");
    assert.equal(db.runs.get("expired")?.bits, "1");
  });

  it("logs pre-arm requests without mutating, then allows writes after arming", async () => {
    const id = await create(false);
    const createdDebug = await (await call(`/binary/${id}/debug`)).text();
    assert.match(createdDebug, /<dt>State<\/dt><dd>created<\/dd>/);
    assert.match(createdDebug, /<button type="submit">Arm run<\/button>/);
    const before = await call(`/binary/${id}/1`);
    assert.equal(await before.text(), "run_not_armed\nrequested:1\n");
    assert.equal(db.runs.get(id)?.bits, "");
    assert.equal(db.events[0]?.event_type, "pre_arm_request");
    await call(`/binary/${id}/arm`, { method: "POST" });
    await call(`/binary/${id}/1`);
    assert.equal(db.runs.get(id)?.bits, "1");
    const armedDebug = await (await call(`/binary/${id}/debug`)).text();
    assert.match(armedDebug, /<dt>State<\/dt><dd>armed<\/dd>/);
  });

  it("records the length observed by each read", async () => {
    const id = await create();
    await call(`/binary/${id}/1`);
    await readValue(id);
    assert.equal(db.events.at(-1)?.observed_length, 1);
  });

  it("rolls back an append when write telemetry fails", async () => {
    const id = await create();
    db.failNextWriteEvent = true;
    const response = await call(`/binary/${id}/1`);
    assert.equal(response.status, 500);
    assert.equal(db.runs.get(id)?.bits, "");
    assert.equal(db.events.length, 0);
  });

  it("debug shows bits and chronological event history", async () => {
    const id = await create();
    await call(`/binary/${id}/1`, { headers: { "user-agent": "test-agent" } });
    await call(`/binary/${id}/0`);
    await readValue(id);
    const html = await (await call(`/binary/${id}/debug`)).text();
    assert.match(html, new RegExp(String("<code>10</code>").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(html, new RegExp(String("test-agent").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(html.indexOf("/1</td>") < html.indexOf("/0</td>"));
  });

  for (const path of ["/binary/new", "/binary/missing/0", "/binary/missing/1", "/binary/missing/read", "/binary/missing/debug"]) it(`sets no-cache headers on ${path}`, async () => {
    const response = await call(path);
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
  });

  it("does not use cookie state", async () => {
    const id = await create();
    await call(`/binary/${id}/0`, { headers: { cookie: "session=first" } });
    await call(`/binary/${id}/1`, { headers: { cookie: "session=other" } });
    assert.equal(await readValue(id), "01");
    assert.equal(db.events.every((event) => !("cookie" in event)), true);
  });
});

describe("parcours_bulk_input search-referrer probe", () => {
  let db: FakeD1;
  let env: Env;
  beforeEach(() => { db = new FakeD1(); env = { DB: db as unknown as D1Database }; });
  const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://example.test${path}`, init), env);

  it("renders the marker, explicit absent values, canonical URL, and matching persisted evidence", async () => {
    const response = await call("/experiments/parcours_bulk_input");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    const html = await response.text();
    assert.match(html, /<title>parcours_bulk_input/);
    assert.match(html, /<h1>parcours_bulk_input<\/h1>/);
    assert.match(html, /Referer:<\/dt><dd>\(none\)<\/dd>/);
    assert.match(html, /rel="canonical" href="https:\/\/example\.test\/experiments\/parcours_bulk_input"/);
    assert.equal(db.observations.length, 1);
    const observation = db.observations[0]!;
    assert.equal(observation.method, "GET");
    assert.equal(observation.request_target, "/experiments/parcours_bulk_input");
    assert.equal(observation.referrer, null);
    assert.match(html, new RegExp(observation.id));
    assert.match(html, new RegExp(observation.observed_at));
  });

  it("preserves raw headers and query target in storage while escaping HTML", async () => {
    const referrer = "https://search.example/?q=parcours_bulk_input+nonce-7q41&tag=<script>alert(1)</script>";
    const userAgent = "probe<svg onload=alert(1)>&agent";
    const response = await call("/experiments/parcours_bulk_input?unexpected=a%2Bb&x=1", { headers: { referer: referrer, "user-agent": userAgent } });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(db.observations[0]?.referrer, referrer);
    assert.equal(db.observations[0]?.user_agent, userAgent);
    assert.equal(db.observations[0]?.request_target, "/experiments/parcours_bulk_input?unexpected=a%2Bb&x=1");
    assert.equal(/<script>|<svg/.test(html), false);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /probe&lt;svg onload=alert\(1\)&gt;&amp;agent/);
    assert.match(html, /unexpected=a%2Bb&amp;x=1/);
  });

  it("prevents cache reuse", async () => {
    const response = await call("/experiments/parcours_bulk_input");
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
  });

  it("returns a deterministic cached-disabled server error when persistence fails", async () => {
    db.failObservationInsert = true;
    const response = await call("/experiments/parcours_bulk_input");
    assert.equal(response.status, 500);
    assert.equal(await response.text(), "internal_error\n");
    assert.equal(response.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
  });

  it("publishes provider-neutral discovery routes and a root link", async () => {
    const robots = await call("/robots.txt");
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /Allow: \/\nSitemap: https:\/\/example\.test\/sitemap\.xml/);
    const sitemap = await call("/sitemap.xml");
    assert.match(sitemap.headers.get("content-type") ?? "", /application\/xml/);
    assert.equal(await sitemap.text(), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/</loc></url><url><loc>https://example.test/experiments/parcours_bulk_input</loc></url></urlset>\n');
    assert.match(await (await call("/")).text(), /<a href="\/experiments\/parcours_bulk_input">/);
  });
});
