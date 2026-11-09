import type { Browser } from "playwright-core";

/**
 * Chromium for evidence collection. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE in production
 * (e.g. Docker image with Chromium); locally Playwright's own browser cache is used.
 * Returns null when no browser can be launched so collectors degrade to fetch-only evidence.
 */
let shared: Promise<Browser | null> | null = null;

export function getBrowser(): Promise<Browser | null> {
  shared ??= (async () => {
    try {
      const { chromium } = await import("playwright-core");
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
      return await chromium.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    } catch {
      return null;
    }
  })();
  return shared.then((b) => {
    if (!b || !b.isConnected()) shared = null;
    return b;
  });
}

export async function closeBrowser() {
  const b = await shared;
  shared = null;
  await b?.close().catch(() => undefined);
}

/**
 * Drop the shared browser without waiting for it: used when Chromium stops
 * responding (for example a page or context close that never returns), so the
 * next collection launches a fresh browser instead of queueing behind a wedged one.
 */
export function discardBrowser() {
  const current = shared;
  shared = null;
  void current?.then((b) => b?.close().catch(() => undefined));
}

/**
 * Wait for a teardown step (page or context close) for at most `ms`.
 * Returns false when it did not finish in time; the caller carries on regardless.
 */
export async function settleWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const done = await Promise.race([
    p.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return done;
}
