// SINGLE SOURCE OF TRUTH for the Postgres → CSV extract: which tables are exported, in what
// order, which columns are dropped, and which columns are anonymized (and how).
//
// The source is Bid-Proposal-V2's `flask_bids` database (42 tables). The repo is PUBLIC, so every
// column that can identify a real person, customer, address or contact is scrubbed with a
// deterministic rule (see scrub.ts) — the same rule on every copy of the same value, so that
// e.g. customer.customer_name (a PRIMARY KEY) and bid.customer_name still join after scrubbing.
//
// Kept verbatim on purpose: city / state / ZIP (tax-rate + climate-zone lookups), every money and
// quantity column, all catalog tables, and ids.

export type ScrubRule =
  /** "Company <key>" — customers, builders, vendors, misc vendors, architect/engineer firms */
  | { kind: 'company' }
  /** "Person <key>" — contacts, architects, engineers, POCs */
  | { kind: 'person' }
  /** "Project <key>" — project names (PK of project, referenced by name elsewhere) */
  | { kind: 'project' }
  /** "555-01NN" */
  | { kind: 'phone' }
  /** "<n> Example St" */
  | { kind: 'addr' }
  /** "<prefix><id>@example.com" — uses the row's `idColumn` */
  | { kind: 'email'; prefix: string; idColumn: string }
  /** always NULL (notes, JSON snapshots that embed PII) */
  | { kind: 'null' }
  /** fixed string */
  | { kind: 'const'; value: string }
  /** template with {column} placeholders, e.g. "Comment {id}" */
  | { kind: 'template'; template: string }
  /** keep the text but regex-replace emails / phone numbers inside it */
  | { kind: 'sweep' }
  /** kept only when it is a known place name (names get typed into city fields); else NULL.
   *  `trusted` columns also teach the scrubber which place names exist. */
  | { kind: 'city'; trusted?: boolean }
  /** normalized to a two-letter US state code; anything else → NULL */
  | { kind: 'state' }
  /** kept only when it is a 5- or 9-digit ZIP; anything else → NULL */
  | { kind: 'zip' }
  /** bid ids that are codes are kept; the few that are really a project name → "BID-<key>" */
  | { kind: 'bidId' }
  /** "Estimator <key>" */
  | { kind: 'estimator' }
  /** user.username: "admin" for the first super-admin, else "user<id>" — handled in extract.ts */
  | { kind: 'username' };

export interface TableSpec {
  /** Postgres table name (public schema). Quoted automatically when needed ("user"). */
  table: string;
  /** Primary key column(s) — used for a stable ORDER BY and by the loader. */
  key: string[];
  /** Columns omitted from the CSV entirely. */
  drop?: string[];
  /** Column → rule. Columns not listed are copied verbatim. */
  scrub?: Record<string, ScrubRule>;
  /** Why it is excluded from the export (table is skipped entirely). */
  exclude?: string;
}

/** Column type as the loader sees it (collapsed from the Postgres type). */
export type ColumnType = 'int' | 'float' | 'bool' | 'date' | 'datetime' | 'string';

const sweep: ScrubRule = { kind: 'sweep' };
const company: ScrubRule = { kind: 'company' };
const person: ScrubRule = { kind: 'person' };
const project: ScrubRule = { kind: 'project' };
const phone: ScrubRule = { kind: 'phone' };
const addr: ScrubRule = { kind: 'addr' };
const nul: ScrubRule = { kind: 'null' };
const city: ScrubRule = { kind: 'city' };
const trustedCity: ScrubRule = { kind: 'city', trusted: true };
const state: ScrubRule = { kind: 'state' };
const zip: ScrubRule = { kind: 'zip' };
const bidId: ScrubRule = { kind: 'bidId' };

/** Export order = dependency order (parents before children) so the loader can go top-down. */
export const TABLES: TableSpec[] = [
  // ---------- catalog / reference (copied verbatim) ----------
  { table: 'inventory', key: ['part_number'] },
  { table: 'factor_code', key: ['factor_code'] },
  { table: 'factor_code_items', key: ['id'] },
  { table: 'conversion_code', key: ['code'] },
  { table: 'inventory_conversion_code', key: ['inventory_part_number', 'conversion_code'] },
  { table: 'inventory_cross_reference', key: ['id'] },
  { table: 'labor_rates', key: ['id'] },
  { table: 'tax', key: ['zip_code'] },
  { table: 'city_tax', key: ['id'] },
  { table: 'app_settings', key: ['key'], scrub: { value: sweep, updated_by: { kind: 'const', value: 'admin' } } },

  // ---------- auth ----------
  {
    table: 'user',
    key: ['id'],
    drop: ['password_hash', 'reset_token', 'reset_token_expiration', 'last_login'],
    scrub: {
      username: { kind: 'username' },
      email: { kind: 'email', prefix: 'user', idColumn: 'id' },
    },
  },
  { table: 'entity_locks', key: ['id'], exclude: 'ephemeral edit locks' },
  { table: 'audit_logs', key: ['id'], exclude: 'IP addresses + usernames in free text; ~300k rows' },

  // ---------- people / business contacts ----------
  {
    table: 'vendors',
    key: ['id'],
    scrub: {
      company,
      name: person,
      contact_person: person,
      email: { kind: 'email', prefix: 'vendor', idColumn: 'id' },
      phone_number: phone,
      fax_number: nul,
      address1: addr,
      address2: nul,
      city: trustedCity,
      state,
      zip_code: zip,
    },
  },
  { table: 'architects', key: ['id'], scrub: { name: person, company, address: addr, phone_number: phone } },
  { table: 'engineers', key: ['id'], scrub: { name: person, company, address: addr, phone_number: phone } },

  // ---------- customer / project (PK is the name → scrub consistently everywhere) ----------
  {
    table: 'customer',
    key: ['customer_name'],
    scrub: { customer_name: company, customer_address: addr, customer_city: city, customer_state: state, customer_zip: zip },
  },
  {
    table: 'project',
    key: ['project_name'],
    scrub: {
      project_name: project,
      project_address: addr,
      project_city: trustedCity,
      project_state: state,
      project_zip: zip,
      point_of_contact: person,
      contact_phone_number: phone,
      engineer_name: person,
      architect_name: person,
      builder_name: company,
      bid_number: bidId,
      bid_schedule_comments: nul,
      architect_specifications: nul,
      architect_sheets: nul,
      engineer_specifications: nul,
      engineer_sheets: nul,
    },
  },

  // ---------- bids ----------
  {
    table: 'bid',
    key: ['bid_id'],
    scrub: {
      bid_id: bidId,
      base_bid_id: bidId,
      customer_name: company,
      project_name: project,
      engineer_name: person,
      architect_name: person,
      point_of_contact: person,
      project_address: addr,
      project_city: trustedCity,
      project_state: state,
      project_zip: zip,
      description: sweep,
      comments: nul,
      // JSON, item-level numbers — swept in case a name or contact was typed into a label
      adjustment_data: sweep,
      extras: sweep,
    },
  },
  { table: 'bid_factor_code_items', key: ['id'], scrub: { bid_id: bidId, description: sweep, additional_description: sweep } },
  { table: 'sub_bid', key: ['sub_bid_id'], scrub: { bid_id: bidId, name: sweep } },
  { table: 'sub_bid_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },
  { table: 'bid_adjustments', key: ['id'], scrub: { bid_id: bidId, original_values: sweep } },
  {
    table: 'bid_change_orders',
    key: ['id'],
    scrub: { bid_id: bidId, name: { kind: 'template', template: 'Change Order {id}' }, description: nul },
  },
  { table: 'bid_change_order_sections', key: ['id'] },
  { table: 'bid_change_order_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },

  // ---------- jobs / change orders / purchase orders ----------
  { table: 'jobs', key: ['job_id'], scrub: { bid_id: bidId, migration_notes: sweep } },
  { table: 'job_bids', key: ['id'], scrub: { bid_id: bidId, separator_text: sweep } },
  {
    table: 'change_orders',
    key: ['id'],
    scrub: { snapshot_bid_id: bidId, name: { kind: 'template', template: 'CO {co_number} R{revision}' }, description: nul },
  },
  { table: 'change_order_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },
  { table: 'change_order_comments', key: ['id'], scrub: { text: { kind: 'template', template: 'Comment {id}' } } },
  {
    table: 'purchase_orders',
    key: ['po_number'],
    scrub: {
      vendor: company,
      jobsite_contact: person,
      jobsite_phone_primary: phone,
      jobsite_phone_secondary: phone,
      jobsite_phone_alternate: phone,
      vendor_ship_to_overrides: nul,
      // live-only column (not in schema.prisma); per-vendor JSON, dropped to be safe
      vendor_date_needed_overrides: nul,
    },
  },
  {
    table: 'purchase_order_items',
    key: ['id'],
    scrub: {
      misc_company: company,
      misc_address: addr,
      misc_phone: phone,
      misc_poc: person,
      description: sweep,
      additional_description: sweep,
    },
  },
  { table: 'comments', key: ['id'], scrub: { text: { kind: 'template', template: 'Comment {id}' } } },
  { table: 'vendor_category_assignments', key: ['id'] },
  { table: 'vendor_item_prices', key: ['id'] },

  // ---------- proposals ----------
  {
    table: 'proposals',
    key: ['id'],
    scrub: {
      bid_id: bidId,
      display_id: bidId,
      customer_name: company,
      project_name: project,
      point_of_contact: person,
      poc_phone_number: phone,
      architect_name: person,
      engineer_name: person,
      prepared_by: { kind: 'estimator' },
      special_notes: { kind: 'const', value: '[]' },
      exclusions: sweep,
      // boilerplate that names the contractor itself (company, license, contact details)
      terms_conditions: nul,
      prepared_by_title: sweep,
      // live-only columns (not in schema.prisma)
      signature_name: person,
      signature_title: sweep,
      // plan-set references: full of community, phase and street names, no value for the catalog
      architect_specifications: nul,
      architect_dated: nul,
      architect_sheets: nul,
      engineer_specifications: nul,
      engineer_dated: nul,
      engineer_sheets: nul,
    },
  },
  {
    table: 'proposal_recipients',
    key: ['id'],
    scrub: { customer_name: company, customer_address: addr, customer_city: city, customer_state: state, customer_zip: zip, content: nul },
  },
  // section headings name the community / street being landscaped
  { table: 'proposal_components', key: ['id'], scrub: { name: { kind: 'template', template: 'Section {display_order}' } } },
  { table: 'proposal_component_lines', key: ['id'], scrub: { name: sweep } },
  { table: 'proposal_amounts', key: ['id'], scrub: { description: sweep } },
  { table: 'proposal_options', key: ['id'], scrub: { description: sweep } },
];

export const EXPORTED_TABLES = TABLES.filter((t) => !t.exclude);
export const EXCLUDED_TABLES = TABLES.filter((t) => t.exclude);

/** Postgres identifier quoting ("user" is a reserved word). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Shape of data/_manifest.json written by extract.ts and read by load.ts / verify.ts. */
export interface Manifest {
  extractedAt: string;
  /** a label, not the hostname — the repo is public */
  source: string;
  sourceVersion: string;
  tables: Record<string, { rows: number; columns: string[]; types: Record<string, ColumnType>; files: string[] }>;
  /** table → why it is not in the snapshot (excluded by the spec, or absent from the source) */
  excluded: Record<string, string>;
}
