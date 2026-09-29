# User journey

Three people are involved:

| Who | Role |
|---|---|
| **Architect** | The main user. Walks the site, reviews what the app understood, sends the proposal. |
| **Homeowner** | Receives the proposal and accepts it. |
| **Contractor** | Receives the scope of work and materials list once the job is accepted. |

## The ten steps

| # | Step | Who | What happens | Status |
|---|---|---|---|---|
| 1 | **Set up the job** (about 30 seconds) | Architect | Creates a project with the client name and address. From the address, the app fills in the climate zone, which decides which plants to suggest. | Not built |
| 2 | **Walk the site** | Architect | Wears the Plaud and talks through the property one area at a time: where they are, its size, its condition, what should change. Takes photos on their phone along the way. | Plaud auth built |
| 3 | **Sync** | — | The recording transfers off the device and gets transcribed. | API built, needs a device to test |
| 4 | **Extract** (in the background) | — | An LLM turns the transcript into a structured [site model](02-site-model.md). | **Built** |
| 5 | **Review** | Architect | Gets a checklist, fills in the flagged gaps, and approves. This keeps the architect in control. | Gaps are flagged; editing not built |
| 6 | **Generate the design** | — | The app suggests plants suited to the climate zone and each area's sun and water, plus hardscape materials. | Not built |
| 7 | **Render** | — | Each area gets a before/after image made by editing the site photo, plus a simple overhead 2D plan. | Not built |
| 8 | **Quote** | — | Itemized costs for removal, hardscape, plants, irrigation and labor, ideally in good / better / best tiers. | Catalog and pricing data loaded |
| 9 | **Send the proposal** | Homeowner | Gets a link to a web page with the renders, plan, quote, and an Accept button. | Not built |
| 10 | **Hand off to the contractor** | Contractor | Once accepted, the app produces a scope of work and a materials list. For the hackathon this can be a slide. | Not built |

## What a walkthrough sounds like

> "Back patio, about 20 by 15, cracked concrete. Client wants flagstone. East fence line, 40 feet,
> full afternoon sun, pollinator border. Pull the dying juniper."

From that, step 4 produces two areas, one measurement each, a removal, two proposed changes, and a
list of what is still missing (how wide is the border? what size is the juniper?). You can try this
exact text on the home page of the web app.
