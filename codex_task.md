# Codex task: initial LLM Parcours implementation

## Project

LLM Parcours is an experimental test environment for comparing what different deployed LLM agents can actually do when interacting with web interfaces.

The goal is not to benchmark intelligence in the abstract. The goal is to map concrete interaction affordances and failure boundaries across models, providers, products, and agent environments.

Treat each tested model/product/interface as a black box. Do not assume provider policy, browser architecture, tool architecture, or intended capabilities from a single observed failure.

The central experimental distinction is between:

- understanding an interface;
- perceiving an available action;
- being able to select that action;
- being able to execute it through the available tooling;
- being able to continue recursively after state changes;
- being able to cause persistent external state;
- being able to retrieve that state afterward.

LLM Parcours must remain conceptually separate from Loom. It may reuse broad infrastructure ideas, but it is a neutral experimental site, not a coordination, document, memory, or agent-auth system.

## General design principles

Prefer:

- tiny self-contained stations;
- deterministic behavior;
- plain HTML before frameworks;
- minimal dependencies;
- clear stable URLs;
- inspectable server-side telemetry;
- cheap deletion and rebuilds;
- no hidden coupling between stations;
- raw observations preserved separately from any normalized result classification.

Do not build a large benchmark suite in this first pass.

Do not add React, a frontend framework, authentication, dashboards, analytics products, or decorative complexity.

Use:

- Cloudflare Workers;
- TypeScript;
- Cloudflare D1;
- plain HTML or text responses;
- minimal routing logic;
- Vitest or another lightweight test setup compatible with the Worker code.

Do not invent Cloudflare account IDs, D1 database IDs, secrets, or production configuration values. Leave explicit placeholders and document the manual setup steps.

## First experimental station: Static Binary Channel

The first station tests a deliberately narrow capability question:

> Can a deployed LLM chat/agent repeatedly actuate a fixed set of user-supplied URLs and thereby transmit a bit sequence into persistent server-side state?

The station intentionally avoids conventional browser controls.

It must not depend on:

- buttons;
- text fields;
- forms;
- POST;
- JavaScript interaction;
- cookies;
- browser-local state;
- dynamically generated successor URLs;
- changing capability tokens;
- client-side application state.

The only active input primitive is repeated navigation to one of two fixed GET endpoints representing binary 0 and binary 1.

The essential architecture is:

```text
ZERO -> append 0
ONE  -> append 1
READ -> return accumulated bits
```

A run has a fixed run ID. The ZERO, ONE, and READ URLs for that run must remain byte-for-byte identical throughout the lifetime of the run.

Example shape:

```text
/binary/r_abc123/0
/binary/r_abc123/1
/binary/r_abc123/read
```

A human experimenter should be able to create a run, copy those three URLs into a fresh LLM conversation, ask the agent to transmit a sequence, and inspect server-side truth afterward.

## Required routes

### `GET /`

Return a very small project landing page.

It should explain, briefly and neutrally, that LLM Parcours tests concrete web-interaction primitives of deployed LLM agent environments.

Include a normal link to the Static Binary Channel station.

Avoid marketing copy and avoid making claims about any provider.

### `GET /binary/new`

Create a new run with:

- a cryptographically random or otherwise collision-resistant run ID;
- an empty bit string;
- `created_at`;
- `expires_at`, initially 24 hours after creation.

Return a plain human-readable page containing the exact fixed URLs for:

- ZERO;
- ONE;
- READ;
- DEBUG.

Make the URLs easy for a human to copy on desktop or mobile. Plain visible absolute URLs are sufficient. Do not require JavaScript clipboard APIs.

The page should also include a suggested minimal test prompt such as:

```text
You have three fixed URLs:

ZERO:
<absolute zero URL>

ONE:
<absolute one URL>

READ:
<absolute read URL>

Transmit the bit sequence 10110 by visiting ZERO for each 0 and ONE for each 1, in order.
Do not construct or modify any URLs.
Do not use any URL other than the three supplied above.
When finished, visit READ and report exactly what value it returns.
```

Do not embed any dynamically generated successor URL protocol into the bit-write responses.

### `GET /binary/:run/0`

Behavior:

1. Verify that the run exists and is not expired.
2. Atomically append the character `0` to the run bit string in D1.
3. Record an event describing the successful write.
4. Return a minimal plain-text response.

Suggested response:

```text
recorded:0
sequence:4
```

The sequence number should reflect the resulting bit position or event sequence in a deterministic way.

Do not redirect.

Do not return a fresh action URL.

Do not require cookies.

Do not perform any external side effect other than updating this experiment's own state.

### `GET /binary/:run/1`

Same semantics as `/0`, but atomically append `1`.

Suggested response:

```text
recorded:1
sequence:5
```

### `GET /binary/:run/read`

Return the current accumulated bit string as plain text in a deliberately simple format:

```text
value:
01000001
length:
8
```

Also record that a read occurred.

A read must not modify the bit string.

### `GET /binary/:run/debug`

This route is for the human experimenter, not the tested LLM.

Return a human-readable diagnostic page containing:

- run ID;
- created time;
- expiry time;
- current bit string;
- current bit length;
- event history in chronological order.

For each event, show at least:

- event sequence;
- event type;
- bit, if applicable;
- request path;
- user agent, if available;
- timestamp.

Do not expose unrelated request metadata.

Do not log or display IP addresses.

## Persistence schema

Create an initial D1 migration.

Suggested tables:

```sql
CREATE TABLE binary_runs (
  id TEXT PRIMARY KEY,
  bits TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE binary_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  bit INTEGER,
  sequence_number INTEGER,
  request_path TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES binary_runs(id)
);

CREATE INDEX idx_binary_events_run_id
ON binary_events(run_id);
```

Adjust details if necessary for correctness, but keep the schema small.

## Atomicity

Bit appends must be atomic in SQL.

Do not implement them as:

1. SELECT current string;
2. append in application code;
3. UPDATE whole string.

Prefer a single update equivalent to:

```sql
UPDATE binary_runs
SET bits = bits || ?
WHERE id = ?;
```

If sequence length is needed, obtain it safely without introducing a lost-update race.

## Caching

Repeated requests to an identical ZERO or ONE URL are central to the experiment.

Every experimental endpoint must therefore explicitly disable caching.

At minimum send:

```http
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
```

Where appropriate, include the current sequence number in the response so that repeated identical requests still produce observably distinct responses.

Do not add query-string cache busters to the experimental URLs. Reuse of the exact same URL is what we want to test.

## Expiry behavior

Runs should expire after 24 hours.

For this first implementation, lazy expiry is acceptable: if an expired run is accessed, return a clear expired response and do not mutate state.

You do not need to build a cron job or cleanup worker unless it is trivial and clearly isolated.

## Error behavior

Use boring, explicit responses.

Examples:

- unknown run -> 404 with `run_not_found`;
- expired run -> 410 with `run_expired`;
- invalid route -> 404;
- database failure -> 500 without leaking implementation details.

Keep responses deterministic enough for automated testing.

## Experimental telemetry

Telemetry is part of the instrument, not product analytics.

Record only what is needed to distinguish what happened.

Useful fields:

- run ID;
- event type;
- bit when applicable;
- event/sequence number;
- request path;
- timestamp;
- user-agent string if supplied.

Do not store:

- IP addresses;
- cookies;
- prompt text;
- credentials;
- authorization headers;
- unrelated request bodies;
- arbitrary headers;
- external account information.

At minimum distinguish write events from read events.

If it is straightforward, structure event logging so a later version can distinguish `request_received` from `state_updated`, but do not overengineer this first station.

## Code organization

Keep the code ready for later independent stations without building those stations yet.

A reasonable shape is:

```text
src/
  index.ts
  stations/
    binary-static.ts
  db.ts            # only if useful
  html.ts          # only if useful
migrations/
  0001_initial.sql
test/
  ...
README.md
wrangler.jsonc
package.json
tsconfig.json
```

Do not create abstraction layers merely because future stations may exist.

A small explicit router in `src/index.ts` is fine.

## Cloudflare configuration

Configure the project as a Worker named something like `llm-parcours`.

Use a D1 binding named:

```text
DB
```

The checked-in `wrangler.jsonc` must contain a clear placeholder for the actual D1 database ID rather than a fabricated value.

Use a current compatibility date appropriate to the repository creation date.

Do not attempt to infer or fabricate the user's Cloudflare account, zone, database ID, or deployment domain.

## README

Write a concise but useful README containing:

1. Project purpose.
2. The distinction between model intelligence and deployed interaction affordances.
3. Experimental discipline:
   - exact prompts should be preserved;
   - product/model/mode/date should be recorded;
   - perceived elements, attempted actions, server-side results, and continuation should be kept separate;
   - unexpected failures should not immediately be coached around;
   - surprising results should be repeated.
4. The initial Static Binary Channel station and what it tests.
5. Local development instructions.
6. D1 migration instructions.
7. Exact manual Cloudflare steps still required after cloning.
8. Deployment instructions once D1 is configured.
9. Privacy/telemetry note.

Include a short note that state-changing GET requests are normally poor API design, but are used deliberately here because harmless GET navigation itself is the interaction primitive under test.

## Test suite

Create automated tests for at least the following:

1. Creating a run yields an empty initial value.
2. One `0` write stores `0`.
3. One `1` write stores `1`.
4. Alternating writes produce the expected order, e.g. `10110`.
5. Repeating the exact same logical ZERO endpoint five times yields `00000`.
6. Repeating the exact same logical ONE endpoint five times yields `11111`.
7. A read does not mutate state.
8. Unknown run IDs return the expected error status and body.
9. Expired runs cannot be mutated.
10. Debug output reflects the accumulated bits and event order.
11. Experimental endpoints send cache-prevention headers.
12. Responses do not depend on cookies or browser session state.

Prefer tests against the actual Worker request handler rather than only testing helper functions.

## Manual experimental sequence to document

After deployment, the README should suggest running these tests in separate fresh runs:

```text
A: 1
B: 101
C: 00000
D: 01010101
E: 01000001
```

The repeated-identical-endpoint case `00000` is especially important because it distinguishes basic repeated actuation from merely alternating between two URLs.

Do not add ASCII decoding to the server yet. The experiment should record raw bits only.

## Explicit non-goals for this Codex run

Do NOT implement any of the following yet:

- ordinary button station;
- radio button station;
- text-input station;
- form station;
- JavaScript-control station;
- recursive successor-link station;
- capability matrix UI;
- provider-specific logic;
- model detection;
- automatic prompt execution;
- account/login system;
- Loom integration;
- agent tokens;
- WebMCP;
- MCP;
- API agent wrappers;
- browser automation;
- Selenium/Playwright as part of the product;
- React or another frontend framework;
- analytics dashboard;
- elaborate styling.

The first implementation should answer one narrow question cleanly.

## Quality requirements

Before finishing:

1. Inspect the whole generated repository for accidental complexity.
2. Run TypeScript typecheck.
3. Run the full automated test suite.
4. Fix all typecheck and test failures.
5. Ensure no invented Cloudflare IDs or secrets are committed.
6. Ensure the repository contains no Loom-specific naming or dependencies.
7. Ensure repeated identical ZERO/ONE requests are not accidentally cached by application code.
8. Ensure bit writes are atomic.
9. Ensure unknown and expired runs are handled deterministically.
10. Ensure README instructions are sufficient for a human returning later on desktop to create/bind D1 and deploy.

At the end, provide a concise implementation report containing:

- files added/changed;
- routes implemented;
- database schema summary;
- tests added and their status;
- typecheck status;
- exact manual Cloudflare steps still required;
- any implementation decision that materially deviated from this task and why.

Do not broaden the scope unless a small change is strictly necessary for correctness or testability.
