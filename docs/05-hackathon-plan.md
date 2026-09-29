# Hackathon plan

A starting point for the team to edit. Nothing here is decided until someone puts a name on it.

## Milestones

| # | Milestone | Done when | Owner | Status |
|---|---|---|---|---|
| 0 | Foundation | Catalog in Neo4j; web → API → graph works; LLM and Plaud credentials verified | | Done |
| 1 | Transcript to site model | Pasting a walkthrough returns areas, measurements and flagged gaps | | Done |
| 2 | Recording to transcript | Audio from a Plaud device arrives as text without anyone copying files | | API ready; needs the phone app and a device |
| 3 | Review | The architect can fix and approve the site model | | |
| 4 | Quote | An approved site model produces an itemized quote in three tiers | | |
| 5 | Design and render | Plant suggestions per area; one before/after image | | |
| 6 | Proposal page | A link the homeowner can open and accept | | |
| 7 | Hand-off | Scope of work and materials list (a slide is fine) | | |

If time runs short, the order to protect is 2 → 3 → 4 → 6: record, review, quote, send. Rendering
is the most impressive and the most likely to slip.

## Open decisions

- **Phone app:** native, React Native, or Capacitor around the existing web app? The Plaud SDK
  needs one of them.
- **Climate zone:** which source maps a ZIP to a zone?
- **Hardscape prices:** the catalog is thin on flagstone, pavers and concrete. Add items by hand,
  or price hardscape per square foot?
- **Image model:** which one edits the site photo for the before/after?

## Demo script

1. Create the job from an address. The climate zone appears.
2. Play a 30-second clip of a walkthrough recorded on the Plaud.
3. Show the site model it produced, with two gaps flagged.
4. Fill the gaps, approve.
5. Show the quote: good, better, best.
6. Open the proposal link on a phone and press Accept.
7. One slide: the scope of work and materials list the contractor receives.

## Risks

| Risk | Fallback |
|---|---|
| No supported Plaud device on the day (Note Pro or NotePin S only) | Upload a recorded audio file; the rest of the pipeline is the same |
| AuraDB Free pauses after 72 hours idle | Resume it in the Aura console, or `npm run load -- --reset` into a new instance |
| An LLM provider is down or rate-limited | The API falls back to the other provider automatically |
| Venue Wi-Fi | Local Neo4j with `docker compose up`, and a recorded run of the demo |
