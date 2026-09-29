# Groundwork docs

| Doc | What it answers |
|---|---|
| [01-user-journey.md](01-user-journey.md) | Who uses Groundwork and what happens, step by step |
| [02-site-model.md](02-site-model.md) | The structured data we extract from a walkthrough recording |
| [03-data-foundation.md](03-data-foundation.md) | Where the item catalog came from, what was scrubbed, how to rebuild it |
| [04-architecture.md](04-architecture.md) | The stack, the pipeline, and the API surface per journey step |
| [05-hackathon-plan.md](05-hackathon-plan.md) | Milestones and the demo script |

The graph model itself lives next to the code: [packages/graph/model.md](../packages/graph/model.md).

## Where ideas start

The team's Google Doc is the scratchpad: rough ideas go there first. When something in it is
decided, move it into the matching file here so the repo stays the source of truth. `01` and `02`
were written from that doc.

## Keeping these current

- Change the API or the pipeline → update `04-architecture.md` in the same pull request.
- Change what is exported or how it is scrubbed → update `03-data-foundation.md`.
- Change the graph mapping (`packages/graph/scripts/plan.ts`) → update `packages/graph/model.md`.
