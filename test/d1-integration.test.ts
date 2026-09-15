import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import worker, { type Env } from "../src/index.ts";

class SQLiteStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  private readonly database: DatabaseSync;
  private readonly sql: string;
  constructor(database: DatabaseSync, sql: string) { this.database = database; this.sql = sql; }
  get query() { return this.sql; }
  get bindings() { return this.values; }
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }
  async run<T>(): Promise<D1Result<T>> {
    this.database.prepare(this.sql).run(...this.values);
    return { success: true, results: [], meta: {} };
  }
  async all<T>(): Promise<D1Result<T>> {
    return { success: true, results: this.database.prepare(this.sql).all(...this.values) as T[], meta: {} };
  }
}

class SQLiteD1 implements D1Database {
  readonly database = new DatabaseSync(":memory:");
  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON;");
    this.database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0002_trail_alias.sql", import.meta.url), "utf8"));
    this.database.exec(readFileSync(new URL("../migrations/0003_bulk_input_observations.sql", import.meta.url), "utf8"));
  }
  prepare(sql: string) { return new SQLiteStatement(this.database, sql); }
  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = (statements as SQLiteStatement[]).map((statement) => {
        const prepared = this.database.prepare(statement.query);
        const rows = /\bRETURNING\b/i.test(statement.query) ? prepared.all(...statement.bindings) : (prepared.run(...statement.bindings), []);
        return { success: true, results: rows as T[], meta: {} };
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("SQLite integration for D1-compatible SQL", () => {
  it("persists the exact bulk-input request evidence rendered by the Worker", async () => {
    const sqlite = new SQLiteD1();
    const referrer = "https://search.example/?q=parcours_bulk_input+nonce-7q41&x=<raw>";
    const response = await worker.fetch(new Request("https://integration.test/experiments/parcours_bulk_input?unexpected=yes", { headers: { referer: referrer, "user-agent": "agent<&>" } }), { DB: sqlite });
    assert.equal(response.status, 200);
    const html = await response.text();
    const row = sqlite.database.prepare("SELECT * FROM bulk_input_observations").get();
    assert.equal(row?.referrer, referrer);
    assert.equal(row?.request_target, "/experiments/parcours_bulk_input?unexpected=yes");
    assert.equal(row?.user_agent, "agent<&>");
    assert.match(html, new RegExp(String(row?.id)));
    assert.match(html, new RegExp(String(row?.observed_at)));
    assert.equal(sqlite.database.prepare("SELECT COUNT(*) AS count FROM bulk_input_observations").get()?.count, 1);
    sqlite.database.close();
  });

  it("applies the migration and exercises arming, atomic appends, reads, expiry, and telemetry", async () => {
    const sqlite = new SQLiteD1();
    const env: Env = { DB: sqlite };
    const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://integration.test${path}`, init), env);
    const create = async () => {
      const html = await (await call("/binary/new")).text();
      const id = html.match(/\/binary\/(r_[a-f0-9]+)\/0/)?.[1];
      assert.ok(id);
      return id;
    };
    const value = async (id: string) => (await (await call(`/binary/${id}/read`)).text()).match(/value:\n(.*)\nlength:/)?.[1];

    const preArm = await create();
    await call(`/binary/${preArm}/0`);
    assert.equal(await value(preArm), "");
    await call(`/binary/${preArm}/arm`, { method: "POST" });
    await call(`/binary/${preArm}/0`);
    assert.equal(await value(preArm), "0");

    for (const bits of ["1", "00000", "11111", "10110"]) {
      const id = await create();
      await call(`/binary/${id}/arm`, { method: "POST" });
      await Promise.all([...bits].map((bit) => call(`/binary/${id}/${bit}`)));
      assert.equal(await value(id), bits);
      const writeEvents = sqlite.database.prepare("SELECT bit, sequence_number FROM binary_events WHERE run_id = ? AND event_type = 'write' ORDER BY sequence_number").all(id);
      assert.equal(writeEvents.map((event) => event.bit).join(""), bits);
      assert.deepEqual(writeEvents.map((event) => event.sequence_number), [...bits].map((_, index) => index + 1));
    }

    const readId = await create();
    await call(`/binary/${readId}/arm`, { method: "POST" });
    await call(`/binary/${readId}/1`);
    assert.equal(await value(readId), "1");
    assert.equal(await value(readId), "1");
    const observed = sqlite.database.prepare("SELECT observed_length FROM binary_events WHERE run_id = ? AND event_type = 'read'").all(readId);
    assert.deepEqual(observed.map((event) => event.observed_length), [1, 1]);

    sqlite.database.prepare("INSERT INTO binary_runs (id, bits, state, created_at, expires_at) VALUES ('expired', '', 'armed', '2000-01-01', '2000-01-02')").run();
    assert.equal((await call("/binary/expired/1")).status, 410);
    assert.equal(sqlite.database.prepare("SELECT bits FROM binary_runs WHERE id = 'expired'").get()?.bits, "");

    sqlite.database.prepare("INSERT INTO binary_runs (id, bits, state, created_at, expires_at) VALUES ('rollback', '', 'armed', '2000-01-01', '2999-01-01')").run();
    let failed = false;
    try {
      await sqlite.batch([
        sqlite.prepare("UPDATE binary_runs SET bits = bits || '1' WHERE id = 'rollback'"),
        sqlite.prepare("INSERT INTO missing_telemetry_table VALUES (1)"),
      ]);
    } catch {
      failed = true;
    }
    assert.equal(failed, true);
    assert.equal(sqlite.database.prepare("SELECT bits FROM binary_runs WHERE id = 'rollback'").get()?.bits, "");
    sqlite.database.close();
  });

  it("exercises trail successors, atomic step claims, replay telemetry, reads, expiry, and cookies", async () => {
    const sqlite = new SQLiteD1(); const env: Env = { DB: sqlite };
    const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://integration.test${path}`, init), env);
    const setup = await (await call("/binary-trail/new")).text();
    const id = setup.match(/\/binary-trail\/(r_[a-f0-9]+)\/entry/)?.[1]; assert.ok(id);
    let entry = await (await call(`/binary-trail/${id}/entry`)).text();
    assert.match(entry, /run_not_armed/);
    assert.equal(/href="[^"]+\/(?:0|1|read)\/[^"]+"/.test(entry), false);
    const issued = sqlite.database.prepare("SELECT zero_token FROM experiment_runs WHERE id = ?").get(id)?.zero_token; assert.ok(issued);
    await call(`/binary-trail/${id}/0/0/${issued}`, { headers: { cookie: "preview=yes" } });
    assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits, "");
    assert.equal(sqlite.database.prepare("SELECT event_type FROM experiment_events WHERE run_id = ?").get(id)?.event_type, "pre_arm_request");
    await call(`/binary-trail/${id}/arm`, { method: "POST" });
    entry = await (await call(`/binary-trail/${id}/entry`)).text();
    assert.match(entry, /href="[^"]+\/0\/[^"]+">ZERO</);
    assert.match(entry, /href="[^"]+\/1\/[^"]+">ONE</);
    assert.match(entry, /href="[^"]+\/read\/[^"]+">READ</);
    let page = entry;
    const used: string[] = [];
    for (const bit of "01010101") {
      const label = bit === "0" ? "ZERO" : "ONE";
      const href = page.match(new RegExp(`href="([^"]+)"[^>]*>${label}<`))?.[1]; assert.ok(href); used.push(href);
      const response = await call(new URL(href).pathname, { headers: { cookie: `ignored=${bit}` } });
      assert.equal(response.status, 200); page = await response.text();
      assert.match(page, /recorded: [01]/); assert.match(page, />ZERO<.*>ONE<.*>READ</);
    }
    assert.equal(new Set(used).size, 8);
    const replay = await call(new URL(used[0]).pathname); assert.equal(replay.status, 409); assert.match(await replay.text(), /trail_step_already_used/);
    const run = sqlite.database.prepare("SELECT bits, next_step FROM experiment_runs WHERE id = ?").get(id);
    assert.equal(run?.bits, "01010101"); assert.equal(run?.next_step, 8);
    const readHref = page.match(/href="([^"]+\/read\/[^"]+)"/)?.[1]; assert.ok(readHref);
    const read = await call(new URL(readHref).pathname); assert.match(await read.text(), /01010101/);
    const events = sqlite.database.prepare("SELECT event_type, sequence_number, observed_length, is_replay FROM experiment_events WHERE run_id = ? ORDER BY id").all(id);
    assert.equal(events.filter(e => e.event_type === "write").length, 8);
    assert.deepEqual(events.filter(e => e.event_type === "write").map(e => e.sequence_number), [1,2,3,4,5,6,7,8]);
    assert.equal(events.some(e => e.event_type === "replay" && e.is_replay === 1), true);
    assert.equal(events.some(e => e.event_type === "read" && e.observed_length === 8), true);
    assert.equal(read.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.equal((await call("/binary-trail/missing/entry")).status, 404);
    sqlite.database.prepare("INSERT INTO experiment_runs (id, station, bits, state, created_at, expires_at) VALUES ('oldtrail','trail','','armed','2000','2001')").run();
    assert.equal((await call("/binary-trail/oldtrail/entry")).status, 410);
    assert.equal(events.every(e => !("cookie" in e)), true);
    sqlite.database.close();
  });

  it("exercises alias distinct suffixes, single-use replay, mixed order, reads, and atomic rollback", async () => {
    const sqlite = new SQLiteD1(); const env: Env = { DB: sqlite };
    const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://integration.test${path}`, init), env);
    const setup = await (await call("/binary-alias/new")).text();
    const id = setup.match(/\/binary-alias\/(r_[a-f0-9]+)\/0\/a/)?.[1]; assert.ok(id);
    await call(`/binary-alias/${id}/0/pre`, { headers: { cookie: "ignored=yes" } });
    assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits, "");
    await call(`/binary-alias/${id}/arm`, { method: "POST" });
    for (const suffix of ["a", "b", "c"]) await call(`/binary-alias/${id}/0/${suffix}`);
    assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits, "000");
    for (const suffix of ["a", "b", "c"]) await call(`/binary-alias/${id}/1/${suffix}`);
    assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits, "000111");
    assert.equal((await call(`/binary-alias/${id}/1/a`)).status, 409);
    await call(`/binary-alias/${id}/0/x`); await call(`/binary-alias/${id}/1/x`);
    const beforeRead = sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits;
    const read = await call(`/binary-alias/${id}/read/result`); assert.match(await read.text(), /00011101/);
    assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = ?").get(id)?.bits, beforeRead);
    assert.equal(read.headers.get("pragma"), "no-cache");
    assert.equal((await call("/binary-alias/missing/0/a")).status, 404);
    sqlite.database.prepare("INSERT INTO experiment_runs (id, station, bits, state, created_at, expires_at) VALUES ('oldalias','alias','','armed','2000','2001')").run();
    assert.equal((await call("/binary-alias/oldalias/0/a")).status, 410);
    const replay = sqlite.database.prepare("SELECT is_replay FROM experiment_events WHERE run_id = ? AND event_type = 'replay'").get(id); assert.equal(replay?.is_replay, 1);
    assert.equal(sqlite.database.prepare("SELECT COUNT(*) AS n FROM experiment_events WHERE run_id = ? AND event_type = 'pre_arm_request'").get(id)?.n, 1);
    sqlite.database.prepare("INSERT INTO experiment_runs (id, station, bits, state, created_at, expires_at) VALUES ('rollback2','alias','','armed','2000','2999')").run();
    let failed = false; try { await sqlite.batch([sqlite.prepare("UPDATE experiment_runs SET bits = bits || '1' WHERE id = 'rollback2'"), sqlite.prepare("INSERT INTO missing_telemetry VALUES (1)")]); } catch { failed = true; }
    assert.equal(failed, true); assert.equal(sqlite.database.prepare("SELECT bits FROM experiment_runs WHERE id = 'rollback2'").get()?.bits, "");
    sqlite.database.close();
  });
});
