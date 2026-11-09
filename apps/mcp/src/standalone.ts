import { createServer } from "node:http";
import { Readable } from "node:stream";
import { log } from "@ahadi/services";
import { handleMcpRequest } from "./server";

/** Standalone MCP server on :3001 (README "Using Ahadi from an AI agent"). In production it is also served by the web app at /mcp. */
const port = Number(process.env.MCP_PORT ?? 3001);

createServer(async (req, res) => {
  if (!req.url?.startsWith("/mcp")) {
    res.writeHead(404).end("Not found. The MCP endpoint is /mcp");
    return;
  }
  try {
    const body =
      req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body,
      duplex: "half",
    } as RequestInit);
    const response = await handleMcpRequest(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body as never).pipe(res);
    else res.end();
  } catch (e) {
    log.error({ err: (e as Error).message }, "mcp request failed");
    res
      .writeHead(500, { "content-type": "application/json" })
      .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
  }
}).listen(port, () => log.info({ port }, "ahadi mcp server listening on /mcp"));
