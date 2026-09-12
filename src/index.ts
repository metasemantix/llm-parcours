import { handleBinaryRequest } from "./stations/binary-static.ts";
import { handleDynamicRequest } from "./stations/binary-dynamic.ts";

export interface Env {
  DB: D1Database;
}

const notFound = () => new Response("not_found\n", { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    const isExperiment = pathname.startsWith("/binary/") || pathname.startsWith("/binary-trail/") || pathname.startsWith("/binary-alias/");
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && /^\/binary\/[^/]+\/arm$/.test(url.pathname)) {
        return await handleBinaryRequest(request, env);
      }
      if (url.pathname.startsWith("/binary-trail/")) return await handleDynamicRequest(request, env, "trail");
      if (url.pathname.startsWith("/binary-alias/")) return await handleDynamicRequest(request, env, "alias");
      if (request.method !== "GET") return notFound();
      if (url.pathname === "/") {
        return new Response(
          "<!doctype html><html><head><meta charset=\"utf-8\"><title>LLM Parcours</title></head><body><main><h1>LLM Parcours</h1><p>Experiments testing concrete web-interaction primitives available to deployed LLM agent environments.</p><ul><li><a href=\"/binary/new\">Static Binary Channel</a></li><li><a href=\"/binary-trail/new\">Circular Trail</a></li><li><a href=\"/binary-alias/new\">URL Suffix / Alias Channel</a></li></ul></main></body></html>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      if (url.pathname.startsWith("/binary/")) return await handleBinaryRequest(request, env);
      return notFound();
    } catch {
      return new Response("internal_error\n", {
        status: 500,
        headers: isExperiment
          ? { "Cache-Control": "no-store, no-cache, must-revalidate", Pragma: "no-cache", Expires: "0" }
          : undefined,
      });
    }
  },
};
