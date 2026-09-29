// Drafting a proposal from a walk (user journey step 8): the site model and transcript become
// client-readable lines (LLM call A), each line is looked up in the catalog and matched to one
// item (LLM call B), and matched items bring their sale price and, through their factor code's
// kit, an installation labor line at the category's labor rate. The architect reviews the rest.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getFactorCodeKit, listCategories, searchItems, type ItemRow } from '@groundwork/graph';
import { HttpError } from '../http.ts';
import { chatJson } from '../llm/chat.ts';
import { logger } from '../logger.ts';
import { stitchTranscript, type Walk } from '../walks/store.ts';
import { lineCategory, proposalEditSchema, type LineCategory, type Proposal, type ProposalLine, type ProposalSection } from './types.ts';
import { newShareToken } from './store.ts';

const MAX_TRANSCRIPT_CHARS = 12_000;
const SEARCH_LIMIT = 6;
const MAX_CANDIDATES = 10;
/** AuraDB Free is easily swamped; a handful of queries at a time is plenty. */
const CATALOG_CONCURRENCY = 4;

/** Site model category → catalog Category.key, whose laborRate prices the installation (docs/02-site-model.md). */
const LABOR_CATEGORY: Record<LineCategory, string> = {
  plants: 'landscape',
  irrigation: 'irrigation',
  drainage: 'drains',
  hardscape: 'sitework',
  lighting: 'low_voltage',
  removal: 'landscape',
  other: 'landscape',
};

// Call A. Every field required-but-nullable so strict structured output accepts the schema;
// lengths and ranges are enforced in code afterwards rather than asked of the model.
const draftSchema = z.object({
  title: z.string(),
  intro: z.string(),
  areas: z.array(
    z.object({
      area: z.string(),
      summary: z.string(),
      needs: z.array(
        z.object({
          description: z.string(),
          category: lineCategory,
          searchTerms: z.array(z.string()),
          quantity: z.number().nullable(),
          unit: z.string().nullable(),
          basis: z.string().nullable(),
          toConfirm: z.string().nullable(),
        }),
      ),
    }),
  ),
  terms: z.string(),
});
type Draft = z.infer<typeof draftSchema>;
type Need = Draft['areas'][number]['needs'][number];

const DRAFT_SYSTEM = `You draft a landscape proposal for a homeowner from a landscape architect's site walk.
You get the structured site model and the walk's transcript. Reply with:
- title: short, e.g. "Landscape proposal: back patio and east fence line".
- intro: 2 to 4 sentences to the homeowner. Warm and plain. No prices. Do not invent facts that were not said.
- areas: one entry per site model area that has work to price. "area" must be the site model area's name exactly.
  - summary: 1 or 2 sentences to the homeowner about the work in that area.
  - needs: one per thing to supply, install or remove.
    - description: the line as the homeowner will read it, e.g. "Flagstone patio, dry-laid on a gravel base".
    - category: one of removal, hardscape, plants, irrigation, drainage, lighting, other.
    - searchTerms: 1 to 3 short catalog search words for the material, e.g. "flagstone", "lavender 1 gal", "drip line". Empty for a removal.
    - quantity and unit: only from what was said. Measurements become sq ft, linear ft or a count ("20 by 15 patio" -> 300, "sq ft"). If the quantity was not said, use null for both quantity and basis and say what is missing in toConfirm.
    - basis: how the quantity follows from what was said, e.g. "20 x 15 ft patio". Null when there is no quantity.
    - toConfirm: what the architect must check before sending, or null.
  - Add one need per removal in the site model, with category "removal".
- terms: short standard terms, written as editable defaults: valid for 30 days; 50% deposit to schedule the work; final payment on completion; excludes permits and unforeseen site conditions.
Never invent measurements, quantities, materials or client wishes.`;

// Call B.
const pickSchema = z.object({
  picks: z.array(z.object({ needId: z.string(), partNumber: z.string().nullable() })),
});

const PICK_SYSTEM = `You match lines of a landscape proposal to items in a nursery and irrigation supply catalog.
For each need you get a short list of candidate catalog items. Pick the one candidate that is what the need describes
(right plant or material, a sensible size), or null when none of them fits. Only use a partNumber from that need's own
candidates. Return one pick per need id.`;

const clip = (s: string | null | undefined, max: number): string => (s ?? '').trim().slice(0, max).trim();
const clipOrNull = (s: string | null | undefined, max: number): string | null => clip(s, max) || null;
const cents = (n: number) => Math.round(n * 100) / 100;
const joinNotes = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(' ') || null;

/** A quantity the review screen will accept, or null. */
function cleanQuantity(q: number | null): number | null {
  if (q === null || !Number.isFinite(q) || q < 0 || q > 1_000_000) return null;
  return Math.round(q * 1000) / 1000;
}

/** Run fn over items with at most `limit` in flight at once. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

interface PlannedNeed {
  id: string;
  sectionIndex: number;
  need: Need;
  candidates: ItemRow[];
}

/** Step 2: candidate catalog items per need, by its search terms. Throws if the catalog is unreachable. */
async function findCandidates(needs: PlannedNeed[]): Promise<void> {
  const searches = needs
    .filter((n) => n.need.category !== 'removal')
    .flatMap((n) => [...new Set(n.need.searchTerms.map((t) => clip(t, 100)).filter(Boolean))].slice(0, 3).map((term) => ({ n, term })));
  const results = await mapPool(searches, CATALOG_CONCURRENCY, ({ term }) => searchItems({ q: term, limit: SEARCH_LIMIT }));
  searches.forEach(({ n }, i) => {
    for (const item of results[i]!) {
      if (n.candidates.length >= MAX_CANDIDATES) break;
      if (!n.candidates.some((c) => c.partNumber === item.partNumber)) n.candidates.push(item);
    }
  });
}

/** Step 3: one catalog item (or none) per need. Only partNumbers from the need's own candidates survive. */
async function pickItems(needs: PlannedNeed[]): Promise<Map<string, ItemRow>> {
  const matched = new Map<string, ItemRow>();
  const withCandidates = needs.filter((n) => n.candidates.length > 0);
  if (withCandidates.length === 0) return matched;

  const payload = withCandidates.map((n) => ({
    needId: n.id,
    description: n.need.description,
    category: n.need.category,
    quantity: n.need.quantity,
    unit: n.need.unit,
    candidates: n.candidates.map((c) => ({
      partNumber: c.partNumber,
      description: c.description,
      type: c.typeLabel,
      size: c.size,
      unit: c.unit,
    })),
  }));
  const { data } = await chatJson({
    schema: pickSchema,
    schemaName: 'catalog_picks',
    prefer: 'openrouter',
    temperature: 0,
    messages: [
      { role: 'system', content: PICK_SYSTEM },
      { role: 'user', content: JSON.stringify({ needs: payload }) },
    ],
  });
  for (const pick of data.picks) {
    const need = withCandidates.find((n) => n.id === pick.needId);
    const item = pick.partNumber === null ? undefined : need?.candidates.find((c) => c.partNumber === pick.partNumber);
    if (need && item) matched.set(need.id, item);
  }
  return matched;
}

/** Labor hours per installed unit of a factor code, and labor rates per category — each looked up once per run. */
function laborLookups() {
  const hours = new Map<string, Promise<number | null>>();
  let rates: Promise<Map<string, number | null>> | undefined;
  return {
    laborHours(code: string): Promise<number | null> {
      let p = hours.get(code);
      if (!p) {
        p = getFactorCodeKit(code).then(
          (rows) => rows[0]?.laborHours ?? null,
          (err: unknown) => {
            logger.warn({ err, code }, 'Could not read factor code kit; no labor line');
            return null;
          },
        );
        hours.set(code, p);
      }
      return p;
    },
    laborRate(category: LineCategory): Promise<number | null> {
      rates ??= listCategories().then(
        (rows) => new Map(rows.map((r) => [r.key, r.laborRate])),
        (err: unknown) => {
          logger.warn({ err }, 'Could not read category labor rates');
          return new Map<string, number | null>();
        },
      );
      return rates.then((m) => m.get(LABOR_CATEGORY[category]) ?? null);
    },
  };
}

const quantityNote = (quantity: number | null) => (quantity === null ? 'Enter a quantity.' : null);

function customLine(need: Need): ProposalLine {
  const removal = need.category === 'removal';
  let description = clip(need.description, 500) || 'Work to be described';
  if (removal && !/^remov/i.test(description)) description = clip(`Remove ${description.charAt(0).toLowerCase()}${description.slice(1)}`, 500);
  const quantity = cleanQuantity(need.quantity);
  return {
    id: randomUUID(),
    kind: 'custom',
    category: need.category,
    partNumber: null,
    description,
    quantity,
    unit: clipOrNull(need.unit, 20),
    unitPrice: null,
    priceSource: null,
    basis: clipOrNull(need.basis, 300),
    toConfirm: clipOrNull(
      joinNotes(removal ? 'Enter a price for the removal.' : 'Enter a price — no catalog match.', need.toConfirm ?? quantityNote(quantity)),
      300,
    ),
  };
}

/** Step 4: the lines for one need — a catalog material (plus its installation labor) or a custom line. */
async function linesFor(need: Need, item: ItemRow | undefined, labor: ReturnType<typeof laborLookups>): Promise<ProposalLine[]> {
  if (!item || need.category === 'removal') return [customLine(need)];

  const quantity = cleanQuantity(need.quantity);
  const price = item.salePrice ?? item.cost;
  const catalogNote = `Catalog: ${item.description ?? item.partNumber}${item.size ? ` (${item.size})` : ''}`;
  const lines: ProposalLine[] = [
    {
      id: randomUUID(),
      kind: 'material',
      category: need.category,
      partNumber: clip(item.partNumber, 80),
      description: clip(need.description, 500) || clip(item.description, 500) || item.partNumber,
      quantity,
      unit: clipOrNull(need.unit ?? item.unit, 20),
      unitPrice: price === null ? null : cents(price),
      priceSource: price === null ? null : 'catalog',
      basis: clipOrNull(joinNotes(need.basis ? `${need.basis.trim().replace(/\.$/, '')}.` : null, catalogNote), 300),
      toConfirm: clipOrNull(joinNotes(price === null ? 'No catalog price.' : null, need.toConfirm ?? quantityNote(quantity)), 300),
    },
  ];

  const hours = item.factorCode ? await labor.laborHours(item.factorCode) : null;
  if (item.factorCode && hours !== null && hours > 0) {
    const rate = await labor.laborRate(need.category);
    lines.push({
      id: randomUUID(),
      kind: 'labor',
      category: need.category,
      partNumber: null,
      description: clip(`Installation: ${lines[0]!.description}`, 500),
      quantity: quantity === null ? null : cleanQuantity(quantity * hours),
      unit: 'hr',
      unitPrice: rate === null ? null : cents(rate),
      priceSource: rate === null ? null : 'labor_rate',
      basis: clip(`${hours} hr per unit installed (factor code ${item.factorCode})${quantity === null ? '' : ` × ${quantity}`}`, 300),
      toConfirm: clipOrNull(
        joinNotes(
          quantity === null ? 'Hours follow once the quantity is known.' : null,
          rate === null ? `No labor rate for ${LABOR_CATEGORY[need.category]}.` : null,
        ),
        300,
      ),
    });
  }
  return lines;
}

/** Everything the model needs from the walk, without the bulk it does not. */
function siteModelForPrompt(walk: Walk) {
  const model = walk.siteModel!;
  return {
    areas: model.areas.map((a) => ({
      name: a.name,
      existingFeatures: a.existingFeatures,
      measurements: a.measurements,
      conditions: a.conditions,
      removals: a.removals,
      proposedChanges: a.proposedChanges,
    })),
    clientPreferences: model.clientPreferences,
    missing: model.missing,
  };
}

/**
 * Draft a proposal for a walk that has a site model. Only call A failing fails the draft
 * (HttpError 502); a catalog or matching failure leaves every line custom and unpriced.
 */
export async function generateProposal(walk: Walk): Promise<Proposal> {
  const model = walk.siteModel;
  if (!model) throw new HttpError(409, 'The walk has no site model yet');
  const started = Date.now();

  // 1. Call A: the site model and what was said → client-readable needs per area.
  let transcript = stitchTranscript(walk).transcript;
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)} […]`;
  let draft: Draft;
  let meta: { provider: string; model: string };
  try {
    const result = await chatJson({
      schema: draftSchema,
      schemaName: 'proposal_draft',
      prefer: 'openrouter',
      temperature: 0,
      timeoutMs: 120_000,
      messages: [
        { role: 'system', content: DRAFT_SYSTEM },
        {
          role: 'user',
          content: `Site model:\n${JSON.stringify(siteModelForPrompt(walk))}\n\nTranscript:\n"""\n${transcript || '(no transcript)'}\n"""`,
        },
      ],
    });
    draft = result.data;
    meta = { provider: result.meta.provider, model: result.meta.model };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ walkId: walk.id, err: message }, 'Proposal draft failed');
    throw new HttpError(502, `Could not draft the proposal: ${message}`, err instanceof HttpError ? err.details : undefined);
  }

  // Sections follow the site model's area order; names are matched case-insensitively to the
  // model's own, and an area the model named twice becomes one section.
  const areaOrder = model.areas.map((a) => a.name);
  const canonical = (name: string) => areaOrder.find((a) => a.toLowerCase() === name.trim().toLowerCase()) ?? clip(name, 120);
  const sections: (ProposalSection & { needs: Need[] })[] = [];
  for (const a of draft.areas) {
    const area = canonical(a.area);
    if (!area) continue;
    let section = sections.find((s) => s.area.toLowerCase() === area.toLowerCase());
    if (!section) {
      section = { id: randomUUID(), area, summary: '', photoIds: [], lines: [], needs: [] };
      sections.push(section);
    }
    section.summary = clip([section.summary, a.summary.trim()].filter(Boolean).join(' '), 2000);
    section.needs.push(...a.needs.filter((n) => n.description.trim()));
  }
  const rank = (area: string) => {
    const i = areaOrder.indexOf(area);
    return i === -1 ? areaOrder.length : i;
  };
  sections.sort((a, b) => rank(a.area) - rank(b.area));
  sections.splice(40); // the most the review screen can save

  // 2–3. Catalog candidates, then one pick per need. Either failing leaves the lines unpriced.
  const planned: PlannedNeed[] = sections.flatMap((s, sectionIndex) =>
    s.needs.map((need, i) => ({ id: `n${sectionIndex + 1}.${i + 1}`, sectionIndex, need, candidates: [] })),
  );
  let matched = new Map<string, ItemRow>();
  try {
    await findCandidates(planned);
    matched = await pickItems(planned);
  } catch (err) {
    logger.warn(
      { walkId: walk.id, err: err instanceof Error ? err.message : String(err) },
      'Catalog lookup or matching failed; drafting every line unpriced',
    );
    matched = new Map();
  }

  // 4. Lines, in need order.
  const labor = laborLookups();
  const lineGroups = await mapPool(planned, CATALOG_CONCURRENCY, (n) => linesFor(n.need, matched.get(n.id), labor));
  planned.forEach((n, i) => sections[n.sectionIndex]!.lines.push(...lineGroups[i]!));

  // 5. Photos: the walk's photos mapped to each section's area, oldest first.
  const photos = [...(walk.photos ?? [])].sort((a, b) => a.takenAt - b.takenAt);
  for (const s of sections) {
    s.photoIds = photos.filter((p) => p.area?.toLowerCase() === s.area.toLowerCase()).map((p) => p.id).slice(0, 24);
  }

  // 6. The rest, then one pass through the save schema so the draft is exactly what review can save.
  const edit = proposalEditSchema.parse({
    title: clip(draft.title, 200) || 'Landscape proposal',
    client: { name: '', email: '', address: '' },
    intro: clip(draft.intro, 5000),
    sections: sections.map(({ needs: _needs, ...s }) => ({ ...s, lines: s.lines.slice(0, 200) })),
    taxRate: null,
    terms: clip(draft.terms, 5000),
    openQuestions: model.missing
      .filter((m) => m.question.trim())
      .slice(0, 100)
      .map((m) => ({ area: clipOrNull(m.area, 120), question: clip(m.question, 500) })),
  });

  const now = Date.now();
  logger.info(
    { walkId: walk.id, sections: edit.sections.length, lines: planned.length, matched: matched.size, ms: now - started },
    'Proposal drafted',
  );
  return {
    ...edit,
    id: randomUUID(),
    walkId: walk.id,
    status: 'draft',
    shareToken: newShareToken(),
    createdAt: now,
    updatedAt: now,
    sentAt: null,
    decidedAt: null,
    decidedBy: null,
    acceptedName: null,
    generatedBy: { ...meta, latencyMs: now - started },
  };
}
