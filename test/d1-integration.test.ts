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

describe("real SQLite/D1 SQL integration", () => {
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
});
