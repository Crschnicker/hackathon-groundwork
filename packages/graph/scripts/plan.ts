// data/*.csv → the exact set of nodes and relationships the graph should contain.
// load.ts writes this plan to Neo4j; verify.ts compares the database against it.
// The mapping is documented in ../model.md — keep the two in sync.
import { parse } from 'csv-parse/sync';
import neo4j from 'neo4j-driver';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../src/env.ts';
import type { ColumnType, Manifest } from './tables.ts';

export interface PlanOptions {
  /** Catalog, vendors, tax and users only — no customers, bids, jobs, POs or proposals. */
  catalogOnly?: boolean;
  /** Keep only the N most recent bids (by bid_date) and what hangs off them. */
  maxBids?: number;
}

type Raw = Record<string, string>;
type Props = Record<string, unknown>;
type KeyValue = string | number;

export interface NodeBatch {
  label: string;
  /** property that identifies the node (has a uniqueness constraint) */
  key: string;
  rows: Props[];
}

export interface RelBatch {
  type: string;
  from: { label: string; key: string };
  to: { label: string; key: string };
  /** true: one relationship per source row, matched on its `id`; false: one per (from, to) pair */
  byId: boolean;
  rows: { from: unknown; to: unknown; id?: unknown; props: Props }[];
  /** source table, for log output */
  source: string;
}

export interface Plan {
  manifest: Manifest;
  options: PlanOptions;
  nodes: NodeBatch[];
  rels: RelBatch[];
  /** things that were dropped or redirected, for the load log */
  notes: string[];
  totals: { nodes: number; rels: number; byLabel: Record<string, number>; byType: Record<string, number> };
}

export const CUSTOM_ITEM = '__CUSTOM__';

export const ITEM_TYPE_LABELS: Record<string, string> = {
  TR: 'Tree',
  SH: 'Shrub',
  GCC: 'Ground Cover / Color',
  SD: 'Sod',
  SP: 'Soil Prep',
  FERT: 'Fertilizer',
  AMM: 'Amendments',
  AGG: 'Aggregates',
  BOL: 'Boulders',
  GRAV: 'Gravel',
  HDR: 'Header',
  TRSTK: 'Tree Stake',
  FFAB: 'Filter Fabric',
  POC: 'Point of Connection',
  PMP: 'Pump',
  S: 'Sleeves',
  M: 'Mainline',
  L: 'Laterals',
  CV: 'Control Valve',
};

const BASE_CATEGORIES = ['drains', 'irrigation', 'landscape', 'maintenance', 'sitework', 'low_voltage', 'subcontractor'];

/** Columns that get a shorter property name on the node. Everything else is plain camelCase. */
const RENAME: Record<string, Record<string, string>> = {
  factor_code: { factor_code: 'code' },
  customer: { customer_name: 'name', customer_address: 'address', customer_city: 'city', customer_state: 'state', customer_zip: 'zip' },
  project: { project_name: 'name', project_address: 'address', project_city: 'city', project_state: 'state', project_zip: 'zip' },
  tax: { zip_code: 'zip' },
  vendor_item_prices: { vendor_price: 'price' },
};

const camel = (s: string): string => s.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
const int = (v: string): unknown => neo4j.int(Number(v));

function temporal(value: string, type: 'date' | 'datetime'): unknown {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(?:([+-])(\d{2})(?::?(\d{2}))?|Z)?)?$/.exec(value.trim());
  if (!m) return value; // keep odd values as text rather than lose them
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (type === 'date' || m[4] === undefined) return new neo4j.types.Date(y, mo, d);
  const nanos = Number((m[7] ?? '').padEnd(9, '0'));
  const [h, mi, s] = [Number(m[4]), Number(m[5]), Number(m[6])];
  if (m[8] === undefined) return new neo4j.types.LocalDateTime(y, mo, d, h, mi, s, nanos);
  const offset = (m[8] === '-' ? -1 : 1) * (Number(m[9]) * 3600 + Number(m[10] ?? 0) * 60);
  return new neo4j.types.DateTime(y, mo, d, h, mi, s, nanos, offset);
}

function typed(value: string, type: ColumnType): unknown {
  if (value === '') return null;
  switch (type) {
    case 'int':
      return int(value);
    case 'float': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return value === 'true';
    case 'date':
    case 'datetime':
      return temporal(value, type);
    default:
      return value;
  }
}

export function readManifest(): Manifest {
  const file = path.join(dataDir, '_manifest.json');
  if (!fs.existsSync(file)) throw new Error(`${file} not found — the scrubbed snapshot is missing (git pull, or npm run extract)`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest;
}

export function readTable(manifest: Manifest, table: string): Raw[] {
  const info = manifest.tables[table];
  if (!info) return [];
  return info.files.flatMap((f) => parse(fs.readFileSync(path.join(dataDir, f)), { columns: true, skip_empty_lines: true }) as Raw[]);
}

export function buildPlan(options: PlanOptions = {}): Plan {
  const manifest = readManifest();
  const notes: string[] = [];
  const nodes: NodeBatch[] = [];
  const rels: RelBatch[] = [];
  const keys = new Map<string, Set<string>>(); // label → key values present (as strings)

  const rows = (table: string): Raw[] => readTable(manifest, table);

  /** Typed, camelCased properties of one source row. */
  function props(table: string, row: Raw, omit: string[] = []): Props {
    const types = manifest.tables[table]?.types ?? {};
    const out: Props = {};
    for (const [column, value] of Object.entries(row)) {
      if (omit.includes(column)) continue;
      out[RENAME[table]?.[column] ?? camel(column)] = typed(value, types[column] ?? 'string');
    }
    return out;
  }

  function addNodes(label: string, key: string, list: Props[], keyOf: (p: Props) => KeyValue): void {
    const byKey = new Map<string, Props>();
    for (const p of list) byKey.set(String(keyOf(p)), p);
    if (byKey.size !== list.length) notes.push(`${label}: ${list.length - byKey.size} rows share a key with another row and were merged`);
    keys.set(label, new Set([...(keys.get(label) ?? []), ...byKey.keys()]));
    nodes.push({ label, key, rows: [...byKey.values()] });
  }

  const has = (label: string, key: string): boolean => keys.get(label)?.has(key) ?? false;

  interface RelSpec {
    type: string;
    from: [label: string, key: string];
    to: [label: string, key: string];
    source: string;
    byId?: boolean;
    /** key values are integers in the graph (wrapped for the driver) */
    intFrom?: boolean;
    intTo?: boolean;
  }

  function addRels(spec: RelSpec, list: { from: string; to: string; id?: string; props?: Props }[]): void {
    const kept: RelBatch['rows'] = [];
    const seen = new Set<string>();
    let dangling = 0;
    for (const r of list) {
      if (r.from === '' || r.to === '') continue; // NULL foreign key
      if (!has(spec.from[0], r.from) || !has(spec.to[0], r.to)) {
        dangling++;
        continue;
      }
      if (!spec.byId) {
        const pair = `${r.from}\u0000${r.to}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
      }
      kept.push({
        from: spec.intFrom ? int(r.from) : r.from,
        to: spec.intTo ? int(r.to) : r.to,
        ...(spec.byId && r.id !== undefined ? { id: int(r.id) } : {}),
        props: r.props ?? {},
      });
    }
    if (dangling) notes.push(`${spec.type} (${spec.source}): ${dangling} rows point at a missing ${spec.from[0]} or ${spec.to[0]} and were skipped`);
    rels.push({
      type: spec.type,
      from: { label: spec.from[0], key: spec.from[1] },
      to: { label: spec.to[0], key: spec.to[1] },
      byId: spec.byId ?? false,
      rows: kept,
      source: spec.source,
    });
  }

  // ------------------------------------------------------------------ catalog

  const inventory = rows('inventory');
  const crossRefs = new Map<string, string[]>();
  for (const r of rows('inventory_cross_reference')) {
    crossRefs.set(r.part_number ?? '', [...(crossRefs.get(r.part_number ?? '') ?? []), r.cross_reference_code ?? '']);
  }
  addNodes(
    'Item',
    'partNumber',
    [
      ...inventory.map((r) => ({ ...props('inventory', r), crossReferences: crossRefs.get(r.part_number ?? '') ?? [] })),
      { partNumber: CUSTOM_ITEM, description: 'Custom / non-catalog line (see the relationship for its text)', crossReferences: [] },
    ],
    (p) => p.partNumber as string,
  );
  /** Catalog item for a line, or the sentinel when the part number is custom text. */
  const itemFor = (partNumber: string | undefined): string => (partNumber && has('Item', partNumber) ? partNumber : CUSTOM_ITEM);

  const typeCodes = [...new Set(inventory.map((r) => r.type ?? '').filter(Boolean))];
  addNodes('ItemType', 'code', typeCodes.map((code) => ({ code, label: ITEM_TYPE_LABELS[code] ?? code })), (p) => p.code as string);
  addNodes('FactorCode', 'code', rows('factor_code').map((r) => props('factor_code', r)), (p) => p.code as string);
  addNodes('ConversionCode', 'code', rows('conversion_code').map((r) => props('conversion_code', r)), (p) => p.code as string);

  const laborRates = new Map(rows('labor_rates').map((r) => [norm(r.category ?? ''), Number(r.rate)]));
  const categoryKeys = new Set([...BASE_CATEGORIES, ...laborRates.keys()]);
  if (!options.catalogOnly) {
    for (const r of rows('purchase_orders')) if (r.category) categoryKeys.add(norm(r.category));
    for (const r of rows('vendor_category_assignments')) if (r.category) categoryKeys.add(norm(r.category));
    for (const r of rows('bid_change_order_sections')) if (r.section) categoryKeys.add(norm(r.section));
  }
  addNodes('Category', 'key', [...categoryKeys].map((key) => ({ key, laborRate: laborRates.get(key) ?? null })), (p) => p.key as string);

  addNodes('ZipTax', 'zip', rows('tax').map((r) => props('tax', r)), (p) => p.zip as string);
  const cityKey = (city: string | undefined, state: string | undefined): string => `${norm(city ?? '')}|${(state ?? '').trim().toUpperCase()}`;
  addNodes(
    'CityTax',
    'key',
    rows('city_tax').map((r) => ({ key: cityKey(r.city, r.state), ...props('city_tax', r) })),
    (p) => p.key as string,
  );
  addNodes('Vendor', 'id', rows('vendors').map((r) => props('vendors', r)), (p) => String(p.id));
  addNodes('User', 'id', rows('user').map((r) => props('user', r)), (p) => String(p.id));

  addRels(
    { type: 'OF_TYPE', from: ['Item', 'partNumber'], to: ['ItemType', 'code'], source: 'inventory.type' },
    inventory.map((r) => ({ from: r.part_number ?? '', to: r.type ?? '' })),
  );
  addRels(
    { type: 'DEFAULT_FACTOR', from: ['Item', 'partNumber'], to: ['FactorCode', 'code'], source: 'inventory.factor_code' },
    inventory.map((r) => ({ from: r.part_number ?? '', to: r.factor_code ?? '' })),
  );
  addRels(
    { type: 'INCLUDES', from: ['FactorCode', 'code'], to: ['Item', 'partNumber'], source: 'factor_code_items', byId: true },
    rows('factor_code_items').map((r) => ({ from: r.factor_code ?? '', to: r.part_number ?? '', id: r.id, props: { quantity: typed(r.quantity ?? '', 'float') } })),
  );
  addRels(
    { type: 'CONVERTS_WITH', from: ['Item', 'partNumber'], to: ['ConversionCode', 'code'], source: 'inventory_conversion_code' },
    rows('inventory_conversion_code').map((r) => ({
      from: r.inventory_part_number ?? '',
      to: r.conversion_code ?? '',
      props: { quantity: typed(r.quantity ?? '', 'float') },
    })),
  );
  addRels(
    { type: 'QUOTED', from: ['Vendor', 'id'], to: ['Item', 'partNumber'], source: 'vendor_item_prices', byId: true, intFrom: true },
    rows('vendor_item_prices').map((r) => ({
      from: r.vendor_id ?? '',
      to: r.part_number ?? '',
      id: r.id,
      props: props('vendor_item_prices', r, ['id', 'vendor_id', 'part_number']),
    })),
  );

  // ------------------------------------------------------------------ history (bids → jobs → POs → proposals)

  if (!options.catalogOnly) {
    let bids = rows('bid');
    if (options.maxBids !== undefined && bids.length > options.maxBids) {
      const total = bids.length;
      bids = [...bids].sort((a, b) => (b.bid_date ?? '').localeCompare(a.bid_date ?? '')).slice(0, options.maxBids);
      notes.push(`--max-bids ${options.maxBids}: kept the ${bids.length} most recent of ${total} bids; older bids and everything under them are not loaded`);
    }
    const bidIds = new Set(bids.map((r) => r.bid_id ?? ''));
    const inBid = (r: Raw): boolean => bidIds.has(r.bid_id ?? '');
    const limited = options.maxBids !== undefined;

    addNodes('Customer', 'name', rows('customer').map((r) => props('customer', r)), (p) => p.name as string);
    const projects = rows('project');
    addNodes('Project', 'name', projects.map((r) => props('project', r)), (p) => p.name as string);
    addNodes('Architect', 'id', rows('architects').map((r) => props('architects', r)), (p) => String(p.id));
    addNodes('Engineer', 'id', rows('engineers').map((r) => props('engineers', r)), (p) => String(p.id));
    addNodes('Bid', 'bidId', bids.map((r) => props('bid', r)), (p) => p.bidId as string);

    addRels({ type: 'HAS_BID', from: ['Customer', 'name'], to: ['Bid', 'bidId'], source: 'bid.customer_name' }, bids.map((r) => ({ from: r.customer_name ?? '', to: r.bid_id ?? '' })));
    addRels({ type: 'HAS_BID', from: ['Project', 'name'], to: ['Bid', 'bidId'], source: 'bid.project_name' }, bids.map((r) => ({ from: r.project_name ?? '', to: r.bid_id ?? '' })));
    addRels(
      { type: 'REVISION_OF', from: ['Bid', 'bidId'], to: ['Bid', 'bidId'], source: 'bid.base_bid_id' },
      bids.filter((r) => r.base_bid_id && r.base_bid_id !== r.bid_id).map((r) => ({ from: r.bid_id ?? '', to: r.base_bid_id ?? '' })),
    );

    // derived: where a project is taxed, and who designed it
    addRels(
      { type: 'TAXED_AT', from: ['Project', 'name'], to: ['CityTax', 'key'], source: 'project city/state ↔ city_tax' },
      projects.filter((r) => r.project_city).map((r) => ({ from: r.project_name ?? '', to: cityKey(r.project_city, r.project_state || 'CA') })),
    );
    addRels(
      { type: 'IN_ZIP', from: ['Project', 'name'], to: ['ZipTax', 'zip'], source: 'project zip ↔ tax' },
      projects.filter((r) => has('ZipTax', (r.project_zip ?? '').slice(0, 5))).map((r) => ({ from: r.project_name ?? '', to: (r.project_zip ?? '').slice(0, 5) })),
    );
    for (const [table, label, type, column] of [
      ['architects', 'Architect', 'ARCHITECT', 'architect_name'],
      ['engineers', 'Engineer', 'ENGINEER', 'engineer_name'],
    ] as const) {
      const byName = new Map(rows(table).map((r) => [r.name ?? '', r.id ?? '']));
      addRels(
        { type, from: ['Project', 'name'], to: [label, 'id'], source: `project.${column} ↔ ${table}.name`, intTo: true },
        projects.filter((r) => byName.has(r[column] ?? '')).map((r) => ({ from: r.project_name ?? '', to: byName.get(r[column] ?? '') ?? '' })),
      );
    }

    // bid lines → relationships (the biggest table; nodes would not fit Aura Free)
    const line = (table: string, r: Raw, parent: string): Props => props(table, r, ['id', parent]);
    addRels(
      { type: 'HAS_LINE', from: ['Bid', 'bidId'], to: ['Item', 'partNumber'], source: 'bid_factor_code_items', byId: true },
      rows('bid_factor_code_items').filter(inBid).map((r) => ({ from: r.bid_id ?? '', to: itemFor(r.part_number), id: r.id, props: line('bid_factor_code_items', r, 'bid_id') })),
    );

    const subBids = rows('sub_bid').filter(inBid);
    const subBidIds = new Set(subBids.map((r) => r.sub_bid_id ?? ''));
    addNodes('SubBid', 'subBidId', subBids.map((r) => props('sub_bid', r)), (p) => String(p.subBidId));
    addRels({ type: 'HAS_SUB_BID', from: ['Bid', 'bidId'], to: ['SubBid', 'subBidId'], source: 'sub_bid', intTo: true }, subBids.map((r) => ({ from: r.bid_id ?? '', to: r.sub_bid_id ?? '' })));
    addRels(
      { type: 'HAS_LINE', from: ['SubBid', 'subBidId'], to: ['Item', 'partNumber'], source: 'sub_bid_items', byId: true, intFrom: true },
      rows('sub_bid_items').filter((r) => subBidIds.has(r.sub_bid_id ?? '')).map((r) => ({ from: r.sub_bid_id ?? '', to: itemFor(r.part_number), id: r.id, props: line('sub_bid_items', r, 'sub_bid_id') })),
    );

    const adjustments = rows('bid_adjustments').filter(inBid);
    addNodes('BidAdjustment', 'id', adjustments.map((r) => props('bid_adjustments', r)), (p) => String(p.id));
    addRels({ type: 'HAS_ADJUSTMENT', from: ['Bid', 'bidId'], to: ['BidAdjustment', 'id'], source: 'bid_adjustments', intTo: true }, adjustments.map((r) => ({ from: r.bid_id ?? '', to: r.id ?? '' })));
    addRels({ type: 'BY', from: ['BidAdjustment', 'id'], to: ['User', 'id'], source: 'bid_adjustments.user_id', intFrom: true, intTo: true }, adjustments.map((r) => ({ from: r.id ?? '', to: r.user_id ?? '' })));

    // bid change orders
    const bcos = rows('bid_change_orders').filter(inBid);
    const bcoIds = new Set(bcos.map((r) => r.id ?? ''));
    addNodes('BidChangeOrder', 'id', bcos.map((r) => props('bid_change_orders', r)), (p) => String(p.id));
    addRels({ type: 'HAS_BID_CHANGE_ORDER', from: ['Bid', 'bidId'], to: ['BidChangeOrder', 'id'], source: 'bid_change_orders', intTo: true }, bcos.map((r) => ({ from: r.bid_id ?? '', to: r.id ?? '' })));
    addRels(
      { type: 'HAS_LINE', from: ['BidChangeOrder', 'id'], to: ['Item', 'partNumber'], source: 'bid_change_order_items', byId: true, intFrom: true },
      rows('bid_change_order_items').filter((r) => bcoIds.has(r.bid_change_order_id ?? '')).map((r) => ({
        from: r.bid_change_order_id ?? '',
        to: itemFor(r.part_number),
        id: r.id,
        props: line('bid_change_order_items', r, 'bid_change_order_id'),
      })),
    );
    addRels(
      { type: 'SECTION', from: ['BidChangeOrder', 'id'], to: ['Category', 'key'], source: 'bid_change_order_sections', byId: true, intFrom: true },
      rows('bid_change_order_sections').filter((r) => bcoIds.has(r.bid_change_order_id ?? '')).map((r) => ({
        from: r.bid_change_order_id ?? '',
        to: norm(r.section ?? ''),
        id: r.id,
        props: props('bid_change_order_sections', r, ['id', 'bid_change_order_id', 'section']),
      })),
    );

    // jobs
    const jobBids = rows('job_bids');
    let jobs = rows('jobs');
    if (limited) {
      const viaJobBids = new Set(jobBids.filter(inBid).map((r) => r.job_id ?? ''));
      jobs = jobs.filter((r) => bidIds.has(r.bid_id ?? '') || viaJobBids.has(r.job_id ?? ''));
    }
    const jobIds = new Set(jobs.map((r) => r.job_id ?? ''));
    const inJob = (r: Raw): boolean => jobIds.has(r.job_id ?? '');
    addNodes('Job', 'jobId', jobs.map((r) => props('jobs', r)), (p) => p.jobId as string);
    addRels({ type: 'FROM_BID', from: ['Job', 'jobId'], to: ['Bid', 'bidId'], source: 'jobs.bid_id' }, jobs.map((r) => ({ from: r.job_id ?? '', to: r.bid_id ?? '' })));
    addRels(
      { type: 'INCLUDES_BID', from: ['Job', 'jobId'], to: ['Bid', 'bidId'], source: 'job_bids', byId: true },
      jobBids.filter(inJob).map((r) => ({ from: r.job_id ?? '', to: r.bid_id ?? '', id: r.id, props: props('job_bids', r, ['id', 'job_id', 'bid_id']) })),
    );
    addRels(
      { type: 'ASSIGNED_VENDOR', from: ['Job', 'jobId'], to: ['Vendor', 'id'], source: 'vendor_category_assignments', byId: true, intTo: true },
      rows('vendor_category_assignments').filter(inJob).map((r) => ({ from: r.job_id ?? '', to: r.vendor_id ?? '', id: r.id, props: props('vendor_category_assignments', r, ['id', 'job_id', 'vendor_id']) })),
    );

    // job change orders
    const cos = rows('change_orders').filter(inJob);
    const coIds = new Set(cos.map((r) => r.id ?? ''));
    addNodes('ChangeOrder', 'id', cos.map((r) => props('change_orders', r)), (p) => String(p.id));
    addRels({ type: 'HAS_CHANGE_ORDER', from: ['Job', 'jobId'], to: ['ChangeOrder', 'id'], source: 'change_orders', intTo: true }, cos.map((r) => ({ from: r.job_id ?? '', to: r.id ?? '' })));
    addRels({ type: 'REVISION_OF', from: ['ChangeOrder', 'id'], to: ['ChangeOrder', 'id'], source: 'change_orders.parent_id', intFrom: true, intTo: true }, cos.map((r) => ({ from: r.id ?? '', to: r.parent_id ?? '' })));
    addRels({ type: 'SNAPSHOT', from: ['ChangeOrder', 'id'], to: ['Bid', 'bidId'], source: 'change_orders.snapshot_bid_id', intFrom: true }, cos.map((r) => ({ from: r.id ?? '', to: r.snapshot_bid_id ?? '' })));
    addRels({ type: 'CREATED_BY', from: ['ChangeOrder', 'id'], to: ['User', 'id'], source: 'change_orders.created_by', intFrom: true, intTo: true }, cos.map((r) => ({ from: r.id ?? '', to: r.created_by ?? '' })));
    addRels(
      { type: 'HAS_LINE', from: ['ChangeOrder', 'id'], to: ['Item', 'partNumber'], source: 'change_order_items', byId: true, intFrom: true },
      rows('change_order_items').filter((r) => coIds.has(r.change_order_id ?? '')).map((r) => ({ from: r.change_order_id ?? '', to: itemFor(r.part_number), id: r.id, props: line('change_order_items', r, 'change_order_id') })),
    );

    // purchase orders
    const pos = rows('purchase_orders').filter((r) => !limited || inJob(r));
    const poNumbers = new Set(pos.map((r) => r.po_number ?? ''));
    const inPo = (r: Raw): boolean => poNumbers.has(r.po_number ?? '');
    const poItems = rows('purchase_order_items').filter(inPo);
    addNodes('PurchaseOrder', 'poNumber', pos.map((r) => props('purchase_orders', r)), (p) => p.poNumber as string);
    addRels({ type: 'HAS_PO', from: ['Job', 'jobId'], to: ['PurchaseOrder', 'poNumber'], source: 'purchase_orders.job_id' }, pos.map((r) => ({ from: r.job_id ?? '', to: r.po_number ?? '' })));
    addRels({ type: 'IN_CATEGORY', from: ['PurchaseOrder', 'poNumber'], to: ['Category', 'key'], source: 'purchase_orders.category' }, pos.map((r) => ({ from: r.po_number ?? '', to: norm(r.category ?? '') })));
    addRels(
      { type: 'HAS_LINE', from: ['PurchaseOrder', 'poNumber'], to: ['Item', 'partNumber'], source: 'purchase_order_items', byId: true },
      poItems.map((r) => ({ from: r.po_number ?? '', to: itemFor(r.part_number), id: r.id, props: line('purchase_order_items', r, 'po_number') })),
    );
    addRels({ type: 'FROM_VENDOR', from: ['PurchaseOrder', 'poNumber'], to: ['Vendor', 'id'], source: 'purchase_order_items.vendor_id', intTo: true }, poItems.map((r) => ({ from: r.po_number ?? '', to: r.vendor_id ?? '' })));

    // comments (two source tables, one label)
    const poComments = rows('comments').filter(inPo);
    const coComments = rows('change_order_comments').filter((r) => coIds.has(r.change_order_id ?? ''));
    addNodes(
      'Comment',
      'key',
      [
        ...poComments.map((r) => ({ key: `po:${r.id}`, kind: 'purchase_order', ...props('comments', r, ['po_number', 'user_id']) })),
        ...coComments.map((r) => ({ key: `co:${r.id}`, kind: 'change_order', ...props('change_order_comments', r, ['change_order_id', 'user_id']) })),
      ],
      (p) => p.key as string,
    );
    addRels({ type: 'HAS_COMMENT', from: ['PurchaseOrder', 'poNumber'], to: ['Comment', 'key'], source: 'comments' }, poComments.map((r) => ({ from: r.po_number ?? '', to: `po:${r.id}` })));
    addRels({ type: 'HAS_COMMENT', from: ['ChangeOrder', 'id'], to: ['Comment', 'key'], source: 'change_order_comments', intFrom: true }, coComments.map((r) => ({ from: r.change_order_id ?? '', to: `co:${r.id}` })));
    addRels(
      { type: 'BY', from: ['Comment', 'key'], to: ['User', 'id'], source: 'comments.user_id', intTo: true },
      [...poComments.map((r) => ({ from: `po:${r.id}`, to: r.user_id ?? '' })), ...coComments.map((r) => ({ from: `co:${r.id}`, to: r.user_id ?? '' }))],
    );

    // proposals
    const proposals = rows('proposals').filter(inBid);
    const proposalIds = new Set(proposals.map((r) => r.id ?? ''));
    const inProposal = (r: Raw): boolean => proposalIds.has(r.proposal_id ?? '');
    addNodes('Proposal', 'id', proposals.map((r) => props('proposals', r)), (p) => String(p.id));
    addRels({ type: 'HAS_PROPOSAL', from: ['Bid', 'bidId'], to: ['Proposal', 'id'], source: 'proposals', intTo: true }, proposals.map((r) => ({ from: r.bid_id ?? '', to: r.id ?? '' })));
    for (const [table, label, type] of [
      ['proposal_recipients', 'ProposalRecipient', 'HAS_RECIPIENT'],
      ['proposal_components', 'ProposalComponent', 'HAS_COMPONENT'],
      ['proposal_amounts', 'ProposalAmount', 'HAS_AMOUNT'],
      ['proposal_options', 'ProposalOption', 'HAS_OPTION'],
    ] as const) {
      const children = rows(table).filter(inProposal);
      addNodes(label, 'id', children.map((r) => props(table, r)), (p) => String(p.id));
      addRels({ type, from: ['Proposal', 'id'], to: [label, 'id'], source: table, intFrom: true, intTo: true }, children.map((r) => ({ from: r.proposal_id ?? '', to: r.id ?? '' })));
    }
    const componentProposal = new Map(rows('proposal_components').filter(inProposal).map((r) => [r.id ?? '', r.proposal_id ?? '']));
    addRels(
      { type: 'HAS_LINE', from: ['ProposalComponent', 'id'], to: ['Proposal', 'id'], source: 'proposal_component_lines', byId: true, intFrom: true, intTo: true },
      rows('proposal_component_lines').filter((r) => componentProposal.has(r.component_id ?? '')).map((r) => ({
        from: r.component_id ?? '',
        to: componentProposal.get(r.component_id ?? '') ?? '',
        id: r.id,
        props: props('proposal_component_lines', r, ['id', 'component_id']),
      })),
    );

    const custom = rels.filter((b) => b.type === 'HAS_LINE' && b.to.label === 'Item').reduce((n, b) => n + b.rows.filter((r) => r.to === CUSTOM_ITEM).length, 0);
    notes.push(`${custom} lines have a part number that is not in the catalog; they attach to the ${CUSTOM_ITEM} item and keep their own text`);
  }

  // what this graph was built from — also lets verify.ts know which options were used
  nodes.push({
    label: 'GroundworkMeta',
    key: 'key',
    rows: [
      {
        key: 'snapshot',
        extractedAt: manifest.extractedAt,
        source: manifest.source,
        catalogOnly: options.catalogOnly ?? false,
        maxBids: options.maxBids === undefined ? null : neo4j.int(options.maxBids),
      },
    ],
  });

  const live = { nodes: nodes.filter((b) => b.rows.length), rels: rels.filter((b) => b.rows.length) };
  const byLabel: Record<string, number> = {};
  for (const b of live.nodes) byLabel[b.label] = (byLabel[b.label] ?? 0) + b.rows.length;
  const byType: Record<string, number> = {};
  for (const b of live.rels) byType[b.type] = (byType[b.type] ?? 0) + b.rows.length;

  return {
    manifest,
    options,
    nodes: live.nodes,
    rels: live.rels,
    notes,
    totals: {
      nodes: Object.values(byLabel).reduce((a, b) => a + b, 0),
      rels: Object.values(byType).reduce((a, b) => a + b, 0),
      byLabel,
      byType,
    },
  };
}

/** --catalog-only, --max-bids N (shared by load.ts and verify.ts). */
export function parsePlanOptions(argv: string[]): PlanOptions {
  const options: PlanOptions = {};
  if (argv.includes('--catalog-only')) options.catalogOnly = true;
  const i = argv.indexOf('--max-bids');
  if (i !== -1) {
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error('--max-bids needs a positive integer, e.g. --max-bids 200');
    options.maxBids = n;
  }
  return options;
}
