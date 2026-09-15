# Codex task: add Google Search Console verification route

## Context

LLM Parcours is now deployed with the `parcours_bulk_input` search-referrer probe. We are registering the deployed Worker origin as a URL-prefix property in Google Search Console so the probe can be submitted for indexing.

Google supplied this exact verification filename:

`google489597deee918027.html`

and the downloaded verification file contains exactly:

`google-site-verification: google489597deee918027.html`

This is a tiny operational amendment only. Do not modify the `parcours_bulk_input` experiment, its persistence, its crawl/indexing behavior, or the existing binary/trail/alias stations.

## Required implementation

Add an explicit public GET route:

`/google489597deee918027.html`

It must return HTTP 200 with the response body exactly:

`google-site-verification: google489597deee918027.html`

A trailing newline is acceptable only if existing tests make that convention useful; otherwise prefer the exact downloaded file contents with no extra markup.

Use a simple text response. Do not wrap it in an HTML document. `Content-Type: text/html; charset=utf-8` is appropriate for Google's HTML-file verification method.

The route must not:

- touch D1;
- create an observation;
- redirect;
- require authentication;
- depend on query parameters;
- expose any other verification token;
- change robots.txt or sitemap.xml;
- alter the `parcours_bulk_input` endpoint;
- add a generic static-file server.

Keep the implementation explicit and auditable in the existing Worker router. This verification file must remain available after Search Console succeeds, because Google may re-check ownership later.

## Tests

Add a focused test proving that:

1. `GET /google489597deee918027.html` returns 200.
2. The body equals `google-site-verification: google489597deee918027.html` exactly (or exactly plus the deliberately chosen trailing newline).
3. The response content type is HTML/text as intended.
4. Serving the verification route does not create a `bulk_input_observations` row.
5. Existing tests remain green.

## Quality checks

Run:

```sh
npm run typecheck
npm test
git diff --check
```

Fix all failures.

## Final report

Report the files changed, exact route/body behavior, and results of the three quality checks. Do not broaden this amendment beyond Google Search Console ownership verification.
