# Groundwork

Walk the site, talk it through, get a quote.

A landscape architect records a site walkthrough on a [Plaud](https://www.plaud.ai) device.
Groundwork transcribes it, turns it into a structured model of the yard, and prices the job from a
real catalog of 17,000+ landscaping items. Built for a hackathon.

**Working today:** the item catalog in Neo4j, catalog search, transcript → site model through
OpenRouter or Crusoe, and the server side of Plaud (auth, upload, transcription).
**Not built yet:** project setup, review, design, renders, the quote itself, the proposal page.
See the [user journey](docs/01-user-journey.md) for the full picture.

## Quickstart

You need Node 22 or newer and a Neo4j database. [AuraDB Free](https://neo4j.com/cloud/aura-free/)
works; so does `docker compose up` if you have Docker.

```bash
git clone https://github.com/Crschnicker/hackathon-groundwork.git
cd hackathon-groundwork
npm install
cp .env.example .env          # then fill it in — see the table below
npm run load -- --reset       # builds the graph from data/ (about 90 seconds)
npm run verify                # checks the graph against the snapshot
npm run dev                   # API on :4000, web on :3000
```

Open <http://localhost:3000>. Search for "juniper", open a kit, then paste a walkthrough into the
second panel.

> `--reset` deletes everything in the target database before loading. Do not point it at a
> database you care about.

## Configuration

Everything is in one `.env` at the repo root. It is gitignored; never commit it.

| Variable | Needed for | Where to get it |
|---|---|---|
| `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` | Everything | Aura console, or `neo4j://localhost:7687` / `neo4j` / `groundwork` with Docker |
| `OPENROUTER_API_KEY` | Site model extraction | <https://openrouter.ai/keys> |
| `CRUSOE_API_KEY` | Site model extraction (alternative) | Crusoe Cloud console → Inference |
| `PLAUD_CLIENT_ID`, `PLAUD_SECRET_KEY` | Plaud device auth | [Plaud Developer Portal](https://portal.plaud.ai) |
| `PLAUD_API_KEY` | Plaud transcription | Portal → App Settings → API Keys (not the secret key) |
| `DATABASE_URL`, `SCRUB_SALT` | Re-extracting the snapshot only | Maintainers. You do not need these. |

One LLM key is enough. With both, `LLM_PROVIDER` picks the default and the other is the fallback.

`GET http://localhost:4000/health` shows what is connected.

## What is in here

```
apps/web          Next.js app: catalog search, walkthrough → site model
apps/api          Express API: catalog, LLM providers, Plaud
packages/graph    Neo4j driver, typed queries, extract / load / verify, the graph model
data/             The scrubbed snapshot as CSV, one file per table
docs/             User journey, site model, data foundation, architecture, plan
.agents/skills/   Plaud Embedded reference skills for coding agents
```

## Commands

| Command | Does |
|---|---|
| `npm run dev` | API and web together |
| `npm run tunnel` | Temporary public https URL for the running app, to open it on a phone (needs `cloudflared`) |
| `npm run walk:simulate -- <audio file>` | Send an audio file through the chunked walk pipeline as the phone would (needs `ffmpeg`) |
| `npm run load -- --reset` | Wipe the database and load the snapshot |
| `npm run load -- --catalog-only` | Items, kits, vendors and tax tables only |
| `npm run load -- --max-bids 200` | Catalog plus the 200 most recent bids |
| `npm run verify` | Check the CSVs for leaks and the graph against the snapshot |
| `npm run typecheck` / `npm run lint` | All workspaces |
| `npm run probe` / `npm run extract` | Maintainers: re-read the source database (read-only) |

## About the data

`data/` is a scrubbed copy of a production estimating database. Item prices, quantities, dates and
city / state / ZIP are real. Names, street addresses, phone numbers, emails, notes and credentials
are replaced or removed. What was done, the checks that guard it, and the limits of the approach are
in [docs/03-data-foundation.md](docs/03-data-foundation.md).

If you find something in `data/` that looks like a real person or address, please open an issue
titled "data" without quoting the value, or contact the maintainer directly.

## Docs

- [User journey](docs/01-user-journey.md)
- [Site model](docs/02-site-model.md)
- [Data foundation](docs/03-data-foundation.md)
- [Architecture and API](docs/04-architecture.md)
- [Hackathon plan](docs/05-hackathon-plan.md)
- [Graph model](packages/graph/model.md)

## Admin notes

- **AuraDB Free pauses after 72 hours without use** and is deleted after 30 days paused. Resume it
  in the Aura console. If it is gone, create a new instance and run `npm run load -- --reset`.
- The API has no authentication yet. Run it locally; do not deploy it as it is.
- `npm run tunnel` makes the app reachable by anyone who has the URL, including the endpoints that
  spend LLM credits. Stop it (Ctrl+C) when you are done.
