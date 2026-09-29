# Data foundation

Groundwork quotes jobs from a real landscaping catalog: 17,639 items with costs and sale prices,
605 factor-code kits with labor hours, and the line items of about 800 historical bids. It is a
scrubbed copy of a production estimating database, stored in this repo as CSV and loaded into Neo4j.

## You do not need the source database

The scrubbed snapshot is committed under [`data/`](../data). To build the graph:

```bash
npm install
cp .env.example .env        # fill in NEO4J_URI / NEO4J_USERNAME / NEO4J_PASSWORD
npm run load -- --reset     # about 90 seconds against AuraDB Free
npm run verify
```

`--reset` deletes everything in the target database first. Leave it off to load on top of what is
there; loading is idempotent.

| Flag | Loads |
|---|---|
| *(none)* | Everything: 30,140 nodes / 222,514 relationships |
| `--catalog-only` | Items, kits, vendors, vendor quotes, tax tables, users |
| `--max-bids 200` | The catalog plus the 200 most recent bids and what hangs off them |

No Node? [`packages/graph/load-csv.cypher`](../packages/graph/load-csv.cypher) loads the catalog
from a Neo4j Browser tab, reading the CSVs straight from GitHub.

## What is in `data/`

One CSV per table, plus `_manifest.json` (row counts, columns, column types) and
`_source_stats.json` (sizes measured on the source). Empty cells are NULL.

| Group | Tables | Treatment |
|---|---|---|
| Catalog | `inventory`, `factor_code`, `factor_code_items`, `conversion_code`, `inventory_conversion_code`, `labor_rates`, `tax`, `city_tax` | Copied as-is |
| People and companies | `customer`, `project`, `vendors`, `architects`, `engineers`, `user` | Names, addresses and contacts replaced |
| Bids | `bid`, `bid_factor_code_items`, `sub_bid`, `sub_bid_items`, `bid_adjustments`, `bid_change_order*` | Numbers kept, names replaced, free text swept |
| Jobs and purchasing | `jobs`, `job_bids`, `change_order*`, `purchase_orders`, `purchase_order_items`, `comments`, `vendor_*` | Same |
| Proposals | `proposals`, `proposal_*` | Same; terms, notes and plan references removed |

**Not exported:** `audit_logs` (IP addresses, ~317,000 rows), `entity_locks` (temporary edit locks),
`app_settings` (not present in the source).

## What was scrubbed

The repo is public, so anything that identifies a person, customer or address is replaced. Money,
quantities, dates, and **city / state / ZIP** are kept, because tax rates and climate zones depend on them.

| Kind of value | Becomes | Example columns |
|---|---|---|
| Company | `Company 3F9A1C2B` | customer, builder, vendor, misc vendor |
| Person | `Person 8D41E07A` | contacts, architects, engineers, signatures |
| Project name | `Project 5B2210CE` | project, bid, proposal |
| Street address | `4217 Example St` | customer, project, vendor |
| Phone | `555-0142` | every phone column; fax removed |
| Email | `vendor12@example.com`, `user7@example.com` | vendors, users |
| Username | `admin` / `user7` | users |
| Password hashes, reset tokens, last login | column removed | users |
| Notes, comments, terms, plan references | removed, or `Comment 142` | bids, projects, proposals, change orders |
| Free text kept for its content (line descriptions, scope names) | swept: emails, phone numbers and every known name inside the text are replaced | line items, sub-bids, proposal lines |
| City | kept only if it is a known place name | all city columns |
| State | normalized to a two-letter code | all state columns |
| ZIP | kept only if it is a 5- or 9-digit ZIP | all ZIP columns |
| Bid id | kept when it is a code (`B11597-R1`); replaced when it is really a name | all bid id columns |

The same input always produces the same replacement, so a customer in `customer` still joins to
their bids. Replacements are keyed by a secret salt that is not in the repo, so they cannot be reversed.

### Things the source data taught us

These are handled, and worth knowing if you re-extract:

- **Names typed into the wrong field.** About 18 customer rows had a contact name in the city
  column. City values are now checked against known place names instead of trusted.
- **URL-encoded text.** About 44,000 line descriptions were stored as `LEYMUS%20C.%20CANYON%20PRINCE`.
  They are decoded before sweeping, so names inside them are found and the text is readable.
- **Columns the schema file did not list.** The live database had `signature_name` and other
  columns missing from the application's schema. `npm run probe` lists every live column so new
  ones are noticed.

### What is not guaranteed

Free text is swept for every name that appears in a name column, not for names that appear
nowhere else. A supplier or place mentioned only inside a line description can remain. Line
descriptions are product text ("JUNIPER BLUE ARROW 15G"), so this is rare, but it is a limit of the
approach, not a proof of absence.

## Checks that run before data is committed

`npm run verify -- --files-only` fails if any of these is false:

- every table in the manifest is present with the stated row count
- no credential, login or IP column exists
- no email address other than `@example.com`
- no phone number other than `555-01xx`
- none of the terms in `LEAK_CHECK_TERMS` appear (optional: a comma-separated list of real names
  you know are in the source, set in your shell, never committed)

`npm run extract` also audits every column that is copied as-is and reports any that contain a
known name.

## Re-extracting (maintainers only)

Needs read access to the source Postgres and the original `SCRUB_SALT`.

```bash
npm run probe      # read-only: sizes, row counts, every live column → data/_source_stats.json
npm run extract    # read-only: writes data/*.csv and data/_manifest.json
npm run verify -- --files-only
```

Keep the same `SCRUB_SALT` and the replacement names stay the same across extracts. The extract
opens a read-only session and only runs `SELECT`.

The rules are in one file, [`packages/graph/scripts/tables.ts`](../packages/graph/scripts/tables.ts).
A column with no rule is copied as-is, so a new column in the source needs a decision there.

## From catalog to quote line

| Quote needs | Where it comes from |
|---|---|
| The item and its price | `(:Item)` `cost`, `salePrice`, `unit` |
| Everything one installed unit requires | `(:Item)-[:DEFAULT_FACTOR]->(:FactorCode)-[:INCLUDES {quantity}]->(:Item)` |
| Labor | `FactorCode.laborHours` × `Category.laborRate` |
| Sales tax | `(:CityTax)` or `(:ZipTax)` `taxRate` for the project's location |
| A realistic price, not just list price | what the item actually went for: `avg(l.cost)` over `(:Bid)-[l:HAS_LINE]->(:Item)` |
| A cheaper option | `min(q.price)` over `(:Vendor)-[q:QUOTED]->(:Item)` |
| Good / better / best | same type, different `size` (5G, 15G, 24" box) or a different item of that type |

Example queries are in [packages/graph/model.md](../packages/graph/model.md).
