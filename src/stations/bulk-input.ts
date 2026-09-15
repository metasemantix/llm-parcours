import type { Env } from "../index.ts";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]!);

export async function handleBulkInputRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const observationId = crypto.randomUUID();
  const observedAt = new Date().toISOString();
  const requestTarget = `${url.pathname}${url.search}`;
  const referrer = request.headers.get("referer");
  const userAgent = request.headers.get("user-agent");

  const insertion = await env.DB.prepare(
    "INSERT INTO bulk_input_observations (id, observed_at, method, request_target, referrer, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(observationId, observedAt, request.method, requestTarget, referrer, userAgent).run();
  if (!insertion.success) throw new Error("bulk_input_observation_insert_failed");

  const display = (value: string | null) => value === null ? "(none)" : escapeHtml(value);
  const canonical = escapeHtml(`${url.origin}/experiments/parcours_bulk_input`);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>parcours_bulk_input — LLM Parcours</title>
<meta name="description" content="parcours_bulk_input search-referrer transport probe.">
<meta name="robots" content="index,follow"><link rel="canonical" href="${canonical}"></head>
<body><main><h1>parcours_bulk_input</h1>
<p>The parcours_bulk_input experiment records request evidence delivered after a search result is followed.</p>
<dl><dt>Observation ID:</dt><dd>${escapeHtml(observationId)}</dd>
<dt>Observed at:</dt><dd>${escapeHtml(observedAt)}</dd>
<dt>Method:</dt><dd>${escapeHtml(request.method)}</dd>
<dt>Request target:</dt><dd>${escapeHtml(requestTarget)}</dd>
<dt>Referer:</dt><dd>${display(referrer)}</dd>
<dt>User-Agent:</dt><dd>${display(userAgent)}</dd></dl></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...NO_CACHE_HEADERS } });
}

export function robotsResponse(request: Request): Response {
  const sitemap = `${new URL(request.url).origin}/sitemap.xml`;
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export function sitemapResponse(request: Request): Response {
  const origin = new URL(request.url).origin;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeHtml(`${origin}/`)}</loc></url><url><loc>${escapeHtml(`${origin}/experiments/parcours_bulk_input`)}</loc></url></urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
