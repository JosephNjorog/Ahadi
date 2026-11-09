import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// One .env at the repo root serves the web app, worker and scripts.
config({ path: path.resolve(here, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingRoot: path.resolve(here, "../.."),
  transpilePackages: [
    "@ahadi/core",
    "@ahadi/db",
    "@ahadi/ledger",
    "@ahadi/paypal",
    "@ahadi/queue",
    "@ahadi/services",
    "@ahadi/worker",
  ],
  serverExternalPackages: ["pg", "pino", "bullmq", "ioredis"],
  env: {
    NEXT_PUBLIC_PAYPAL_CLIENT_ID:
      process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
