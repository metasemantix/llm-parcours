declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown): void;
    deepEqual(actual: unknown, expected: unknown): void;
    ok(value: unknown): asserts value;
    match(value: string, regexp: RegExp): void;
  };
  export default assert;
}

declare module "node:test" {
  export function describe(name: string, callback: () => void): void;
  export function beforeEach(callback: () => void): void;
  export function it(name: string, callback: () => void | Promise<void>): void;
}

declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: "utf8"): string;
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: unknown[]): Record<string, unknown> | undefined;
      all(...values: unknown[]): Record<string, unknown>[];
      run(...values: unknown[]): unknown;
    };
    close(): void;
  }
}
