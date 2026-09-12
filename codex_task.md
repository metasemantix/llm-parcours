# Codex task: add Circular Trail and URL Suffix experiments

## Project context

LLM Parcours is an experimental test environment for comparing what different deployed LLM agents can actually do when interacting with web interfaces.

The goal is not to benchmark intelligence in the abstract. The goal is to map concrete interaction affordances and failure boundaries across models, providers, products, and agent environments.

Treat each tested model/product/interface as a black box. Preserve distinctions between:

- understanding an interface;
- perceiving an available action;
- selecting an action;
- actually executing it through the available tooling;
- continuing recursively after the page changes;
- causing persistent external state;
- retrieving that state afterward.

LLM Parcours remains conceptually separate from Loom.

The repository already contains a Static Binary Channel. Preserve it as an independent baseline experiment. Do not rewrite its semantics merely to make the next experiment work.

## Empirical motivation for this Codex run

The current Static Binary Channel has already produced useful observations in normal ChatGPT web browsing:

1. Distinct user-supplied fixed GET URLs can cause persistent state changes.
2. Repeated attempts to revisit the same exact ZERO or ONE URL appear to be cached or deduplicated by the browsing layer, even though the Worker sends no-cache headers.
3. READ can likewise return stale retrieval-layer content while DEBUG shows newer server-side truth.
4. A model can conceptually expand a URL template such as replacing a symbolic suffix with `a`, `b`, `c`, etc., but normal ChatGPT browsing rejected the constructed URLs because they were not exact user-supplied URLs or URLs obtained from a prior browser result.
5. This suggests that URL provenance and repeated-target reuse are separate capability boundaries.

The next implementation should therefore test two related but distinct hypotheses:

- **Circular Trail / Recursive Successor Links:** can an agent continue indefinitely when each server response exposes fresh ordinary links for the next step?
- **URL Suffix / Alias Transport:** can logically identical ZERO and ONE actions succeed repeatedly when each navigation target has a distinct concrete URL?

The implementation must preserve these as experimental conditions rather than collapsing them into one opaque mechanism.

---

# Part A: minor usability fixes to the existing Static Binary Channel

Keep the current Static Binary Channel semantics intact.

## Make `/binary/new` human-friendly

The ZERO, ONE, READ, and DEBUG URLs currently shown on the human setup page should be ordinary clickable `<a>` links while still displaying the full absolute URL text.

For example:

```html
<a href="https://.../binary/r_abc/0">https://.../binary/r_abc/0</a>
```

This is a human convenience only. Do not alter the suggested prompt so that DEBUG or ARM is exposed to the tested agent.

## Keep arming human-only

The current run lifecycle and pre-arm instrumentation are useful and must remain:

- new runs begin `created`;
- ZERO/ONE before arming log `pre_arm_request` but do not mutate bits;
- a human arms from the DEBUG page;
- after arming, writes may mutate state.

Do not provide the tested agent with an ARM URL in the suggested prompt.

---

# Part B: Circular Trail station

## Capability question

Implement a new independent station that asks:

> Can a deployed LLM agent sustain recursive interaction when every successful action page presents fresh server-issued links for the next action?

The station should deliberately avoid requiring the agent to:

- reuse a previously visited exact URL;
- construct or concatenate a new URL;
- infer a hidden capability token;
- use browser Back;
- interact with buttons, text inputs, JavaScript, cookies, or client-side state.

The only active primitive should be following ordinary `<a href>` links returned by the immediately previous page.

## Core idea

A run has persistent binary state, but each logical action is represented by a fresh concrete URL at each step.

Conceptually:

```text
entry page
  -> ZERO(step 0) or ONE(step 0)
       -> response page containing ZERO(step 1), ONE(step 1), READ(step 1)
            -> response page containing ZERO(step 2), ONE(step 2), READ(step 2)
                 -> ...
```

The logical semantics stay constant:

```text
ZERO -> append 0
ONE  -> append 1
READ -> report accumulated bits
```

Only the concrete URL changes.

## Suggested route shape

Use a clear independent namespace such as:

```text
/binary-trail/new
/binary-trail/:run/entry
/binary-trail/:run/:step/0/:suffix
/binary-trail/:run/:step/1/:suffix
/binary-trail/:run/:step/read/:suffix
/binary-trail/:run/debug
/binary-trail/:run/arm
```

Exact route naming may vary if a simpler design is cleaner, but keep the station clearly separate from `/binary/...`.

The run ID must remain stable. Each step should produce fresh next-step action URLs.

## Fresh suffixes

Every next action link must contain a concrete suffix or nonce so that its URL is different from all previously exposed action URLs in that run.

A suffix may be:

- a random short token;
- an opaque step-specific identifier;
- another deterministic but collision-safe value.

Do not require the model to derive the suffix itself.

The server must render the complete next URLs as ordinary links.

Example response after writing `0`:

```html
<p>recorded: 0</p>
<p>sequence: 3</p>

<a href=".../4/0/k7m2">ZERO</a>
<a href=".../4/1/q9fd">ONE</a>
<a href=".../4/read/u1ax">READ</a>
```

The exact token format is not important. The provenance is.

## Step discipline

Each action page should expose links for exactly the next logical step.

The implementation should prevent accidental replay of an old trail URL from appending another bit.

Preferred behavior:

- a fresh trail action URL is valid once;
- replaying it is deterministic and does not append another bit;
- replay should return a clear response such as `trail_step_already_used` or a human-readable equivalent;
- the next-step links remain discoverable where practical, but do not silently perform another write.

This is important because we want to distinguish:

- successful recursive continuation;
- replay/deduplication behavior;
- duplicate network requests.

## Arming

Use the same human-only arming principle as the static station.

Before arming:

- trail action requests may be logged as pre-arm observations;
- no bit mutation should occur.

After arming:

- the agent begins from a server-issued entry/action page;
- successful trail actions mutate persistent state.

The tested agent should not need or receive the ARM URL.

## Entry page

The trail run should provide a clean starting URL for the tested agent.

The entry page should contain ordinary clickable links for the first ZERO, ONE, and READ actions.

The suggested prompt should ideally require only the entry URL plus the intended bit sequence, for example:

```text
Visit this entry page:
<absolute trail entry URL>

Transmit the bit sequence 01010101.
At each page, use only the ZERO, ONE, and READ links presented by that page.
Do not construct or modify URLs.
When finished, follow READ and report exactly what it returns.
```

This is deliberately different from the static station, where ZERO/ONE/READ are supplied directly in the prompt.

## Response pages

Trail ZERO and ONE responses must be HTML, not dead-end plain text.

Each successful write response should visibly include:

- which bit was recorded;
- authoritative sequence number;
- ordinary links labeled ZERO, ONE, READ for the next step.

No JavaScript.
No form controls.
No meta-refresh.
No redirect requirement.

Use normal server-rendered anchor elements.

READ should display the authoritative current bit string and length. It may also expose continuation links if useful, but make the semantics explicit and deterministic.

---

# Part C: URL Suffix / Alias station or mode

## Capability question

Implement a separate condition to test:

> Can repeated logical ZERO/ONE actions succeed when each action uses a distinct concrete URL suffix, even without recursive server-issued successor links?

This condition should isolate **same-action repetition with unique URLs** from the full recursive trail.

## Important provenance distinction

We have observed that a model may understand a prompt-level URL template but still be unable to navigate to a URL it constructs itself.

Therefore support at least two distinct suffix conditions in code/documentation:

### 1. Verbatim alias condition

The human can generate or view a finite set of explicit alias URLs, e.g.:

```text
ZERO aliases:
.../0/a
.../0/b
.../0/c

ONE aliases:
.../1/a
.../1/b
.../1/c
```

Every alias maps to the same logical action but has a distinct concrete URL.

This condition tests whether the browser can perform repeated logical actions when every target URL is explicitly supplied or discovered.

### 2. Template-derived condition

Document, but do not assume success for, a prompt-level template such as:

```text
ZERO base: .../0/{suffix}
ONE base:  .../1/{suffix}
Use a, b, c, ... in order.
```

The server should accept such suffixed paths if directly requested, but the model may be unable to navigate to them if it constructs them itself.

This is a useful negative-control condition and should be described as such.

## Route design

A simple independent namespace is preferable, for example:

```text
/binary-alias/new
/binary-alias/:run/0/:suffix
/binary-alias/:run/1/:suffix
/binary-alias/:run/read/:suffix
/binary-alias/:run/debug
/binary-alias/:run/arm
```

Suffixes may be constrained to a safe simple character set such as:

```text
[a-zA-Z0-9_-]+
```

Do not interpret suffix content semantically. The suffix exists only to make the concrete URL distinct and traceable.

## Replay semantics

For the alias station, choose and document one of these intentionally:

- each unique alias URL is single-use, or
- each unique alias URL can be replayed and will append again.

Preferred for clean diagnosis: **single-use per alias**.

That lets telemetry distinguish a fresh alias action from accidental retries.

Reusing the same suffix for the same logical action should not append again.

Different suffixes for the same logical action should append normally.

---

# Persistence and telemetry

Extend the D1 schema minimally and clearly.

Do not overload the static station tables in a way that makes its original data ambiguous.

A separate table or a small shared run/event schema is acceptable if it remains easy to inspect.

For trail/alias events, capture enough to reconstruct exactly what happened:

- run ID;
- station type (`trail` or `alias` if sharing tables);
- event type;
- logical bit, if applicable;
- authoritative sequence number after a successful write;
- step number where applicable;
- concrete suffix/token where applicable;
- request path;
- observed length for reads;
- replay/duplicate status where applicable;
- user-agent string if supplied;
- timestamp.

Do not store:

- IP addresses;
- cookies;
- prompt text;
- credentials;
- authorization headers;
- unrelated request bodies;
- arbitrary headers;
- external account information.

## Atomicity

Successful state mutation and authoritative write telemetry must remain transactionally consistent.

Use D1 `DB.batch()` or another safe D1 mechanism so that:

- a bit append and its corresponding successful write event either both commit or both roll back;
- sequence numbers remain authoritative;
- duplicate/single-use checks do not introduce lost-update races.

Do not implement write state as SELECT -> modify in application code -> UPDATE.

---

# Caching

All experimental endpoints must continue to send explicit cache-prevention headers:

```http
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
```

Do not rely on those headers to solve the experiment. The entire point of the trail/alias variants is to test behavior when the deployed browsing layer may still deduplicate identical URLs.

Do not add random query-string cache busters to the original Static Binary Channel.

For the new trail and alias stations, unique path suffixes are part of the experimental design and should be visible in telemetry.

---

# Human-facing DEBUG pages

Provide human-readable DEBUG pages for each new station.

Show at least:

- run ID;
- station type;
- state (`created` / `armed`);
- created/expiry times;
- current bits;
- current length;
- current or next trail step where applicable;
- event history in receipt order;
- authoritative write sequence separately;
- suffix/token used;
- replay/duplicate indicators.

DEBUG is for the experimenter. Do not put DEBUG or ARM into the default agent prompt.

---

# Landing page

Update `/` so it links clearly to:

- Static Binary Channel
- Circular Trail
- URL Suffix / Alias Channel

Keep copy neutral and concise.

---

# README

Update README to explain that there are now three intentionally distinct binary conditions:

1. **Static Binary Channel**
   - exact user-supplied ZERO/ONE URLs;
   - repeated identical URL reuse;
   - baseline condition.

2. **Circular Trail**
   - every page presents fresh ordinary server-issued successor links;
   - tests recursive continuation and provenance from previous browser results.

3. **URL Suffix / Alias Channel**
   - same logical ZERO/ONE action represented by multiple distinct concrete URLs;
   - tests whether unique targets avoid repeated-URL deduplication;
   - includes a documented prompt-template negative-control condition.

Document the empirical motivation without presenting one product observation as a universal architectural fact.

Use wording such as:

> In one deployed chat browsing environment, repeated identical GET targets appeared to be reused or deduplicated, while model-constructed URLs failed a navigation provenance gate. The Trail and Alias stations were added to isolate those behaviors experimentally.

Do not claim to know the provider's internal implementation.

---

# Required automated tests

Preserve all existing Static Binary Channel tests.

Add tests for at least the following.

## Circular Trail

1. Creating a trail run yields empty bits and `created` state.
2. Pre-arm trail action does not mutate state and is logged.
3. Arming enables writes.
4. First ZERO page appends `0` exactly once.
5. First ONE page appends `1` exactly once.
6. A successful action response contains ordinary ZERO, ONE, and READ links for the next step.
7. The next-step links have fresh concrete URLs distinct from the just-used URLs.
8. Following a sequence such as `01010101` through successive server-issued links yields exactly `01010101`.
9. Replaying an already-used trail action URL does not append again.
10. Replay behavior is logged distinctly.
11. READ returns authoritative bits and records observed length.
12. Unknown/expired trail runs behave deterministically.
13. Trail endpoints send cache-prevention headers.
14. Trail operation does not depend on cookies.

## URL Alias / Suffix

1. Creating an alias run yields empty bits and `created` state.
2. Pre-arm alias action does not mutate state.
3. After arming, `/0/a`, `/0/b`, `/0/c` append `000`.
4. After arming, `/1/a`, `/1/b`, `/1/c` append `111`.
5. Reusing the same alias path does not append twice if single-use semantics are chosen.
6. Different suffixes for the same logical action are treated as distinct fresh actions.
7. Mixed aliases produce the expected bit order.
8. READ does not mutate state.
9. Unknown/expired runs behave deterministically.
10. Alias endpoints send cache-prevention headers.
11. Alias operation does not depend on cookies.

## SQL / integration coverage

Use the existing SQLite-backed D1-compatible integration approach where useful, but describe it accurately as SQLite integration for D1-compatible SQL rather than real Cloudflare D1.

Add integration coverage for:

- transactional write + telemetry behavior;
- single-use replay prevention;
- trail step advancement;
- rollback if telemetry insertion fails.

Do not overstate local adapter tests as proof of Cloudflare runtime behavior.

---

# Suggested manual experimental matrix

Document a small manual matrix using fresh runs.

## Static baseline

```text
1
101
00000
01010101
```

## Circular Trail

```text
1
101
00000
01010101
01000001
```

The tested agent should receive only the trail entry URL plus the instruction to use the links each page presents.

## Alias, explicit/verbatim

Provide enough explicit aliases to transmit:

```text
00000
11111
01010101
```

## Alias, template-derived negative control

Provide a base/template rule and ask the model to derive `a`, `b`, `c`, etc.

Record whether it understands the template separately from whether the browser actually navigates to the constructed URLs.

---

# Non-goals for this Codex run

Do NOT add:

- generic button/radio/text-input/form stations;
- React or another frontend framework;
- browser automation;
- Selenium/Playwright as product behavior;
- provider-specific code;
- model detection;
- automatic prompt execution;
- account/login system;
- Loom integration;
- agent auth tokens;
- MCP/WebMCP;
- analytics products;
- decorative UI work;
- generalized benchmark scoring;
- speculative provider-policy logic.

Do not remove or silently change the existing Static Binary Channel's scientific meaning.

---

# Quality requirements

Before finishing:

1. Inspect the current repository before editing; work with the existing implementation rather than regenerating it from scratch.
2. Preserve all current working Static Binary Channel behavior and tests.
3. Run TypeScript typecheck.
4. Run the full automated test suite.
5. Fix all typecheck/test failures.
6. Ensure schema migrations are additive and safe for an already-deployed D1 database.
7. Do not edit the original applied migration if a new migration is required; add a numbered migration.
8. Ensure no Cloudflare secrets or fabricated IDs are committed.
9. Ensure all state-changing writes and telemetry remain transactionally consistent.
10. Ensure all replay/single-use semantics are deterministic under concurrent requests.
11. Ensure every experimental endpoint sends the intended no-cache headers.
12. Keep implementation small, explicit, and auditable.
13. Update README and human setup pages sufficiently that the experiment can be deployed and run without rediscovering the protocol.

At the end, provide a concise implementation report containing:

- files added/changed;
- new routes;
- migration/schema changes;
- exact trail semantics;
- exact alias/suffix semantics;
- replay behavior;
- test and typecheck status;
- any implementation decision that materially deviated from this task and why.

Do not broaden scope beyond the Circular Trail, URL Suffix/Alias condition, and the small Static Binary Channel usability fixes described above.
