# @groundwork/web

The Groundwork web app (Next.js 16, App Router, Tailwind 4).

Run it from the repo root with `npm run dev`, which also starts the API it depends on.
Setup and configuration are in the [root README](../../README.md).

| Path | What |
|---|---|
| `src/app/page.tsx` | Home page: catalog search and walkthrough → site model |
| `src/components/` | `ItemSearch`, `SiteModelDemo`, `StatusBar` |
| `src/lib/api.ts` | Typed client for the API |

The API address comes from `NEXT_PUBLIC_API_URL` in the root `.env` (default `http://localhost:4000`).

This Next.js version differs from older ones. Before changing routing, data fetching or config,
read the matching guide in `node_modules/next/dist/docs/`.
