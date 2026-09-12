# LLM Parcours

LLM Parcours is a neutral experimental site for testing concrete web-interaction primitives available to deployed LLM agent environments. It measures deployed interaction affordances—not model intelligence in the abstract. Understanding an interface, perceiving and selecting an action, executing it, continuing after state changes, and creating or retrieving persistent state are recorded as separate observations.

## Experimental discipline

- Preserve the exact prompt, and record product, model, mode, and date.
- Keep perceived elements, attempted actions, server-side results, and continuation behavior separate.
- Preserve raw observations separately from later result classifications.
- Do not immediately coach around an unexpected failure; record it first.
- Repeat surprising results in fresh runs.

## Three distinct binary conditions

These stations intentionally do not share an interaction mechanism. In one deployed chat browsing environment, repeated identical GET targets appeared to be reused or deduplicated, while model-constructed URLs failed a navigation provenance gate. The Trail and Alias stations were added to isolate those behaviors experimentally. This is an observation, not a claim about a provider's internal implementation or about browsing environments generally.

### Static Binary Channel

The initial station asks whether an agent can repeatedly navigate to either of two fixed GET URLs to append `0` or `1`, then retrieve the persisted raw bits from a third URL. Its action URLs never change. The station intentionally has no buttons, forms, JavaScript interaction, cookies, or successor-link protocol.

New runs begin **created**, not armed. While created, ZERO and ONE requests are recorded as `pre_arm_request` telemetry but cannot change the bits. This separates link previewing, safety scanning, prefetching, or other automatic URL retrieval—which is itself a useful observation—from intentional agent actuation. The arm form appears only on the human-facing DEBUG page; the tested agent neither needs nor receives an arming URL.

State-changing GET requests are normally poor API design. They are deliberate here because harmless GET navigation itself is the interaction primitive under test.

After deployment, create separate fresh runs at `/binary/new` for these sequences:

```text
A: 1
B: 101
C: 00000
D: 01010101
E: 01000001
```

Case C is especially important: it tests repeated actuation of the exact same endpoint. The server records raw bits only; it does not decode ASCII.

For each run, use this sequence:

1. Create the run and paste only its fixed ZERO, ONE, and READ URLs into a fresh LLM conversation.
2. Wait briefly for possible automatic URL touching.
3. Optionally inspect `pre_arm_request` entries on DEBUG.
4. Use the ordinary form on DEBUG to arm the run.
5. Give or execute the transmission instruction, then inspect READ and DEBUG.

The stored bit string and each write's returned `sequence_number` are authoritative. Each append and its write-event insert execute sequentially in one transactional D1 batch; the event derives its sequence from `length(bits)` after the append, and either both statements commit or both roll back. Concurrent event receipt IDs are not presented as bit positions: successful writes retain their authoritative sequence number, and DEBUG labels receipt order separately. Read events store the length actually observed by that read so intervening writes do not make the observation ambiguous.

This is the baseline: the tested agent receives exact ZERO, ONE, and READ URLs and must reuse the same concrete action target for repeated bits.

### Circular Trail

Create a run at `/binary-trail/new`. While it remains `created`, its entry page returns `run_not_armed` and contains no ZERO, ONE, or READ action links. The human must visit DEBUG and arm the run first, and only then give the entry URL and suggested prompt to the tested agent. The default agent prompt contains neither DEBUG nor ARM. Once armed, `/binary-trail/:run/entry` exposes the first fresh ordinary server-rendered ZERO, ONE, and READ links; every successful write page exposes links for the next step. There are no forms, scripts, redirects, cookies, client state, URL construction, or Back requirement in the agent flow.

Each step has three server-issued random suffixes. A ZERO or ONE succeeds only when its step equals the run's current `next_step` and its suffix is the issued token for that action. The transactional batch atomically appends the bit, advances exactly one step, rotates all three successor tokens, and inserts the authoritative write event. The unique successful-step index and conditional update prevent concurrent or later reuse. Replaying any old or mismatched step/token returns HTTP 409 with `trail_step_already_used`, appends nothing, records a distinct replay event, and exposes the currently valid successor links. Before arming, a valid action records `pre_arm_request` without consuming the step or changing bits.

READ reports authoritative bits and length, records the length observed, does not mutate or advance the step, and displays the current continuation links. Thus READ is repeatable while write action URLs are single-use.

### URL Suffix / Alias Channel

Create a run at `/binary-alias/new`. Its setup page supplies finite, explicit/verbatim aliases (`a` through `h`) for ZERO, ONE, and READ. Any directly requested suffix matching `[a-zA-Z0-9_-]+` is accepted; suffix contents carry no meaning.

Aliases are single-use **per run, logical bit, and suffix**. For example, `/0/a` and `/0/b` each append once, while a second `/0/a` returns HTTP 409 with `alias_already_used` and records replay telemetry. `/0/a` and `/1/a` are distinct aliases because the logical actions differ. The append and successful telemetry insertion run in one D1 batch, guarded by the successful-alias event and a unique partial index. READ aliases log the suffix and observed length but never mutate state. Pre-arm writes are observed but do not consume aliases.

The server also supports a template-derived negative control such as `/0/{suffix}` and `/1/{suffix}`, with instructions to derive `a`, `b`, `c`, and so on. This condition tests understanding separately from whether a browsing layer permits navigation to a model-constructed URL; success must not be assumed. It is distinct from both explicit aliases and Trail's server-issued recursive successors.

## Suggested manual matrix

Use a fresh run for every row and record conceptual understanding, attempted navigation, successful requests, continuation, persistent state, and retrieval separately.

| Condition | Sequences | URL protocol |
| --- | --- | --- |
| Static baseline | `1`, `101`, `00000`, `01010101` | Supply the three fixed URLs. |
| Circular Trail | `1`, `101`, `00000`, `01010101`, `01000001` | Arm from DEBUG first, then supply entry only and require links from each page. |
| Alias, explicit/verbatim | `00000`, `11111`, `01010101` | Supply enough complete aliases. |
| Alias, template negative control | chosen repeats | Supply a template rule; record understanding separately from actual navigation. |

## Local development

Requires a current Node.js release and npm.

```sh
npm install
npm run typecheck
npm test
npx wrangler d1 migrations apply llm-parcours --local
npm run dev
```

Wrangler serves the Worker with a local D1 database. Open the URL it prints, then select one of the three independent stations.

## Cloudflare setup and deployment

After cloning, the following manual Cloudflare steps are required; no account ID, database ID, deployment domain, or secret is checked in:

1. Authenticate Wrangler with your own Cloudflare account: `npx wrangler login`.
2. Create D1: `npx wrangler d1 create llm-parcours`.
3. Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Keep the binding name `DB`.
4. Apply the checked-in migrations remotely: `npx wrangler d1 migrations apply llm-parcours --remote`.
5. Deploy: `npm run deploy`.
6. Visit `/binary/new`, `/binary-trail/new`, or `/binary-alias/new` to create a run. No custom domain is required.

For a new migration, add another numbered SQL file under `migrations/`; do not edit production state by hand.

## Privacy and telemetry

The experiment stores the run ID, station, state, and bits plus event type, requested or written bit, authoritative write sequence, trail step, concrete suffix, read/pre-arm observed length, replay status, request path, timestamp, and user-agent when supplied. It does not store IP addresses, cookies, prompts, credentials, authorization headers, request bodies, arbitrary headers, or external account information. Runs reject access 24 hours after creation; expiry is lazy, so expired rows are not automatically deleted in this version.

The automated integration suite uses Node's in-memory SQLite adapter to exercise D1-compatible SQL, including transactional rollback. It is not a test of the Cloudflare D1 runtime itself.
