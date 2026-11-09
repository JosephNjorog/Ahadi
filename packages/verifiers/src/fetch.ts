/** Outbound fetch with a timeout, size cap and a clear User-Agent. Deliverables are untrusted URLs. */
export async function safeFetch(
  url: string,
  opts: { method?: "GET" | "HEAD"; timeoutMs?: number; maxBytes?: number } = {},
) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`Unsupported protocol ${u.protocol}`);
  if (isPrivateHost(u.hostname) && process.env.NODE_ENV === "production")
    throw new Error("Refusing to fetch a private network address");
  const res = await fetch(u, {
    method: opts.method ?? "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    headers: {
      "User-Agent": "AhadiVerifier/1.0 (+https://ahadi-web.onrender.com)",
      Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
    },
  });
  if (opts.method === "HEAD")
    return {
      status: res.status,
      url: res.url,
      contentType: res.headers.get("content-type") ?? "",
      body: Buffer.alloc(0),
    };
  const max = opts.maxBytes ?? 5 * 1024 * 1024;
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return {
    status: res.status,
    url: res.url,
    contentType: res.headers.get("content-type") ?? "",
    body: Buffer.concat(chunks),
  };
}

export function isPrivateHost(host: string): boolean {
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|metadata\.google)/i.test(
    host,
  );
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]!);
      }
    }),
  );
  return out;
}
