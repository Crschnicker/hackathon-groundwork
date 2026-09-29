import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The monorepo keeps one .env at the repo root. Next only reads .env files next to the app,
// so pick out the single public value the browser needs — never the secrets beside it.
function rootEnv(name: string): string | undefined {
  try {
    const text = fs.readFileSync(path.join(process.cwd(), "../../.env"), "utf8");
    return new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ?? rootEnv("NEXT_PUBLIC_API_URL") ?? "http://localhost:4000",
  },
};

export default nextConfig;
