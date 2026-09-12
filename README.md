# LLM Parcours

LLM Parcours is a neutral experimental site for testing concrete web-interaction primitives available to deployed LLM agent environments. It measures deployed interaction affordances—not model intelligence in the abstract. Understanding an interface, perceiving and selecting an action, executing it, continuing after state changes, and creating or retrieving persistent state are recorded as separate observations.

## Experimental discipline

- Preserve the exact prompt, and record product, model, mode, and date.
- Keep perceived elements, attempted actions, server-side results, and continuation behavior separate.
- Preserve raw observations separately from later result classifications.
- Do not immediately coach around an unexpected failure; record it first.
- Repeat surprising results in fresh runs.

## Static Binary Channel

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

## Local development

Requires a current Node.js release and npm.

```sh
npm install
npm run typecheck
npm test
npx wrangler d1 migrations apply llm-parcours --local
npm run dev
```

Wrangler serves the Worker with a local D1 database. Open the URL it prints, then follow the Static Binary Channel link.

## Cloudflare setup and deployment

After cloning, the following manual Cloudflare steps are required; no account ID, database ID, deployment domain, or secret is checked in:

1. Authenticate Wrangler with your own Cloudflare account: `npx wrangler login`.
2. Create D1: `npx wrangler d1 create llm-parcours`.
3. Copy the returned database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`. Keep the binding name `DB`.
4. Apply the checked-in migration remotely: `npx wrangler d1 migrations apply llm-parcours --remote`.
5. Deploy: `npm run deploy`.
6. Visit the deployed `/binary/new` URL to create a run. No custom domain is required.

For a new migration, add another numbered SQL file under `migrations/`; do not edit production state by hand.

## Privacy and telemetry

The experiment stores the run ID, state, and bits plus pre-arm/write/read event type, requested or written bit, authoritative write sequence, read/pre-arm observed length, request path, timestamp, and user-agent when supplied. It does not store IP addresses, cookies, prompts, credentials, authorization headers, request bodies, arbitrary headers, or external account information. Runs reject access 24 hours after creation; expiry is lazy, so expired rows are not automatically deleted in this version.
