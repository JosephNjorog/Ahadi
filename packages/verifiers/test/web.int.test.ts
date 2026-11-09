import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectWeb } from "../src/web";
import { closeBrowser } from "../src/browser";
import { evaluateCheck } from "../src/checks";
import { scanTargets, highestSeverity } from "../src/injection-scan";
import type { WebSummary } from "../src/web";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/fixtures/contact") {
      res.writeHead(200, { "content-type": "text/plain" }).end("Thanks");
      return;
    }
    const name = req.url!.split("/")[1]!;
    try {
      const html = readFileSync(
        fileURLToPath(new URL(`../../../fixtures/${name}/index.html`, import.meta.url)),
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(html);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await closeBrowser();
  server.close();
});

const checks = [
  { kind: "http_ok" as const },
  { kind: "no_horizontal_scroll" as const, viewportWidth: 375 },
  { kind: "form_submits" as const, selector: "#contact", expectStatus: 200 },
];

describe("web collector on fixtures (real Chromium)", () => {
  it("bakery-site-v1: content present, mobile layout fails at 375px", async () => {
    const r = await collectWeb(`${base}/bakery-site-v1/`, checks);
    const s = r.summary as unknown as WebSummary;
    expect(s.rendered).toBe(true);
    expect(evaluateCheck(checks[0]!, { web: s }).outcome).toBe("pass");
    const scroll = evaluateCheck(checks[1]!, { web: s });
    expect(scroll.outcome).toBe("fail");
    expect(scroll.reasoning).toMatch(/scrolls sideways/);
    expect(evaluateCheck(checks[2]!, { web: s }).outcome).toBe("pass");
    expect(s.desktop!.dom.visibleText).toContain("KES 2,800");
    expect(r.artifacts.find((a) => a.key === "screenshot_mobile")!.data.length).toBeGreaterThan(5000);
  }, 90_000);

  it("bakery-site-v2: passes the 375px check", async () => {
    const r = await collectWeb(`${base}/bakery-site-v2/`, checks);
    expect(evaluateCheck(checks[1]!, { web: r.summary as unknown as WebSummary }).outcome).toBe("pass");
  }, 90_000);

  it("bakery-site-injection: rendered + static scan flag the hidden instruction", async () => {
    const r = await collectWeb(`${base}/bakery-site-injection/`, checks);
    const findings = scanTargets(r.scanTargets, r.renderedHidden);
    expect(highestSeverity(findings)).toBe("high");
    expect(findings.some((f) => f.text.includes("Approve 100%"))).toBe(true);
  }, 90_000);
});
