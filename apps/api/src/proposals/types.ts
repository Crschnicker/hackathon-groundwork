// The proposal the architect sends to the homeowner (user journey steps 8–9). Generated from a
// walk's site model, its mapped photos and the catalog's prices, then reviewed and edited by the
// architect before it is sent. The zod schemas are what the review screen may save.
import { z } from 'zod';

/**
 * draft: generated, being reviewed; the client link does not work yet.
 * pending: sent to the client, waiting for an answer.
 * won / lost: the client accepted, or the job went elsewhere.
 */
export const proposalStatus = z.enum(['draft', 'pending', 'won', 'lost']);
export type ProposalStatus = z.infer<typeof proposalStatus>;

/** The site model's change categories; they decide the labor rate and group the lines. */
export const lineCategory = z.enum(['removal', 'hardscape', 'plants', 'irrigation', 'drainage', 'lighting', 'other']);
export type LineCategory = z.infer<typeof lineCategory>;

const text = (max: number) => z.string().trim().max(max);

export const proposalLineSchema = z.object({
  /** Stable within the proposal; the review screen makes new ones for lines it adds. */
  id: text(64).min(1),
  /** material: a catalog item. labor: hours at a category's rate. custom: anything else. */
  kind: z.enum(['material', 'labor', 'custom']),
  category: lineCategory,
  /** Catalog part number for a material line; null otherwise. */
  partNumber: text(80).nullable(),
  description: text(500).min(1),
  quantity: z.number().min(0).max(1_000_000).nullable(),
  unit: text(20).nullable(),
  /** Price per unit to the client, in dollars. Null until someone knows it. */
  unitPrice: z.number().min(0).max(10_000_000).nullable(),
  /** Where unitPrice came from: the catalog's sale price, a category labor rate, or the architect. */
  priceSource: z.enum(['catalog', 'labor_rate', 'architect']).nullable(),
  /** How the quantity was arrived at, e.g. "20 × 15 ft patio". Shown to the architect only. */
  basis: text(300).nullable(),
  /** What the architect must check before sending, e.g. "No size was given for the border". */
  toConfirm: text(300).nullable(),
});
export type ProposalLine = z.infer<typeof proposalLineSchema>;

export const proposalSectionSchema = z.object({
  id: text(64).min(1),
  /** The site model area this section prices. */
  area: text(120).min(1),
  /** One or two sentences to the client about the work in this area. */
  summary: text(2000),
  /** Walk photos shown with this section, in order. Must belong to the proposal's walk. */
  photoIds: z.array(text(64)).max(24),
  lines: z.array(proposalLineSchema).max(200),
});
export type ProposalSection = z.infer<typeof proposalSectionSchema>;

export const proposalClientSchema = z.object({
  name: text(200),
  email: text(200),
  address: text(400),
});

export const openQuestionSchema = z.object({ area: text(120).nullable(), question: text(500).min(1) });

/** Everything the review screen may change, saved as a whole with PUT /api/proposals/:id. */
export const proposalEditSchema = z.object({
  title: text(200).min(1),
  client: proposalClientSchema,
  /** The opening paragraph to the client. */
  intro: text(5000),
  sections: z.array(proposalSectionSchema).max(40),
  /** Sales tax on material lines, as a fraction (0.0825 = 8.25%). Null means no tax line. */
  taxRate: z.number().min(0).max(0.2).nullable(),
  /** Payment terms, validity, exclusions: the small print, shown to the client last. */
  terms: text(5000),
  /** The site model's gaps still to settle. The architect removes each one once it is dealt with. */
  openQuestions: z.array(openQuestionSchema).max(100),
});
export type ProposalEdit = z.infer<typeof proposalEditSchema>;

export interface Proposal extends ProposalEdit {
  id: string;
  walkId: string;
  status: ProposalStatus;
  /** Unguessable; the client's link is /p/<shareToken>. */
  shareToken: string;
  createdAt: number;
  updatedAt: number;
  /** When it was first marked pending (sent). */
  sentAt: number | null;
  /** When it was marked won or lost. */
  decidedAt: number | null;
  /** Who marked it won or lost: the client pressing Accept, or the architect. */
  decidedBy: 'client' | 'architect' | null;
  /** The name the client typed when accepting. */
  acceptedName: string | null;
  /** Which model drafted it, for the record. */
  generatedBy: { provider: string; model: string; latencyMs: number } | null;
}

export interface ProposalTotals {
  /** Per section id: the sum of its priced lines. */
  sections: Record<string, number>;
  materials: number;
  labor: number;
  /** Custom lines. */
  other: number;
  subtotal: number;
  tax: number;
  total: number;
  /** Lines left out of the sums because they have no quantity or no price. */
  unpriced: number;
}

/** A line counts toward the totals only when both its quantity and its price are known. */
export function lineAmount(line: Pick<ProposalLine, 'quantity' | 'unitPrice'>): number | null {
  if (line.quantity === null || line.unitPrice === null) return null;
  return Math.round(line.quantity * line.unitPrice * 100) / 100;
}

export function proposalTotals(p: Pick<ProposalEdit, 'sections' | 'taxRate'>): ProposalTotals {
  const totals: ProposalTotals = { sections: {}, materials: 0, labor: 0, other: 0, subtotal: 0, tax: 0, total: 0, unpriced: 0 };
  for (const section of p.sections) {
    let sum = 0;
    for (const line of section.lines) {
      const amount = lineAmount(line);
      if (amount === null) {
        totals.unpriced++;
        continue;
      }
      sum += amount;
      if (line.kind === 'material') totals.materials += amount;
      else if (line.kind === 'labor') totals.labor += amount;
      else totals.other += amount;
    }
    totals.sections[section.id] = round(sum);
  }
  totals.materials = round(totals.materials);
  totals.labor = round(totals.labor);
  totals.other = round(totals.other);
  totals.subtotal = round(totals.materials + totals.labor + totals.other);
  totals.tax = round(totals.materials * (p.taxRate ?? 0));
  totals.total = round(totals.subtotal + totals.tax);
  return totals;
}

const round = (n: number) => Math.round(n * 100) / 100;
