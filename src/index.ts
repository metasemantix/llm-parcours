import { handleBinaryRequest } from "./stations/binary-static.ts";

export interface Env {
  DB: D1Database;
}

const notFound = () => new Response("not_found\n", { status: 404 });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const isExperiment = new URL(request.url).pathname.startsWith("/binary/");
    try {
      const url = new URL(request.url);
      if (request.method !== "GET") return notFound();
      if (url.pathname === "/") {
        return new Response(
          "<!doctype html><html><head><meta charset=\"utf-8\"><title>LLM Parcours</title></head><body><main><h1>LLM Parcours</h1><p>Experiments testing concrete web-interaction primitives available to deployed LLM agent environments.</p><p><a href=\"/binary/new\">Static Binary Channel</a></p></main></body></html>",
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
