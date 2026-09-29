// Deterministic anonymizers. The same input always maps to the same output (keyed by
// SCRUB_SALT), so a customer name scrubbed in `customer` still joins to the one in `bid`.
// Nothing here is reversible without the salt, and the salt never leaves .env.
import { createHmac } from 'node:crypto';

/** Case, surrounding space and runs of whitespace do not make a different person. */
export function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// 10-digit North American numbers written with separators: (951) 555-1234, 951-555-1234,
// 951.555.1234, +1 951 555 1234. Bare digit runs are left alone (part numbers, quantities).
export const PHONE_RE = /(?<![\w.-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\w-])/g;

export const SWEPT_EMAIL = 'redacted@example.com';
export const SWEPT_PHONE = '555-0100';

const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};
const STATE_CODES = new Set(Object.values(US_STATES));

// Words that show up in contact fields without being anyone's name.
const NOT_A_NAME = new Set([
  'accounts', 'payable', 'receivable', 'office', 'sales', 'purchasing', 'estimating', 'estimator', 'manager', 'project',
  'superintendent', 'department', 'dept', 'construction', 'landscape', 'irrigation', 'company', 'development', 'group',
  'unknown', 'none', 'various', 'will', 'call', 'main', 'desk', 'team', 'design', 'engineering', 'architect', 'architects',
  'active', 'archived', 'lost', 'hold', 'materials', 'material', 'labor', 'plan', 'plans', 'per', 'owner', 'center', 'standard',
  'building', 'utility', 'trailer', 'vinyl', 'maint', 'maintenance', 'metals', 'budget', 'test', 'testing', 'the', 'and', 'for',
  'not', 'with', 'from', 'city', 'county', 'state', 'phase', 'model', 'models', 'production', 'site', 'area', 'common', 'north',
  'south', 'east', 'west', 'street', 'avenue', 'road', 'drive', 'park', 'lot', 'lots', 'tbd', 'n', 'a', 'na',
]);

const isBlank = (v: string | null | undefined): v is null | undefined | '' => v === null || v === undefined || v.trim() === '';

/** "%20"-style text (the legacy app stored some descriptions URL-encoded) → plain text. */
export function decodeLegacy(text: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(text)) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    // stray % signs ("50% off"): decode only the well-formed escapes
    return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
}

export type LearnKind = 'company' | 'person' | 'project' | 'addr';

export interface Scrubber {
  company(v: string | null): string | null;
  person(v: string | null): string | null;
  project(v: string | null): string | null;
  estimator(v: string | null): string | null;
  phone(v: string | null): string | null;
  addr(v: string | null): string | null;
  /** Two-letter code for a recognizable US state, otherwise NULL. */
  state(v: string | null): string | null;
  /** 5- or 9-digit ZIP, otherwise NULL. */
  zip(v: string | null): string | null;
  /** The value if it is a known place name, otherwise NULL. */
  city(v: string | null): string | null;
  /** Bid ids are codes ("B11597-R1"); one that is really a name becomes "BID-<key>". */
  bidId(v: string | null): string | null;
  /** Register a place name that city() will accept. */
  learnPlace(v: string | null): void;
  isPlace(v: string | null): boolean;
  /** Register a real value so sweep() can find it inside free text. */
  learn(kind: LearnKind, v: string | null): void;
  /** Words that are ordinary catalog vocabulary; single words matching them are never swept. */
  setCommonWords(words: Iterable<string>): void;
  /** Decode, then replace emails, phone numbers and every learned name inside free text. */
  sweep(text: string | null): string | null;
  /** How many learned names / emails / phones a text contains (used to audit verbatim columns). */
  detect(text: string | null): number;
  stats(): { learned: number; sweptNames: number; sweptEmails: number; sweptPhones: number };
  /** Most-matched dictionary entries. These are REAL names: local debugging only, never log in CI. */
  topMatches(n: number): { name: string; matches: number }[];
}

interface Entry {
  words: string[];
  replacement: string;
  matches: number;
}

export function createScrubber(salt: string): Scrubber {
  if (salt.length < 16) throw new Error('SCRUB_SALT is too short — use at least 16 random characters');

  const digest = (v: string): string => createHmac('sha256', salt).update(normalize(v)).digest('hex');
  const key = (v: string): string => digest(v).slice(0, 8).toUpperCase();
  const num = (v: string, mod: number): number => parseInt(digest(v).slice(8, 16), 16) % mod;

  // token → the normalized value that produced it; two different values must never share a token
  const seen = new Map<string, string>();
  const token = (prefix: string, v: string): string => {
    const t = `${prefix} ${key(v)}`;
    const n = normalize(v);
    const prev = seen.get(t);
    if (prev !== undefined && prev !== n) throw new Error(`Scrub key collision on "${t}" — change SCRUB_SALT and re-run`);
    seen.set(t, n);
    return t;
  };

  const phone = (v: string): string => `555-01${String(num(v, 100)).padStart(2, '0')}`;
  const addr = (v: string): string => `${100 + num(v, 9000)} Example St`;
  const replacementFor: Record<LearnKind, (v: string) => string> = {
    company: (v) => token('Company', v),
    person: (v) => token('Person', v),
    project: (v) => token('Project', v),
    addr,
  };

  // first word (lowercase) → names starting with it, longest first
  const dictionary = new Map<string, Entry[]>();
  const learnedValues = new Set<string>();
  const places = new Set<string>();
  let commonWords = new Set<string>();
  const counts = { sweptNames: 0, sweptEmails: 0, sweptPhones: 0 };

  const WORD = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g;
  const wordsOf = (s: string): string[] => s.toLowerCase().match(WORD) ?? [];

  function add(words: string[], replacement: string): void {
    const first = words[0];
    if (!first) return;
    const list = dictionary.get(first) ?? [];
    if (list.some((e) => e.words.length === words.length && e.words.every((w, i) => w === words[i]))) return;
    list.push({ words, replacement, matches: 0 });
    list.sort((a, b) => b.words.length - a.words.length);
    dictionary.set(first, list);
  }

  function learn(kind: LearnKind, v: string | null): void {
    if (isBlank(v)) return;
    const n = normalize(v);
    const id = `${kind}:${n}`;
    if (learnedValues.has(id)) return;
    learnedValues.add(id);
    if (n.replace(/[^a-z]/g, '').length < 4) return; // too short to match safely
    const words = wordsOf(n);
    add(words, replacementFor[kind](v));
    // A contact is also mentioned by first or last name alone ("per Linnert").
    if (kind === 'person') {
      for (const w of words) {
        if (w.length >= 4 && /^[a-z']+$/.test(w) && !NOT_A_NAME.has(w)) add([w], token('Person', w));
      }
    }
  }

  /** Walk the text once; at each word, try the learned names that start with it. */
  function scan(text: string, onMatch: (start: number, end: number, e: Entry) => void): void {
    const re = new RegExp(WORD.source, 'g');
    const toks: { w: string; start: number; end: number }[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) toks.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });

    for (let i = 0; i < toks.length; i++) {
      const head = toks[i];
      if (!head) continue;
      for (const c of dictionary.get(head.w) ?? []) {
        if (i + c.words.length > toks.length) continue;
        if (!c.words.every((w, k) => toks[i + k]?.w === w)) continue;
        // ordinary words ("Landscape", "Live Oak", "Per Plans") are not evidence of a name
        if (c.words.every((w) => commonWords.has(w) || NOT_A_NAME.has(w))) continue;
        const last = toks[i + c.words.length - 1];
        if (!last) continue;
        c.matches++;
        onMatch(head.start, last.end, c);
        i += c.words.length - 1;
        break;
      }
    }
  }

  function sweepNames(text: string): string {
    let out = '';
    let cursor = 0;
    scan(text, (start, end, e) => {
      out += text.slice(cursor, start) + e.replacement;
      cursor = end;
      counts.sweptNames++;
    });
    return out + text.slice(cursor);
  }

  const cleanPlace = (v: string): string => normalize(v).replace(/[.,]+$/, '');

  return {
    company: (v) => (isBlank(v) ? v : token('Company', v)),
    person: (v) => (isBlank(v) ? v : token('Person', v)),
    project: (v) => (isBlank(v) ? v : token('Project', v)),
    estimator: (v) => (isBlank(v) ? v : token('Estimator', v)),
    phone: (v) => (isBlank(v) ? v : phone(v)),
    addr: (v) => (isBlank(v) ? v : addr(v)),
    state(v) {
      if (isBlank(v)) return null;
      const s = normalize(v).replace(/\./g, '');
      const code = s.toUpperCase();
      if (STATE_CODES.has(code)) return code;
      return US_STATES[s] ?? null;
    },
    zip(v) {
      if (isBlank(v)) return null;
      const z = v.trim();
      return /^\d{5}(-\d{4})?$/.test(z) ? z : null;
    },
    city(v) {
      if (isBlank(v)) return null;
      return places.has(cleanPlace(v)) ? v.trim().replace(/\s+/g, ' ') : null;
    },
    bidId(v) {
      if (isBlank(v)) return v;
      return /^[A-Za-z]{0,4}-?\d/.test(v.trim()) ? v : `BID-${key(v)}`;
    },
    learnPlace(v) {
      if (isBlank(v)) return;
      const p = cleanPlace(v);
      if (/^[a-z][a-z .'-]*$/.test(p)) places.add(p);
    },
    isPlace: (v) => !isBlank(v) && places.has(cleanPlace(v)),
    learn,
    setCommonWords(words) {
      commonWords = new Set([...words].map((w) => w.toLowerCase()));
    },
    sweep(text) {
      if (isBlank(text)) return text;
      let out = decodeLegacy(text);
      out = out.replace(EMAIL_RE, () => (counts.sweptEmails++, SWEPT_EMAIL));
      out = out.replace(PHONE_RE, () => (counts.sweptPhones++, SWEPT_PHONE));
      return sweepNames(out);
    },
    detect(text) {
      if (isBlank(text)) return 0;
      const plain = decodeLegacy(text);
      let hits = (plain.match(EMAIL_RE) ?? []).length + (plain.match(PHONE_RE) ?? []).length;
      scan(plain, () => hits++);
      return hits;
    },
    stats: () => ({ learned: learnedValues.size, ...counts }),
    topMatches: (n) =>
      [...dictionary.values()]
        .flat()
        .filter((e) => e.matches > 0)
        .sort((a, b) => b.matches - a.matches)
        .slice(0, n)
        .map((e) => ({ name: e.words.join(' '), matches: e.matches })),
  };
}
