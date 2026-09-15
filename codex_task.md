# Codex task: add the parcours_bulk_input referrer probe

## Project context

LLM Parcours is an experimental site for testing concrete web-interaction primitives available to deployed LLM agent environments. Treat deployed model/product/tool combinations as black boxes and preserve raw observations separately from interpretation.

This repository already contains the Static Binary Channel, Circular Trail, and URL Suffix / Alias Channel. Preserve their behavior and tests. This slice adds one new, independent experiment. It is not a Loom feature.

The exact public experiment marker for this slice is:

~~~text
parcours_bulk_input
~~~

Use that spelling everywhere. Do not use loom_bulk_input.

## Empirical motivation

Recent manual tests suggest a useful asymmetry:

- some deployed agents can issue a native web-search query containing an arbitrary multi-character string;
- the same agents may be unable to fill a normal HTML search input;
- they may also be unable to construct a new destination URL and navigate to it unless that exact URL already appeared in user input or a prior browsing result;
- they can follow an ordinary search result link that their browsing/search layer exposes.

This motivates a different transport question:

> Can arbitrary text supplied to an agent's native web-search operation survive the transition from search query -> search result -> followed link -> destination server?

The first carrier to test is the incoming HTTP Referer header and any other ordinary request-target information the destination server can directly observe.

Do not assume that modern search providers expose query text in referrers. The likely result may be a stripped origin, another reduced referrer, or no referrer at all. A clean negative result is useful.

## Experimental protocol

The intended manual probe is:

1. Make the LLM Parcours probe page publicly reachable and indexable.
2. Allow search engines time to discover/index it.
3. In a fresh agent conversation, ask the agent to perform a native web search containing the marker plus a fresh arbitrary nonce, for example:

   ~~~text
   parcours_bulk_input S21MaulwurfLOL4711
   ~~~

4. Instruct the agent to follow the LLM Parcours result rather than constructing a destination URL.
5. Inspect what the destination page says it received, especially the exact incoming Referer value.

The arbitrary nonce originates only in the external search query. The LLM Parcours URL must not be pre-populated with that nonce.

The primary question is whether the nonce appears anywhere in request information delivered to the Worker after following the search result.

## Core implementation

Add one public GET endpoint at a stable path:

~~~text
/experiments/parcours_bulk_input
~~~

This same URL serves both purposes:

- it is the public, indexable search result target;
- when visited, it renders the request metadata received for that specific request.

Do not create a separate result endpoint for v1.

### Search-visible page content

The page must be plain, server-rendered HTML and must prominently contain the exact token parcours_bulk_input in ordinary visible text.

At minimum include it in:

- the document title;
- the H1;
- a concise explanatory paragraph.

Add a normal link to this experiment from the site root so crawlers can discover it.

Do not include the current manual test nonce (S21MaulwurfLOL4711) in the checked-in page. The page should contain only the stable marker and generic explanatory text, so a fresh nonce remains genuinely external to the site.

Do not use hidden keyword stuffing or search-engine-specific cloaking.

### Request evidence rendered on the page

For the current request, display clearly and unambiguously:

- a generated request/observation ID;
- server observation timestamp in ISO 8601 UTC;
- HTTP method;
- the request target observable to the Worker (pathname plus query string, if any);
- the exact incoming Referer header value, or an explicit (none) state;
- the exact incoming User-Agent header value, or an explicit (none) state.

Use field labels that an agent can quote back verbatim, for example:

~~~text
Observation ID: ...
Observed at: ...
Method: GET
Request target: /experiments/parcours_bulk_input
Referer: (none)
User-Agent: ...
~~~

The HTML representation must escape untrusted values correctly. A malicious referrer or user-agent must never be able to inject markup or script.

Do not parse search-provider URLs, extract a q parameter, normalize the referrer, lowercase it, decode it, or otherwise interpret it. Preserve the raw header string as the Worker received it. Interpretation belongs after the experiment.

If the incoming request target unexpectedly contains a query string, preserve and display it as evidence, but do not add any code that intentionally transports the nonce in a Parcours query parameter.

### Persistence

Add an additive D1 migration for a small table such as bulk_input_observations.

Persist exactly the evidence needed to reconstruct each probe request:

- observation ID;
- timestamp;
- method;
- request target (pathname + query string);
- raw referrer value, nullable;
- raw user-agent value, nullable.

Do not store:

- IP addresses;
- cookies;
- authorization headers;
- request bodies;
- arbitrary headers;
- account identifiers;
- prompt text;
- search-engine response content.

The observation row should correspond to the same values rendered in the response. If insertion fails, return a clear server error rather than silently showing evidence that was not persisted.

There is no public history/debug listing in this slice. Do not expose accumulated referrer or user-agent data to arbitrary visitors.

### Caching

This endpoint is request-specific because its visible contents depend on incoming headers. Prevent intermediary/browser cache reuse:

~~~http
Cache-Control: no-store, no-cache, must-revalidate
Pragma: no-cache
Expires: 0
~~~

Do not use a random query-string cache buster.

Do not add noindex. Cache prevention and search indexing are separate concerns.

## Crawl/discovery support

Make the experiment reasonably discoverable using ordinary, provider-neutral web mechanisms.

Add:

~~~text
/robots.txt
/sitemap.xml
~~~

Requirements:

- robots.txt must not block the experiment and should reference the sitemap using an absolute URL derived from the current request origin.
- sitemap.xml should include at least the site root and /experiments/parcours_bulk_input, with absolute URLs derived from the current request origin.
- The experiment page should use an ordinary self-canonical link generated from the current request origin.
- A concise meta description and meta robots=index,follow are fine.
- Do not add provider-specific verification files, Search Console/Bing credentials, submission APIs, or SEO libraries.

All generated absolute URLs must be HTML/XML escaped where appropriate.

## Manual test text

Update README with a concise section documenting this exact experiment and a clean cold-test prompt such as:

~~~text
Visit the web using your normal web-search capability.

Search for:
parcours_bulk_input S21MaulwurfLOL4711

Follow the LLM Parcours result that your search returns. Do not construct or edit a destination URL yourself.

On the destination page, report exactly the values shown for:
Observation ID
Request target
Referer
User-Agent
~~~

Make clear that a fresh nonce should be used for each real run.

Also document the important interpretation boundary:

- Referer: (none) is a valid negative result;
- an origin-only or path-only referrer is also a result;
- the experiment succeeds as a bulk-input carrier only if the arbitrary payload survives into request evidence observable by Parcours;
- do not infer provider internals from one outcome.

## Tests

Preserve all existing tests and add coverage for this station.

At minimum test:

1. GET /experiments/parcours_bulk_input returns 200 HTML.
2. The HTML contains the exact visible marker parcours_bulk_input.
3. A request with no Referer renders an explicit none state.
4. A request with a synthetic referrer such as https://search.example/?q=parcours_bulk_input+nonce-7q41 renders the exact referrer content (subject only to correct HTML escaping) and persists the exact raw header value.
5. A referrer containing HTML-significant characters is escaped and cannot inject markup.
6. A user-agent containing HTML-significant characters is escaped.
7. The request target preserves an unexpected query string as observed evidence without interpreting it.
8. The response contains the required no-cache headers.
9. A successful request persists exactly one observation row whose fields match the response.
10. A D1 insertion failure produces a deterministic server error rather than an apparently successful observation page.
11. GET /robots.txt permits discovery and advertises an absolute sitemap URL.
12. GET /sitemap.xml is valid-enough XML and contains absolute URLs for the root and probe page.
13. The site root contains an ordinary anchor link to the probe page.
14. Existing binary/trail/alias tests remain green.

Use the repository's existing SQLite-backed D1-compatible integration approach where useful. Describe those tests accurately; they do not prove Cloudflare runtime behavior.

## Implementation constraints

- Inspect the current code before editing and fit this station into the existing small Worker architecture.
- Prefer a separate station module, for example src/stations/bulk-input.ts, rather than bloating src/index.ts.
- Keep routing explicit and auditable.
- Add a new numbered migration; do not edit already-applied migrations.
- No JavaScript is needed on the experiment page.
- No form controls are needed.
- No POST endpoint is needed for the experiment.
- No cookies or client-side state.
- No authentication system.
- No browser automation.
- No external search API integration.
- No provider-specific search code.
- No attempt to manufacture the payload into a Parcours URL.
- No referrer parsing or provider fingerprinting.
- No Loom integration.
- Do not modify the scientific semantics of the existing three binary stations.

## Quality checks

Before finishing, run:

~~~sh
npm run typecheck
npm test
git diff --check
~~~

Fix all failures.

Ensure the new migration is additive and safe for an already-deployed D1 database.

## Final implementation report

At the end, report concisely:

- files changed/added;
- new routes;
- migration/schema change;
- exact values captured and persisted;
- exact caching/indexability behavior;
- test and typecheck results;
- any deviation from this task and why.

Do not broaden the slice beyond the parcours_bulk_input search-referrer experiment.
