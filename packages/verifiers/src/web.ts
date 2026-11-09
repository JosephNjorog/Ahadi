import type { BrowserContext, Page } from "playwright-core";
import { parse } from "node-html-parser";
import type { MachineCheck } from "@ahadi/core";
import { getBrowser } from "./browser";
import { mapLimit, safeFetch } from "./fetch";
import { emptyResult, type CollectorResult } from "./types";

/** SPEC §9.1 web collector. */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 375, height: 812 };
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export interface DomSummary {
  title: string;
  metaDescription: string | null;
  headings: { level: number; text: string }[];
  visibleText: string;
  links: { text: string; href: string }[];
  forms: {
    selector: string;
    action: string | null;
    method: string;
    fields: { name: string; type: string; required: boolean }[];
  }[];
  images: { src: string; alt: string | null; broken: boolean }[];
}

export interface WebSummary {
  url: string;
  finalUrl: string | null;
  status: number | null;
  rendered: boolean;
  desktop?: {
    dom: DomSummary;
    consoleErrors: string[];
    failedRequests: string[];
    lcpMs: number | null;
    screenshotKey: string;
  };
  mobile?: {
    dom: DomSummary;
    horizontalScroll: boolean;
    scrollWidth: number;
    screenshotKey: string;
    lcpMs: number | null;
  };
  scrollChecks: Record<string, { horizontalScroll: boolean; scrollWidth: number }>;
  linkCheck: { checked: number; broken: { href: string; status: number | string }[] };
  formTests: Record<string, { status: number | null; error?: string }>;
  lighthouse: null;
  fetchOnly?: { title: string; text: string; headings: string[] };
}

const LCP_SCRIPT = `
  window.__ahadiLcp = null;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__ahadiLcp = Math.round(last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {}
`;

async function domSummary(page: Page): Promise<DomSummary> {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const s = getComputedStyle(el);
      const r = (el as HTMLElement).getBoundingClientRect();
      return (
        s.display !== "none" &&
        s.visibility !== "hidden" &&
        Number(s.opacity) > 0 &&
        r.width > 0 &&
        r.height > 0
      );
    };
    const cssPath = (el: Element) =>
      el.id
        ? `#${el.id}`
        : `${el.tagName.toLowerCase()}${el.getAttribute("name") ? `[name="${el.getAttribute("name")}"]` : ""}`;
    return {
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
      headings: [...document.querySelectorAll("h1,h2,h3,h4")]
        .filter(vis)
        .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? "").trim().slice(0, 200) })),
      visibleText: (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").slice(0, 20000),
      links: [...document.querySelectorAll("a[href]")].slice(0, 200).map((a) => ({
        text: (a.textContent ?? "").trim().slice(0, 80),
        href: (a as HTMLAnchorElement).href,
      })),
      forms: [...document.querySelectorAll("form")].map((f) => ({
        selector: cssPath(f),
        action: f.getAttribute("action"),
        method: (f.getAttribute("method") ?? "get").toLowerCase(),
        fields: [...f.querySelectorAll("input,textarea,select")].map((i) => ({
          name: i.getAttribute("name") ?? "",
          type: (i.getAttribute("type") ?? i.tagName).toLowerCase(),
          required: i.hasAttribute("required"),
        })),
      })),
      images: [...document.querySelectorAll("img")].slice(0, 100).map((img) => ({
        src: (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src,
        alt: img.getAttribute("alt"),
        broken: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth === 0,
      })),
    };
  });
}

/** Text the user can't see but an HTML-reading model would: computed-style hidden elements. */
async function renderedHidden(page: Page): Promise<{ text: string; location: string; reason: string }[]> {
  return page.evaluate(() => {
    const out: { text: string; location: string; reason: string }[] = [];
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    for (const el of document.querySelectorAll("body *")) {
      const text = (el.textContent ?? "").trim();
      if (!text || text.length < 8 || el.children.length > 0) continue;
      const s = getComputedStyle(el);
      const r = (el as HTMLElement).getBoundingClientRect();
      let reason = "";
      if (s.display === "none") reason = "display:none";
      else if (s.visibility === "hidden") reason = "visibility:hidden";
      else if (Number(s.opacity) === 0) reason = "opacity:0";
      else if (parseFloat(s.fontSize) < 2) reason = `font-size ${s.fontSize}`;
      else if (r.right < 0 || r.bottom < 0 || r.left > 10000) reason = "off-screen";
      else if (
        s.color === s.backgroundColor ||
        (s.backgroundColor === "rgba(0, 0, 0, 0)" && s.color === bodyBg)
      )
        reason = "same color as background";
      if (reason)
        out.push({
          text: text.slice(0, 2000),
          location: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""),
          reason,
        });
    }
    return out.slice(0, 50);
  });
}

async function newContext(
  viewport: { width: number; height: number },
  mobile: boolean,
): Promise<BrowserContext | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  return browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile ? MOBILE_UA : undefined,
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
}

/**
 * Compare against the configured device width, not window.innerWidth: with mobile emulation
 * Chromium widens the layout viewport to fit wide content, which would hide the overflow.
 */
async function measureScroll(page: Page, deviceWidth: number) {
  const m = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    innerWidth: window.innerWidth,
  }));
  return {
    scrollWidth: m.scrollWidth,
    innerWidth: deviceWidth,
    horizontalScroll: m.scrollWidth > deviceWidth + 1,
  };
}

export async function collectWeb(url: string, checks: MachineCheck[]): Promise<CollectorResult> {
  const result = emptyResult();
  const summary: WebSummary = {
    url,
    finalUrl: null,
    status: null,
    rendered: false,
    scrollChecks: {},
    linkCheck: { checked: 0, broken: [] },
    formTests: {},
    lighthouse: null,
  };

  const desktop = await newContext(DESKTOP, false);
  if (!desktop) {
    result.warnings.push(
      "No headless browser available: collected HTML only. Visual criteria will need a human.",
    );
    await fetchOnly(url, result, summary);
    result.summary = summary as unknown as Record<string, unknown>;
    return result;
  }

  try {
    // Desktop
    await desktop.addInitScript(LCP_SCRIPT);
    const page = await desktop.newPage();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));
    page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 300)));
    page.on("requestfailed", (r) =>
      failedRequests.push(`${r.method()} ${r.url().slice(0, 200)} — ${r.failure()?.errorText ?? "failed"}`),
    );
    page.on(
      "response",
      (r) => r.status() >= 400 && failedRequests.push(`${r.status()} ${r.url().slice(0, 200)}`),
    );
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 }).catch(async (e) => {
      result.warnings.push(`Desktop load: ${(e as Error).message.split("\n")[0]}`);
      return page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(() => null);
    });
    summary.status = res?.status() ?? null;
    summary.finalUrl = page.url();
    summary.rendered = Boolean(res);
    const html = await page.content();
    result.scanTargets.push({ content: html, location: "rendered HTML (desktop)", format: "html" });
    if (res) {
      const raw = await res.text().catch(() => "");
      if (raw && raw !== html)
        result.scanTargets.push({ content: raw, location: "served HTML", format: "html" });
    }
    result.renderedHidden = await renderedHidden(page).catch(() => []);
    const dom = await domSummary(page);
    const lcp =
      (await page
        .evaluate(() => (window as unknown as { __ahadiLcp: number | null }).__ahadiLcp)
        .catch(() => null)) ?? null;
    const shot = await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 70,
      clip: undefined,
      timeout: 30_000,
    });
    result.artifacts.push({
      key: "screenshot_desktop",
      role: "evidence",
      kind: "screenshot",
      mime: "image/jpeg",
      data: shot,
      label: "Full-page screenshot, desktop 1440×900",
      meta: { viewport: DESKTOP },
    });
    result.imageKeys.push("screenshot_desktop");
    summary.desktop = {
      dom,
      consoleErrors: consoleErrors.slice(0, 30),
      failedRequests: [...new Set(failedRequests)].slice(0, 30),
      lcpMs: lcp,
      screenshotKey: "screenshot_desktop",
    };
    result.artifacts.push({
      key: "dom_snapshot",
      role: "evidence",
      kind: "dom",
      mime: "application/json",
      data: Buffer.from(JSON.stringify(dom)),
      label: "DOM snapshot (desktop)",
    });
    result.untrustedBlocks.push({
      id: "visible-text-desktop",
      source: "deliverable",
      text: dom.visibleText.slice(0, 15000),
    });

    // Form tests
    for (const c of checks) {
      if (c.kind !== "form_submits") continue;
      summary.formTests[c.selector] = await testForm(desktop, url, c.selector);
    }
    await page.close();

    // Mobile (375×812 + mobile UA)
    const mobile = await newContext(MOBILE, true);
    if (mobile) {
      await mobile.addInitScript(LCP_SCRIPT);
      const mp = await mobile.newPage();
      await mp
        .goto(url, { waitUntil: "networkidle", timeout: 30_000 })
        .catch(() => mp.goto(url, { waitUntil: "load", timeout: 30_000 }).catch(() => null));
      const m = await measureScroll(mp, MOBILE.width);
      const mdom = await domSummary(mp);
      const mlcp =
        (await mp
          .evaluate(() => (window as unknown as { __ahadiLcp: number | null }).__ahadiLcp)
          .catch(() => null)) ?? null;
      const mshot = await mp.screenshot({ fullPage: true, type: "jpeg", quality: 70, timeout: 30_000 });
      result.artifacts.push({
        key: "screenshot_mobile",
        role: "evidence",
        kind: "screenshot",
        mime: "image/jpeg",
        data: mshot,
        label: "Full-page screenshot, mobile 375×812",
        meta: { viewport: MOBILE, scrollWidth: m.scrollWidth },
      });
      result.imageKeys.push("screenshot_mobile");
      summary.mobile = {
        dom: mdom,
        horizontalScroll: m.horizontalScroll,
        scrollWidth: m.scrollWidth,
        screenshotKey: "screenshot_mobile",
        lcpMs: mlcp,
      };
      summary.scrollChecks["375"] = { horizontalScroll: m.horizontalScroll, scrollWidth: m.scrollWidth };
      // Extra widths requested by criteria.
      for (const c of checks) {
        if (c.kind !== "no_horizontal_scroll" || summary.scrollChecks[String(c.viewportWidth)]) continue;
        await mp.setViewportSize({ width: c.viewportWidth, height: 812 });
        await mp.waitForTimeout(300);
        const s = await measureScroll(mp, c.viewportWidth);
        summary.scrollChecks[String(c.viewportWidth)] = {
          horizontalScroll: s.horizontalScroll,
          scrollWidth: s.scrollWidth,
        };
      }
      await mobile.close();
    }

    // Internal link check (HEAD, fall back to GET).
    const origin = new URL(summary.finalUrl ?? url).origin;
    const internal = [
      ...new Set(dom.links.map((l) => l.href.split("#")[0]!).filter((h) => h.startsWith(origin))),
    ].slice(0, 25);
    const statuses = await mapLimit(internal, 5, async (href) => {
      try {
        let r = await safeFetch(href, { method: "HEAD", timeoutMs: 8000 });
        if (r.status === 405 || r.status === 501)
          r = await safeFetch(href, { timeoutMs: 8000, maxBytes: 64_000 });
        return { href, status: r.status as number | string };
      } catch (e) {
        return { href, status: (e as Error).message.slice(0, 80) };
      }
    });
    summary.linkCheck = {
      checked: internal.length,
      broken: statuses.filter((s) => typeof s.status !== "number" || s.status >= 400),
    };
  } finally {
    await desktop.close().catch(() => undefined);
  }

  result.artifacts.push({
    key: "web_report",
    role: "evidence",
    kind: "report",
    mime: "application/json",
    data: Buffer.from(JSON.stringify(summary)),
    label: "Web evidence report",
  });
  result.summary = summary as unknown as Record<string, unknown>;
  return result;
}

async function testForm(
  ctx: BrowserContext,
  url: string,
  selector: string,
): Promise<{ status: number | null; error?: string }> {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    const form = page.locator(selector).first();
    if ((await form.count()) === 0) return { status: null, error: `No element matches ${selector}` };
    const fields = form.locator(
      "input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select",
    );
    const n = await fields.count();
    for (let i = 0; i < n; i++) {
      const f = fields.nth(i);
      const type = (
        (await f.getAttribute("type")) ?? (await f.evaluate((e) => e.tagName.toLowerCase()))
      ).toLowerCase();
      const name = ((await f.getAttribute("name")) ?? "").toLowerCase();
      if (type === "select") {
        const opts = await f.locator("option").count();
        if (opts > 1) await f.selectOption({ index: 1 });
        continue;
      }
      const value =
        type === "email" || name.includes("email")
          ? "verifier@ahadi.test"
          : type === "tel" || name.includes("phone")
            ? "0712345678"
            : type === "number"
              ? "1"
              : type === "date"
                ? "2030-01-15"
                : name.includes("name")
                  ? "Ahadi Verifier"
                  : "Automated Ahadi verification test — please ignore.";
      await f.fill(value).catch(() => undefined);
    }
    const waitResp = page.waitForResponse(
      (r) => r.request().method() !== "GET" || r.request().resourceType() === "document",
      { timeout: 15_000 },
    );
    const submit = form.locator("button[type=submit], input[type=submit], button:not([type])").first();
    if ((await submit.count()) > 0) await submit.click();
    else await form.evaluate((f) => (f as HTMLFormElement).requestSubmit());
    const resp = await waitResp;
    return { status: resp.status() };
  } catch (e) {
    return { status: null, error: (e as Error).message.split("\n")[0]!.slice(0, 200) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function fetchOnly(url: string, result: CollectorResult, summary: WebSummary) {
  try {
    const r = await safeFetch(url);
    summary.status = r.status;
    summary.finalUrl = r.url;
    const html = r.body.toString("utf8");
    result.scanTargets.push({ content: html, location: "served HTML", format: "html" });
    const root = parse(html);
    root.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
    const text = (root.querySelector("body") ?? root).text
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    summary.fetchOnly = {
      title: root.querySelector("title")?.text ?? "",
      text: text.slice(0, 20000),
      headings: root.querySelectorAll("h1,h2,h3").map((h) => h.text.trim()),
    };
    result.untrustedBlocks.push({ id: "page-text", source: "deliverable", text: text.slice(0, 15000) });
    result.artifacts.push({
      key: "served_html",
      role: "evidence",
      kind: "dom",
      mime: "text/html",
      data: r.body,
      label: "Served HTML",
    });
  } catch (e) {
    result.warnings.push(`Fetch failed: ${(e as Error).message}`);
  }
}
