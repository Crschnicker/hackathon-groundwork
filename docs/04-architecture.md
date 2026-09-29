# Architecture

## Stack

| Piece | Technology | Where |
|---|---|---|
| Web app | Next.js 16 (App Router), React 19, Tailwind 4 | `apps/web`, port 3000 |
| API | Node 24, TypeScript, Express 5, zod, pino | `apps/api`, port 4000 |
| Graph access and data tooling | `neo4j-driver`, typed queries, extract / load / verify scripts | `packages/graph` |
| Database | Neo4j (AuraDB Free, or local via `docker-compose.yml`) | — |
| LLM | OpenRouter and Crusoe Cloud, both through one OpenAI-compatible client | `apps/api/src/llm` |
| Recording and transcription | Plaud Embedded (SDK on the phone, APIs on the server) | `apps/api/src/plaud` |

One npm workspace, TypeScript throughout, run directly with `tsx` (no build step in development).
All configuration is in a single `.env` at the repo root, validated in
[`packages/graph/src/env.ts`](../packages/graph/src/env.ts).

## Pipeline

```
 phone + Plaud device                       server                                 browser
 ────────────────────      ─────────────────────────────────────────      ─────────────────────
 record the walkthrough
        │
        ▼
 Plaud SDK syncs audio ──► upload to Plaud storage ──► transcribe
                                                          │
                                                          ▼
                                              transcript ──► LLM ──► site model ──► review checklist
                                                                         │
                                                                         ▼
                                              Neo4j catalog ──► design ──► quote ──► proposal page
                                                                                        │
                                                                                        ▼
                                                                          scope of work + materials
```

## LLM providers

Both providers speak the OpenAI chat-completions protocol, so there is one client
([`chat.ts`](../apps/api/src/llm/chat.ts)) and a small registry
([`providers.ts`](../apps/api/src/llm/providers.ts)).

| | OpenRouter | Crusoe Cloud |
|---|---|---|
| Default model | `openai/gpt-6.1-sol` | `zai-org/GLM-5.3-Flash` |
| Override with | `OPENROUTER_MODEL` | `CRUSOE_MODEL` |
| Structured output | JSON Schema (`response_format`) | JSON mode, schema given in the prompt |
| Good for | Best extraction quality | Fast, inexpensive open-weight models |

- `LLM_PROVIDER` picks the default. If it fails or has no key, the other one is tried.
- A request can force a provider with `"provider": "openrouter"` or `"crusoe"`; then there is no fallback.
- Structured calls (`chatJson`) validate the reply against a zod schema and ask the model to
  repair it once if validation fails. Callers never receive unvalidated data.

## Plaud

Plaud Embedded has three credentials, used for three different things:

| Credential | `.env` | Used for |
|---|---|---|
| Client ID + secret key | `PLAUD_CLIENT_ID`, `PLAUD_SECRET_KEY` | Partner token → per-user tokens for the phone SDK and file upload |
| API key | `PLAUD_API_KEY` | Transcription API (sent with the client ID) |

The secret key and API key stay on the server. The phone only ever receives a short-lived user
token from `POST /api/plaud/user-token`.

The Embedded SDK is native (iOS, Android), with wrappers for React Native, Flutter and Capacitor.
Groundwork's web app cannot talk to the device directly; the phone side is a thin app whose job is
to pair the device, sync the recording, and hand the audio to the API. The reference material is in
[`.agents/skills/`](../.agents/skills).

Supported devices: **Plaud Note Pro** and **Plaud NotePin S** only.

Three things Plaud does not make obvious:

- **Transcription is locked until a device is bound.** Until the phone app has bound a Plaud
  device under our client ID, the Transcription API answers `403 DEVICE_MISSING`. Upload works
  before that; transcription does not.
- **A user token lasts 24 hours at most.** Asking for longer is refused. The phone app renews
  its own from `POST /api/plaud/user-token`.
- **Transcription is batch only.** No streaming and no partial results, which is why a walk is
  recorded in chunks (below).

## Walks: recording in chunks

A 30-minute walk recorded as one file is transcribed only after the walk is over. A walk is
instead cut into chunks, 90 seconds by default, and each chunk is transcribed while the
architect keeps walking.

```
 phone                                       server (apps/api/src/walks)
 ─────                                       ───────────────────────────
 every 90 s: stop the device's recording,
 start the next one straight away
 sync the closed recording over Bluetooth
 POST /api/walks/:id/chunks  ──────────────► upload to Plaud ──► transcribe ──► poll
                                             stitch every finished chunk, in recording order
                                             re-extract the site model from the whole transcript
 GET /api/walks/:id  ◄────────────────────── transcript and site model so far
```

- Chunks are joined with a space, so a sentence split by a cut reads straight through.
- A chunk that has not finished leaves `[part of the recording is not transcribed yet]` in its
  place, so the model does not join the text either side of it.
- One extraction runs per walk at a time; chunks that finish meanwhile share the next run.
- Walk state is kept in memory and mirrored to `.groundwork/walks.json` (gitignored), so a
  dev-server restart does not lose a walk in progress.
- `/api/walks` and `POST /api/plaud/user-token` require `Authorization: Bearer <WALK_API_TOKEN>`
  when `WALK_API_TOKEN` is set. Set it before opening a tunnel.

`npm run walk:simulate -- <audio file>` plays the phone's part from a file: it cuts the audio
with ffmpeg, posts the chunks, and prints how long each took. The phone app is described in
[apps/mobile/ios/README.md](../apps/mobile/ios/README.md).

## API

Built:

| Method and path | Journey step | Does |
|---|---|---|
| `GET /health` | — | Neo4j connectivity and which integrations are configured |
| `GET /api/items?q=&type=&limit=` | 8 | Search the catalog |
| `GET /api/item-types` | 8 | Item types with counts |
| `GET /api/categories` | 8 | Quote sections with labor rate and historical line count |
| `GET /api/factor-codes/:code` | 8 | A kit: its parts, labor hours, best vendor quote per part |
| `GET /api/plaud/status` | 3 | Confirms the Plaud credentials work |
| `POST /api/plaud/user-token` | 2 | Token for the phone SDK |
| `POST /api/plaud/recordings?userId=&filetype=` | 3 | Upload raw audio (mp3, m4a, wav), start transcription |
| `POST /api/plaud/transcriptions` | 3 | Transcribe audio that is already at a URL |
| `GET /api/plaud/transcriptions/:id` | 3 | Poll; `done` tells the client when to stop |
| `POST /api/plaud/transcriptions/:id/site-model` | 3 → 4 | Finished transcript straight to a site model |
| `POST /api/site-model/extract` | 4 | Transcript text → site model |
| `POST /api/walks` | 3 | Start a walk (`userId`, optional `cutSeconds`, `language`, `hotwords`) |
| `POST /api/walks/:id/chunks?key=&startedAt=&filetype=` | 3 | One chunk of raw audio; answers at once, processes in the background |
| `GET /api/walks/:id` | 3 → 4 | Transcript and site model so far, and each chunk's state and timings |
| `POST /api/walks/:id/finish` | 3 | The recorder has stopped; chunks in flight still finish |
| `GET /api/walks` | — | Walks, newest first |
| `GET /api/llm/providers` | — | Which LLM providers are configured |
| `POST /api/llm/chat` | — | Raw chat passthrough, for testing prompts |

Planned:

| Method and path | Journey step | Does |
|---|---|---|
| `POST /api/projects` | 1 | Create a project; climate zone from the ZIP |
| `PATCH /api/projects/:id/site-model` | 5 | Save the architect's corrections and approval |
| `POST /api/projects/:id/design` | 6 | Plant and material suggestions per area |
| `POST /api/projects/:id/renders` | 7 | Before/after images and the 2D plan |
| `POST /api/projects/:id/quote` | 8 | Itemized quote in three tiers |
| `GET /p/:token` (web) | 9 | The homeowner's proposal page with Accept |
| `GET /api/projects/:id/handoff` | 10 | Scope of work and materials list |

Projects and site models will be stored in the same graph as `(:SiteProject)-[:HAS_AREA]->(:Area)`,
so a quote is a query that joins what was said on site to the catalog.

## Before this goes anywhere public

The API has no login yet. The walk endpoints and `POST /api/plaud/user-token` take a shared
token (`WALK_API_TOKEN`), which is enough for a test and not for users. The recording upload and
`POST /api/llm/chat` spend money and are still open; they must sit behind a login first. CORS is
limited to `WEB_ORIGIN` (default `http://localhost:3000`).
