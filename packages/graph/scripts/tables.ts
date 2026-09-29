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

const sweep: ScrubRule = { kind: 'sweep' };
const company: ScrubRule = { kind: 'company' };
const person: ScrubRule = { kind: 'person' };
const project: ScrubRule = { kind: 'project' };
const phone: ScrubRule = { kind: 'phone' };
const addr: ScrubRule = { kind: 'addr' };
const nul: ScrubRule = { kind: 'null' };

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
  { table: 'app_settings', key: ['key'], scrub: { updated_by: { kind: 'const', value: 'admin' } } },

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
    },
  },
  { table: 'architects', key: ['id'], scrub: { name: person, company, address: addr, phone_number: phone } },
  { table: 'engineers', key: ['id'], scrub: { name: person, company, address: addr, phone_number: phone } },

  // ---------- customer / project (PK is the name → scrub consistently everywhere) ----------
  { table: 'customer', key: ['customer_name'], scrub: { customer_name: company, customer_address: addr } },
  {
    table: 'project',
    key: ['project_name'],
    scrub: {
      project_name: project,
      project_address: addr,
      point_of_contact: person,
      contact_phone_number: phone,
      engineer_name: person,
      architect_name: person,
      builder_name: company,
      bid_schedule_comments: nul,
    },
  },

  // ---------- bids ----------
  {
    table: 'bid',
    key: ['bid_id'],
    scrub: {
      customer_name: company,
      project_name: project,
      engineer_name: person,
      architect_name: person,
      point_of_contact: person,
      project_address: addr,
      description: sweep,
      comments: nul,
    },
  },
  { table: 'bid_factor_code_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },
  { table: 'sub_bid', key: ['sub_bid_id'], scrub: { name: sweep } },
  { table: 'sub_bid_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },
  { table: 'bid_adjustments', key: ['id'] },
  {
    table: 'bid_change_orders',
    key: ['id'],
    scrub: { name: { kind: 'template', template: 'Change Order {id}' }, description: nul },
  },
  { table: 'bid_change_order_sections', key: ['id'] },
  { table: 'bid_change_order_items', key: ['id'], scrub: { description: sweep, additional_description: sweep } },

  // ---------- jobs / change orders / purchase orders ----------
  { table: 'jobs', key: ['job_id'] },
  { table: 'job_bids', key: ['id'], scrub: { separator_text: sweep } },
  {
    table: 'change_orders',
    key: ['id'],
    scrub: { name: { kind: 'template', template: 'CO {co_number} R{revision}' }, description: nul },
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
      customer_name: company,
      project_name: project,
      point_of_contact: person,
      poc_phone_number: phone,
      architect_name: person,
      engineer_name: person,
      prepared_by: { kind: 'estimator' },
      special_notes: { kind: 'const', value: '[]' },
      exclusions: sweep,
    },
  },
  {
    table: 'proposal_recipients',
    key: ['id'],
    scrub: { customer_name: company, customer_address: addr, content: nul },
  },
  { table: 'proposal_components', key: ['id'] },
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
  /** host only — never the connection string */
  sourceHost: string;
  sourceVersion: string;
  tables: Record<string, { rows: number; columns: string[]; file: string }>;
  excluded: Record<string, string>;
}
