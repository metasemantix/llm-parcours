# Codex task: implement the GitHub Issue write surface with Parcours-owned state and re-entry

## Goal

Implement the first end-to-end **consumer Chat -> prefilled GitHub Issue -> GitHub Action -> LLM Parcours -> public thread state -> Parcours re-entry** experiment.

The purpose is to test whether an ordinary consumer agent that already has an authenticated GitHub capability can use GitHub Issues as a bounded write surface while **LLM Parcours remains the canonical system for routing, state, indexing, telemetry, notifications, and continuation/re-entry**.

This is deliberately an execution experiment, not a guessing game. The station must tell the agent exactly what to do and provide a prefilled Issue target. Do not require the agent to discover that it should use Issues or reconstruct routing metadata itself.

There are two repositories:

- canonical Parcours application: `metasemantix/llm-parcours`
- public disposable Issue ingress: `metasemantix/parcours-issue-write`

The companion repository already exists and is public. It is intentionally separate so experimental agent writes do not pollute the actual `llm-parcours` issue tracker.

Before changing code, inspect the current Worker, D1 migrations, tests, existing station patterns, telemetry conventions, and `docs/github-issue-write-station.md`. Preserve existing behavior unless this task explicitly extends it.

---

## Architectural boundary: keep this strict

### GitHub is only the authenticated write surface

GitHub must stay as dumb as practical.

It may:

1. receive a new Issue containing a site-issued ephemeral write capability and agent-authored reply content;
2. trigger a narrowly permissioned Action;
3. send the Issue data back to LLM Parcours;
4. receive a short-lived pickup URL from LLM Parcours;
5. comment that pickup URL on the Issue so the agent can return to the site.

GitHub must **not** become the canonical thread database, telemetry authority, routing authority, or re-entry authority.

### LLM Parcours owns everything else

LLM Parcours must own:

- forum/thread/message routing;
- canonical post/message storage;
- indexing and public readable state;
- notifications or notification-ready state;
- activity-chain telemetry;
- capability issuance and validation;
- pickup issuance and validation;
- proper re-entry/continuation semantics.

### Three different token roles

Do not collapse these concepts.

#### 1. Write capability `C`

Issued by LLM Parcours when constructing the prefilled GitHub Issue target.

Properties:

- opaque random bearer value;
- narrowly scoped to one intended append/reply operation;
- short-lived;
- single-use;
- stored hashed at rest;
- resolves server-side to the authoritative routing and activity-chain context;
- the only Parcours protocol credential that needs to appear in the Issue body.

The Issue body must not be trusted to supply forum/thread/parent routing. The capability resolves those values on the server.

#### 2. Pickup capability `P`

Minted by LLM Parcours only after the GitHub Issue has been accepted/ingested through `C`.

Properties:

- opaque random bearer value;
- short-lived;
- single-use;
- stored hashed at rest;
- safe enough for this public experiment to appear in the GitHub Action's response comment;
- authority is only to pick up the continuation corresponding to the completed write.

The Action receives a pickup URL from LLM Parcours and comments it on the Issue.

#### 3. Proper re-entry capability `R`

Created/returned by LLM Parcours when the agent redeems `P` on the site.

Properties:

- never written into the GitHub Issue;
- never returned to or stored by GitHub;
- belongs to the Parcours activity chain;
- resumes the agent at the point immediately after the accepted GitHub write, because that Issue ingestion is now the latest completed step in the chain;
- if the existing codebase already has re-entry-token rotation semantics, follow them rather than inventing parallel semantics.

The pickup step therefore creates an intentional extra round trip:

```text
Parcours -> GitHub Issue [C]
GitHub Action -> Parcours: redeem C + ingest reply
Parcours -> Action: pickup URL containing P
Action -> GitHub Issue comment: pickup URL
agent -> Parcours: redeem P
Parcours -> agent: proper re-entry/continuation R
agent -> Parcours: resume chain using R
```

Do **not** put `R`, an internal chain ID, or other live re-entry authority in the GitHub Issue body.

---

## V1 known limitation / explicit non-goal

A public, one-time pickup capability can theoretically be redeemed first by another observer who sees the Issue comment. For this v1 experiment, mitigate that with:

- high-entropy opaque random pickup tokens;
- a short expiry;
- strict single-use redemption;
- no sensitive or broad authority behind the pickup itself.

Do **not** implement the proposed per-chain arithmetic/challenge-response (`n*x + m`) idea in this slice. That can become a separate Parcours experiment later. Likewise do not introduce HMAC challenges, user accounts, bespoke OAuth, or a plugin in this task.

---

## User/agent experience

Build a minimal real public discussion surface sufficient for the experiment. It does not need to become a generalized forum product.

At minimum there should be a public path that exposes:

```text
forum -> thread -> messages/posts -> Reply
```

A test forum/thread/message may be seeded or created in the least invasive way consistent with the current codebase.

The important properties are:

- the thread is publicly GETtable;
- accepted GitHub replies become canonical Parcours messages in that thread;
- a reply remains publicly readable after posting;
- the reply affordance is explicit about what the agent must do;
- the outbound GitHub Issue is prefilled;
- the agent is told to preserve the prefilled capability marker and place its reply in the designated reply field;
- if its environment requires human approval to create the Issue, it should request that approval and continue afterward;
- the experiment does not score the agent on discovering the mechanism.

Suggested instruction language, adapted to the existing visual style:

> To reply, create the prefilled GitHub Issue in the linked repository using your available GitHub capability. Preserve the prefilled metadata/capability marker and put your response in the Reply section. If your environment requires approval for the GitHub write, request it. After posting, inspect the Issue for the continuation link and follow it back to LLM Parcours.

Make this understandable to both humans and agents.

---

## Prefilled GitHub Issue

Use GitHub's normal new-Issue URL with prefilled `title` and `body` parameters targeting:

`metasemantix/parcours-issue-write`

The exact cosmetic title may be chosen to fit the implementation, but the body should have a very small machine-readable envelope and a clear reply slot, conceptually:

```md
<!-- parcours-write-capability: C_OPAQUE_VALUE -->

## Reply

Replace this line with your reply while preserving the capability marker above.
```

Keep metadata minimal. In particular, do not put authoritative `forum`, `thread`, `reply_to`, activity-chain IDs, callback URLs, or re-entry tokens into the Issue as trusted fields. Those are resolved server-side from `C`.

The capability marker is data, never code.

---

## Treat every Issue as hostile input

A prefilled Issue can be edited before submission. Therefore **all Issue-controlled fields are untrusted**, including the supposedly prefilled marker, title, body, actor name, and any URLs/text the agent adds.

Requirements:

- validate the capability against the hashed server-side record;
- use a narrow parser with explicit length and character bounds;
- reject missing, malformed, expired, spent, or unknown capabilities;
- never `eval` Issue data;
- never interpolate Issue-controlled content into shell commands;
- never treat Issue-controlled strings as file paths, workflow expressions, SQL fragments, callback URLs, or executable configuration;
- use parameterized D1 queries;
- escape output correctly when rendering public HTML;
- impose a sensible maximum reply size;
- do not allow the Issue body to redirect ingestion to arbitrary threads or external URLs.

The GitHub Action should avoid shell interpolation of Issue title/body entirely. Prefer structured JSON and a small JS/Node step or otherwise safe data handling.

---

## Parcours persistence model

Use D1 and follow existing migration/style conventions.

The exact schema can be adapted to the current application, but the model must preserve these concepts cleanly:

### Canonical discussion state

- forums (or the smallest equivalent namespace);
- threads;
- messages/posts;
- parent/reply relationship where appropriate;
- creation timestamps;
- source metadata sufficient to record that a message arrived through GitHub and which Issue represented it.

Do not make the GitHub Issue itself the canonical post.

### Activity chains / telemetry

Every experimental journey needs a stable internal activity-chain identity so events across the web -> connector -> GitHub -> Action -> Parcours boundary can be grouped without relying on referrers, cookies, or inferred agent identity.

The agent does not need to know the internal chain ID.

Record observable events such as, where applicable:

- station/thread opened;
- reply affordance opened;
- write capability issued;
- departure toward GitHub;
- GitHub capability redeemed / Issue accepted;
- canonical message created;
- pickup capability issued;
- pickup capability redeemed;
- proper re-entry issued;
- re-entry redeemed / chain resumed;
- continuation reached.

Do not infer hidden implementation details from the GitHub actor identity. Record observable facts only.

### Write capability records

Persist at least:

- hashed token;
- associated activity-chain ID;
- authoritative forum/thread/parent target;
- scope/operation (for v1, append/reply only);
- issued timestamp;
- expiry timestamp;
- consumed timestamp/status;
- resulting canonical message ID when consumed;
- resulting GitHub Issue number/URL when known.

### Pickup capability records

Persist at least:

- hashed token;
- associated activity-chain ID;
- associated completed write/message;
- issued timestamp;
- expiry timestamp;
- consumed timestamp/status.

### Re-entry

If the repo already has a reusable re-entry abstraction, extend/reuse it. If it does not, implement the smallest coherent version needed here and document it clearly.

The defining semantic is:

> Possession of the current re-entry capability resumes the same activity chain at the point of its last completed departure/operation.

After the GitHub write has been ingested, re-entry must resume **after that write**, because the Issue operation is already part of the chain's history.

Hash bearer tokens at rest. Generate them with cryptographically secure randomness. Never log raw capability/re-entry values in durable telemetry or ordinary logs.

---

## GitHub ingestion endpoint in LLM Parcours

Add a narrowly scoped endpoint for the companion GitHub Action to submit newly opened Issues.

Choose a route name consistent with the existing Worker, e.g. something in the spirit of:

`POST /api/github-issue-write/ingest`

The route should accept structured JSON containing only what is required, for example:

```json
{
  "capability": "...",
  "issue_number": 123,
  "issue_url": "https://github.com/metasemantix/parcours-issue-write/issues/123",
  "issue_actor": "some-login",
  "title": "...",
  "body": "..."
}
```

Do not trust the Issue URL/repository merely because it was supplied. Where practical, constrain/validate that the source corresponds to the expected companion repository; the write capability remains the core authorization mechanism.

On valid first redemption:

1. locate `C` by hash;
2. verify scope, expiry, and unused status;
3. derive routing and activity-chain context from the stored capability record;
4. parse the designated reply content from the untrusted Issue body;
5. create exactly one canonical message/post;
6. record the GitHub Issue metadata as source evidence;
7. mark `C` consumed atomically/idempotently;
8. append the relevant telemetry events to the same activity chain;
9. mint `P` bound to that completed write/chain;
10. return a public pickup URL for the Action to comment on the Issue.

The endpoint must be idempotent under GitHub Action retries. Reprocessing the same accepted Issue/capability must never create duplicate canonical messages or multiple independent chain advances. Return the existing accepted state/pickup result or another explicitly safe idempotent response as appropriate.

For invalid/expired/spent capabilities, return a clear non-2xx or explicit structured rejection without creating state.

---

## Pickup and re-entry routes

Implement the site-side pickup/re-entry flow.

Suggested conceptual routes (adapt names to current router conventions):

```text
GET /github-write/pickup/:P
GET /reenter/:R
```

The first route:

- validates and atomically consumes `P`;
- records pickup/re-entry telemetry on the associated chain;
- mints or retrieves the chain's proper next re-entry capability `R` according to the chosen re-entry implementation;
- does not expose internal chain IDs;
- returns a small human/agent-readable page containing the proper continuation/re-entry link, or redirects only if doing so preserves the required telemetry and token separation cleanly.

Prefer making the distinction visible in implementation and tests: `P` is public GitHub pickup authority; `R` is the proper Parcours continuation authority and never appears on GitHub.

The re-entry route must resume the chain after the GitHub write and provide the next meaningful Parcours state/page.

---

## Public post state

After successful ingestion, the accepted reply must be accessible independently of GitHub through ordinary public GET navigation on LLM Parcours.

At minimum:

- thread view includes the newly accepted message;
- each post can have a stable public identifier/URL if that fits the current application cleanly;
- source provenance may indicate GitHub Issue ingress without exposing bearer tokens;
- no live capability, pickup token, or re-entry token is shown in public thread state.

This public readable state is canonical. GitHub is ingress/audit evidence.

---

## Indexing and notifications

The site is responsible for indexing and notifications.

For v1, implement the smallest durable shape that makes this architectural boundary real:

- accepted posts must be discoverable through the site's thread/index navigation;
- persist enough notification-ready information to know that a thread received a new reply;
- if the repository already has a notification system, integrate with it;
- if it does not, do not invent a large notification product in this slice. A small durable notification/event record or clearly documented hook point is sufficient.

Do not make GitHub notifications the Parcours notification mechanism.

---

## Companion repository GitHub Action

In `metasemantix/parcours-issue-write`, add a minimal workflow triggered by:

```yaml
on:
  issues:
    types: [opened]
```

Keep permissions narrow. It should need only what is required to read the triggering Issue and comment on it, e.g. conceptually:

```yaml
permissions:
  contents: read
  issues: write
```

The workflow must:

1. safely obtain the Issue number/title/body/actor/URL from the event payload;
2. extract the `parcours-write-capability` value using non-shell-injectable handling;
3. POST structured JSON to the LLM Parcours ingestion endpoint;
4. receive the pickup URL on success;
5. comment a concise result on the same Issue, explicitly telling the agent to follow the pickup link back to LLM Parcours;
6. on rejection/failure, comment or fail in a diagnostically useful way without leaking secrets.

Do not call Loom, THREAD, Stateboard, arbitrary user-supplied URLs, or any unrelated external service.

The Action will need the deployed Parcours origin. Prefer a repository variable for a non-secret public base URL. If a secret is genuinely necessary, document the exact manual setup, but do not invent a broad shared secret if the one-time write capability already provides sufficient authorization.

If Codex cannot commit directly to both repositories in one run, still implement the full Parcours side and prepare the exact companion-repo workflow file/content, then clearly report the one remaining cross-repository application step. Do not silently omit the Action.

---

## Human approval is telemetry, not failure

Consumer Chat or another agent environment may require the human to approve creation of the GitHub Issue.

The protocol must tolerate that pause.

Where the site can observe only its own side, do not pretend it knows whether an approval UI appeared. The experiment/reporting model should distinguish observable states such as:

- write capability issued;
- capability never redeemed;
- capability redeemed and Issue accepted;
- pickup never redeemed;
- re-entry completed.

If a test harness or manual annotation later records `approval_required` / `approval_granted`, leave room for those fields rather than conflating approval with protocol failure.

---

## Concurrency, replay, and expiry

Make the first implementation boring and robust.

Requirements:

- capability redemption must be transactional/idempotent;
- pickup redemption must be atomic single-use;
- expired tokens do not mutate canonical state;
- Action retries do not duplicate messages;
- repeated pickup GETs after consumption do not yield another live re-entry token;
- malformed Issue bodies do not partially create posts;
- token hashes are compared/queried safely;
- raw bearer values are absent from normal logs and public telemetry;
- set sensible TTL constants in one obvious place and document them.

Do not over-engineer distributed locking beyond what D1 and the current Worker architecture need.

---

## Tests

Add focused automated tests covering at least:

### Prefill / issuance

1. Opening the reply affordance creates or yields a new activity chain/context as appropriate.
2. A write capability is high-entropy/opaque, persisted only as a hash, has an expiry, and is scoped to the intended reply target.
3. The generated GitHub URL points to `metasemantix/parcours-issue-write/issues/new` (or the canonical equivalent) and contains a prefilled title/body.
4. The body contains the write-capability marker and a clear reply section.
5. The generated Issue body does not expose internal chain IDs or a proper re-entry token.

### Ingestion

6. A valid fresh `C` plus a valid reply creates exactly one canonical post in the intended thread.
7. Authoritative routing comes from the stored capability, not editable Issue metadata.
8. The capability is consumed after success.
9. GitHub Issue number/URL/source actor are recorded as source metadata where intended.
10. Accepted state is publicly GETtable from Parcours.
11. A pickup capability is issued only after successful ingestion.
12. Unknown, malformed, expired, or spent capabilities do not create a post.
13. Replaying the same accepted Issue/capability is idempotent and does not duplicate the post.
14. Hostile Markdown/HTML/shell-like strings in title/body remain inert data and render safely.

### Pickup / re-entry

15. Valid `P` can be redeemed once.
16. Redemption records the continuation on the same activity chain.
17. Redemption yields the proper Parcours re-entry/continuation `R` without exposing it on GitHub-facing state.
18. Re-entry resumes after the accepted GitHub Issue step.
19. Reusing `P` fails safely and does not mint another independent continuation.
20. Expired `P` fails safely.

### Telemetry

21. Events across issuance, GitHub ingestion, pickup, and re-entry share one internal activity-chain identity.
22. Raw bearer token values are not stored in ordinary event rows/loggable telemetry fields.
23. Existing `parcours_bulk_input`, search verification, binary/trail/alias, and other station tests remain green.

Add companion-workflow tests/linting if practical. At minimum make the parsing/POST logic small enough to be reviewed easily and avoid shell injection by construction.

---

## Documentation

Update `docs/github-issue-write-station.md` so it describes the implementation that actually exists rather than the earlier proposal.

Document clearly:

- GitHub is an authenticated write transport only;
- Parcours owns canonical state and routing;
- `C -> P -> R` token roles;
- where each token may appear;
- token hashing/expiry/single-use behavior;
- Issue data is untrusted;
- Action retry/idempotency behavior;
- public thread/message state;
- activity-chain telemetry semantics;
- known public-pickup limitation in v1;
- `n*x+m`/challenge-response and custom/plugin ingress are future experiments, not part of v1.

Update README/navigation only as needed to make the new station discoverable without disturbing existing experiments.

---

## Preserve existing experiments

Do not regress or redesign unrelated stations.

In particular, preserve:

- `parcours_bulk_input` nomenclature and behavior;
- search/referrer experiments;
- Google Search Console verification route;
- existing binary/trail/alias stations;
- existing D1 observation data;
- existing crawl/indexing semantics except where adding links to the new station is required.

Avoid broad framework rewrites.

---

## Deployment/setup notes

Do not assume production secrets/variables already exist.

At the end, list exactly:

- any new D1 migration and how to apply it;
- any new Worker environment variable or public configuration value;
- any GitHub repository variable/secret required in `metasemantix/parcours-issue-write`;
- the exact companion workflow path;
- any manual GitHub setting that must be enabled;
- the exact deployed URLs to use for a manual end-to-end test.

Prefer configuration that can be safely committed when it is public/non-secret.

---

## Manual end-to-end acceptance test

The finished implementation should make this manual test possible from ordinary consumer Chat:

1. Start at the public LLM Parcours forum/thread station.
2. Ask the agent to follow the explicit reply instructions.
3. Agent obtains the prefilled GitHub target containing `C`.
4. Agent uses its existing GitHub capability to create the Issue; a human approval gate may occur and is allowed.
5. GitHub Action posts Issue data to LLM Parcours.
6. LLM Parcours validates/consumes `C`, creates the canonical reply, indexes it, records chain telemetry, and returns pickup URL `P`.
7. Action comments the pickup URL on the Issue.
8. Agent follows that URL.
9. LLM Parcours consumes `P` and gives the agent the proper re-entry/continuation `R`.
10. Agent follows/resumes through `R` and continues the same activity chain after the GitHub write.
11. The reply remains visible on the public Parcours thread independently of GitHub.
12. Debug/telemetry evidence is sufficient to reconstruct the chain without relying on referrer inference.

Do not declare the task complete unless this path is implemented coherently or any unavoidable external/manual blocker is reported precisely.

---

## Quality checks

Run the repository's actual quality commands and fix failures. At minimum:

```sh
npm run typecheck
npm test
git diff --check
```

If the companion repository gains code/workflow validation, run its relevant checks too.

Inspect the final diff for accidental token leakage, overbroad GitHub Action permissions, unsafe Issue interpolation, duplicate-write races, and unrelated changes.

---

## Final report

Report concisely:

1. architecture implemented;
2. files/migrations changed in `llm-parcours`;
3. files changed in `parcours-issue-write`;
4. routes/endpoints added;
5. exact `C -> P -> R` behavior;
6. how public thread state and activity-chain telemetry work;
7. security/idempotency decisions;
8. required deployment/repository configuration;
9. quality-check results;
10. any remaining blocker to the manual consumer-Chat acceptance test.

Do not broaden this task into Loom, THREAD, Stateboard, a generic plugin system, custom agent accounts, or a full forum product.