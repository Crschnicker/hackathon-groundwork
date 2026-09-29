# Graph model

How the 39 exported Postgres tables become a Neo4j graph. The mapping is implemented in
[scripts/plan.ts](scripts/plan.ts); constraints and indexes are in [constraints.cypher](constraints.cypher).

Current snapshot: **30,140 nodes / 222,514 relationships** (AuraDB Free allows 200,000 / 400,000).

## The one rule that shapes everything

**Line items are relationships, not nodes.** The source has ~155,000 line rows (bid lines, PO lines,
sub-bid lines, change-order lines, proposal lines). As nodes they would blow through the Aura Free
node limit; as relationships carrying the line's columns as properties they fit with room to spare.

```
(:Bid)-[:HAS_LINE {id, category, factorCode, partNumber, description, quantity, cost, salePrice,
                   laborHours, lineExtCost, tax, delivery, unit, type, size, …}]->(:Item)
```

- Several `HAS_LINE` relationships between the same bid and item are normal: one per source row,
  told apart by `id`.
- A line whose part number is not in the catalog (custom text, separators, labor adjustments)
  attaches to the sentinel item `(:Item {partNumber: '__CUSTOM__'})`. The line keeps its own
  `partNumber` and `description`, so nothing is lost. 6,288 lines do this.

## Nodes

Property names are the Postgres column names in camelCase, except where noted. `*` marks the key
(unique constraint).

| Label | Key | Source table | Notes |
|---|---|---|---|
| `Item` | `partNumber*` | `inventory` | `description, cost, salePrice, unit, type, size, costCode, factorCode, crossReferences[]` |
| `ItemType` | `code*` | distinct `inventory.type` | `label` — TR Tree, SH Shrub, GCC Ground Cover / Color, L Laterals, M Mainline, … |
| `FactorCode` | `code*` | `factor_code` | `description, laborHours` — a kit: the parts and labor one installed unit needs |
| `ConversionCode` | `code*` | `conversion_code` | `description` |
| `Category` | `key*` | fixed list + `labor_rates` | drains, irrigation, landscape, maintenance, sitework, low_voltage, subcontractor; `laborRate` |
| `Vendor` | `id*` | `vendors` | scrubbed name/company/contact; real city, state, ZIP |
| `ZipTax` | `zip*` | `tax` | `taxRate` |
| `CityTax` | `key*` = `city\|STATE` (lowercase city) | `city_tax` | `city, state, taxRate` |
| `User` | `id*` | `user` | `username` (`admin` / `user<id>`), flags. No credentials. |
| `Customer` | `name*` | `customer` | `customer_` prefix dropped: `address, city, state, zip` |
| `Project` | `name*` | `project` | `project_` prefix dropped |
| `Architect`, `Engineer` | `id*` | `architects`, `engineers` | |
| `Bid` | `bidId*` | `bid` | totals, labor rates, markup, revision fields, `adjustmentData` / `extras` JSON |
| `SubBid` | `subBidId*` | `sub_bid` | |
| `BidAdjustment` | `id*` | `bid_adjustments` | |
| `BidChangeOrder` | `id*` | `bid_change_orders` | empty in this snapshot |
| `Job` | `jobId*` | `jobs` | |
| `ChangeOrder` | `id*` | `change_orders` | |
| `PurchaseOrder` | `poNumber*` | `purchase_orders` | |
| `Comment` | `key*` = `po:<id>` / `co:<id>` | `comments`, `change_order_comments` | `kind`, text replaced by `Comment <id>` |
| `Proposal` | `id*` | `proposals` | |
| `ProposalRecipient`, `ProposalComponent`, `ProposalAmount`, `ProposalOption` | `id*` | `proposal_*` | |
| `GroundworkMeta` | `key*` = `snapshot` | — | `extractedAt`, load options; lets `verify` know what was loaded |

## Relationships

### Catalog

| Pattern | Source |
|---|---|
| `(Item)-[:OF_TYPE]->(ItemType)` | `inventory.type` |
| `(Item)-[:DEFAULT_FACTOR]->(FactorCode)` | `inventory.factor_code` |
| `(FactorCode)-[:INCLUDES {id, quantity}]->(Item)` | `factor_code_items` |
| `(Item)-[:CONVERTS_WITH {quantity}]->(ConversionCode)` | `inventory_conversion_code` |
| `(Vendor)-[:QUOTED {id, jobId, category, price}]->(Item)` | `vendor_item_prices` |

### Bids, jobs, purchasing, proposals

| Pattern | Source |
|---|---|
| `(Customer)-[:HAS_BID]->(Bid)`, `(Project)-[:HAS_BID]->(Bid)` | `bid.customer_name`, `bid.project_name` |
| `(Bid)-[:REVISION_OF]->(Bid)` | `bid.base_bid_id` |
| `(Bid)-[:HAS_LINE {…}]->(Item)` | `bid_factor_code_items` (98,073) |
| `(Bid)-[:HAS_SUB_BID]->(SubBid)-[:HAS_LINE {…}]->(Item)` | `sub_bid`, `sub_bid_items` |
| `(Bid)-[:HAS_ADJUSTMENT]->(BidAdjustment)-[:BY]->(User)` | `bid_adjustments` |
| `(Bid)-[:HAS_BID_CHANGE_ORDER]->(BidChangeOrder)-[:HAS_LINE {section, …}]->(Item)` | `bid_change_order*` |
| `(BidChangeOrder)-[:SECTION {laborHours, laborRate, markupMaterialPct, markupLaborPct}]->(Category)` | `bid_change_order_sections` |
| `(Job)-[:FROM_BID]->(Bid)` | `jobs.bid_id` |
| `(Job)-[:INCLUDES_BID {id, orderIndex, separatorText, isBaseBid}]->(Bid)` | `job_bids` |
| `(Job)-[:ASSIGNED_VENDOR {id, category}]->(Vendor)` | `vendor_category_assignments` |
| `(Job)-[:HAS_CHANGE_ORDER]->(ChangeOrder)-[:HAS_LINE {action, …}]->(Item)` | `change_orders`, `change_order_items` |
| `(ChangeOrder)-[:REVISION_OF]->(ChangeOrder)`, `-[:SNAPSHOT]->(Bid)`, `-[:CREATED_BY]->(User)` | `change_orders` |
| `(Job)-[:HAS_PO]->(PurchaseOrder)-[:HAS_LINE {quantity, unitCost, totalCost, …}]->(Item)` | `purchase_orders`, `purchase_order_items` (45,665) |
| `(PurchaseOrder)-[:FROM_VENDOR]->(Vendor)` | distinct `vendor_id` on the PO's lines |
| `(PurchaseOrder)-[:IN_CATEGORY]->(Category)` | `purchase_orders.category` |
| `(PurchaseOrder\|ChangeOrder)-[:HAS_COMMENT]->(Comment)-[:BY]->(User)` | `comments`, `change_order_comments` |
| `(Bid)-[:HAS_PROPOSAL]->(Proposal)-[:HAS_RECIPIENT\|HAS_COMPONENT\|HAS_AMOUNT\|HAS_OPTION]->(…)` | `proposal*` |
| `(ProposalComponent)-[:HAS_LINE {id, name, value, displayOrder}]->(Proposal)` | `proposal_component_lines` |

### Derived (not foreign keys in the source)

| Pattern | How |
|---|---|
| `(Project)-[:TAXED_AT]->(CityTax)` | city + state match, case-insensitive |
| `(Project)-[:IN_ZIP]->(ZipTax)` | first five digits of the project ZIP |
| `(Project)-[:ARCHITECT]->(Architect)`, `(Project)-[:ENGINEER]->(Engineer)` | the scrubbed names match |

Rows whose foreign key points at nothing (a quote for a deleted vendor, a project in a city that has
no row in `city_tax`) are skipped and counted in the `npm run load` log.

## Example queries

**What does it take to install one unit of a factor code?** Parts, labor, and the best price any
vendor has quoted:

```cypher
MATCH (f:FactorCode {code: $code})-[inc:INCLUDES]->(i:Item)
OPTIONAL MATCH (v:Vendor)-[q:QUOTED]->(i)
RETURN f.description, f.laborHours, i.partNumber, i.description, inc.quantity,
       i.cost, i.salePrice, min(q.price) AS bestVendorPrice
```

**Which shrubs have we actually bid most often, and at what price?**

```cypher
MATCH (:Bid)-[l:HAS_LINE]->(i:Item)-[:OF_TYPE]->(:ItemType {code: 'SH'})
RETURN i.partNumber, i.description, count(l) AS timesBid,
       round(avg(l.cost), 2) AS avgCost, round(avg(l.salePrice), 2) AS avgSalePrice
ORDER BY timesBid DESC LIMIT 20
```

**What usually gets bought alongside an item?** (the basis for "you probably also need…")

```cypher
MATCH (:Item {partNumber: $partNumber})<-[:HAS_LINE]-(b:Bid)-[:HAS_LINE]->(other:Item)
WHERE other.partNumber <> '__CUSTOM__' AND other.partNumber <> $partNumber
RETURN other.partNumber, other.description, count(DISTINCT b) AS bidsTogether
ORDER BY bidsTogether DESC LIMIT 15
```

**Type distribution of the catalog**

```cypher
MATCH (i:Item)-[:OF_TYPE]->(t:ItemType) RETURN t.label, count(i) AS items ORDER BY items DESC
```
