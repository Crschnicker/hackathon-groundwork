// Typed read queries used by the API. Property names follow graph/model.md
// (every Postgres column → camelCase; Item key is partNumber).
import neo4j from 'neo4j-driver';
import { run, runOne } from '../driver.ts';

export interface ItemRow {
  partNumber: string;
  description: string | null;
  type: string | null;
  typeLabel: string | null;
  unit: string | null;
  size: string | null;
  cost: number | null;
  salePrice: number | null;
  factorCode: string | null;
}

export interface SearchItemsInput {
  /** free text; matched case-insensitively against description and partNumber */
  q?: string;
  /** inventory.type code, e.g. "TR" (tree), "SH" (shrub) */
  type?: string;
  limit?: number;
}

// The items a search matches; searchItems and countItems must agree on it.
const MATCH_ITEMS = `MATCH (i:Item)
     WHERE i.partNumber <> '__CUSTOM__'
       AND ($q = '' OR toLower(coalesce(i.description, '')) CONTAINS $q OR toLower(i.partNumber) CONTAINS $q)
       AND ($type IS NULL OR i.type = $type)`;

export async function searchItems({ q = '', type, limit = 25 }: SearchItemsInput): Promise<ItemRow[]> {
  return run<ItemRow>(
    `${MATCH_ITEMS}
     OPTIONAL MATCH (i)-[:OF_TYPE]->(t:ItemType)
     OPTIONAL MATCH (i)-[:DEFAULT_FACTOR]->(f:FactorCode)-[:INCLUDES]->()
     // only offer a factor code that actually has a kit (the legacy data uses the text "None")
     WITH DISTINCT i, t, f.code AS factorCode, toLower(coalesce(i.description, '')) AS d
     // whole-word hits first ("tree" before "sTREEt"), then typed catalog items, then A–Z
     ORDER BY CASE WHEN $q = '' OR d STARTS WITH $q OR d CONTAINS (' ' + $q) THEN 0 ELSE 1 END,
              CASE WHEN t IS NULL THEN 1 ELSE 0 END,
              d
     LIMIT $limit
     RETURN i.partNumber AS partNumber, i.description AS description, i.type AS type, t.label AS typeLabel,
            i.unit AS unit, i.size AS size, i.cost AS cost, i.salePrice AS salePrice, factorCode`,
    { q: q.trim().toLowerCase(), type: type ?? null, limit: neo4j.int(Math.min(Math.max(limit, 1), 200)) },
  );
}

/** How many items a search matches in all, whatever the limit of the page being shown. */
export async function countItems({ q = '', type }: Omit<SearchItemsInput, 'limit'>): Promise<number> {
  const row = await runOne<{ total: number }>(`${MATCH_ITEMS} RETURN count(i) AS total`, {
    q: q.trim().toLowerCase(),
    type: type ?? null,
  });
  return row?.total ?? 0;
}

export interface FactorCodeKitRow {
  code: string;
  description: string | null;
  laborHours: number | null;
  partNumber: string;
  itemDescription: string | null;
  quantity: number | null;
  unit: string | null;
  cost: number | null;
  salePrice: number | null;
  bestVendorPrice: number | null;
}

/** The kit of items a factor code pulls in, with its labor hours and the best known vendor price. */
export async function getFactorCodeKit(code: string): Promise<FactorCodeKitRow[]> {
  return run<FactorCodeKitRow>(
    `MATCH (f:FactorCode {code: $code})-[inc:INCLUDES]->(i:Item)
     OPTIONAL MATCH (v:Vendor)-[q:QUOTED]->(i)
     RETURN f.code AS code, f.description AS description, f.laborHours AS laborHours,
            i.partNumber AS partNumber, i.description AS itemDescription, inc.quantity AS quantity,
            i.unit AS unit, i.cost AS cost, i.salePrice AS salePrice, min(q.price) AS bestVendorPrice
     ORDER BY i.description`,
    { code },
  );
}

export interface CategoryRow {
  key: string;
  laborRate: number | null;
  lineCount: number;
}

/** Bid sections (drains, irrigation, landscape, …) with their labor rate and how many historical lines used them. */
export async function listCategories(): Promise<CategoryRow[]> {
  return run<CategoryRow>(
    `MATCH (c:Category)
     OPTIONAL MATCH ()-[l:HAS_LINE {category: c.key}]->()
     RETURN c.key AS key, c.laborRate AS laborRate, count(l) AS lineCount
     ORDER BY c.key`,
  );
}

export interface ItemTypeRow {
  code: string;
  label: string;
  itemCount: number;
}

export async function listItemTypes(): Promise<ItemTypeRow[]> {
  return run<ItemTypeRow>(
    `MATCH (t:ItemType)
     OPTIONAL MATCH (i:Item)-[:OF_TYPE]->(t)
     RETURN t.code AS code, t.label AS label, count(i) AS itemCount
     ORDER BY itemCount DESC`,
  );
}
