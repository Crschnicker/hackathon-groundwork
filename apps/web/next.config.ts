import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root. Next only reads .env files next to the app,
// so pick out the single value needed here — never the secrets beside it.
function rootEnv(name: string): string | undefined {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "../../.env"), "utf8");
    return new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Where the Next server reaches the API. The browser never calls the API directly: it calls
// /api/* on its own origin and Next forwards it. That is what lets a phone use the app through
// a single tunnel URL.
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? rootEnv("NEXT_PUBLIC_API_URL") ?? "http://localhost:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      { source: "/health", destination: `${API_URL}/health` },
    ];
  },
  // `npm run tunnel` serves the dev server through a Cloudflare quick tunnel
  allowedDevOrigins: ["*.trycloudflare.com"],
  experimental: {
    // LLM extraction can take longer than the default 30 s proxy timeout
    proxyTimeout: 180_000,
  },
};

export default nextConfig;
