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
