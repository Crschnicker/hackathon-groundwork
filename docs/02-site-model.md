# Site model

The structured result of step 4: what the LLM extracts from a walkthrough transcript. It is the
contract between the recording side of the app (steps 2–4) and the design and quote side (steps 6–8).

The schema is code: [apps/api/src/site-model/schema.ts](../apps/api/src/site-model/schema.ts).
This page describes it; if they disagree, the code wins.

## Shape

```
SiteModel
├─ areas[]                 one per part of the property the architect talked about
│   ├─ name                "Back patio", "East fence line"
│   ├─ existingFeatures[]  { feature, condition }
│   ├─ measurements[]      { subject, lengthFt, widthFt, areaSqFt, asSpoken }
│   ├─ conditions          { sun, slope, drainage, notes }
│   ├─ removals[]          { item, quantity, reason }
│   └─ proposedChanges[]   { change, category, material }
├─ clientPreferences[]     what the client asked for, in plain words
└─ missing[]               { area, question } — gaps for the architect to fill in at review
```

## Fields

| Field | Values | Used by |
|---|---|---|
| `measurements.lengthFt / widthFt / areaSqFt` | feet and square feet; `asSpoken` keeps the original words ("about 20 by 15") | Quote quantities |
| `conditions.sun` | `full_sun`, `part_sun`, `part_shade`, `full_shade` | Plant suggestions |
| `conditions.slope` | `none`, `slight`, `moderate`, `steep` | Drainage, labor |
| `conditions.drainage` | `good`, `fair`, `poor` | Plant suggestions, drains |
| `proposedChanges.category` | `removal`, `hardscape`, `plants`, `irrigation`, `drainage`, `lighting`, `other` | Maps to quote sections |
| `missing.question` | A short question, e.g. "What size is the juniper to be removed?" | Review checklist (step 5) |

Every field is always present. Unknown values are `null`, never guessed.

## Rules the extraction follows

1. Only record what was said. No invented measurements, conditions or features.
2. Spoken sizes are converted to feet, and the area is computed when both sides are given.
3. Anything a quote needs that was not said goes in `missing`.

## How categories map to the catalog

| Site model category | Catalog section (`Category.key`) | Item types |
|---|---|---|
| `plants` | `landscape` | Tree, Shrub, Ground Cover / Color, Sod, Soil Prep, Amendments |
| `irrigation` | `irrigation` | Point of Connection, Mainline, Laterals, Control Valve, Pump, Sleeves |
| `drainage` | `drains` | drain pipe and fittings |
| `hardscape` | `sitework` | Aggregates, Boulders, Gravel, Header |
| `lighting` | `low_voltage` | fixtures, transformers, wire |
| `removal` | labor only | — |

The catalog is strongest on plants, irrigation and drains. Hardscape such as flagstone or pavers is
thin; expect to add those items by hand or price them per square foot.

## Try it

```bash
curl -X POST http://localhost:4000/api/site-model/extract \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Back patio, about 20 by 15, cracked concrete. Client wants flagstone."}'
```
