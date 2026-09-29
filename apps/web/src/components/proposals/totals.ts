// Proposal sums, worked out in the browser while the architect edits. The same rules as
// lineAmount and proposalTotals in apps/api/src/proposals/types.ts; keep the two in step.
import type { ProposalEdit, ProposalLine, ProposalTotals } from "@/lib/api";

const round = (n: number) => Math.round(n * 100) / 100;

/** A line counts toward the totals only when both its quantity and its price are known. */
export function lineAmount(line: Pick<ProposalLine, "quantity" | "unitPrice">): number | null {
  if (line.quantity === null || line.unitPrice === null) return null;
  return round(line.quantity * line.unitPrice);
}

export function proposalTotals(p: Pick<ProposalEdit, "sections" | "taxRate">): ProposalTotals {
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
      if (line.kind === "material") totals.materials += amount;
      else if (line.kind === "labor") totals.labor += amount;
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

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.50". */
export const formatMoney = (dollars: number) => usd.format(dollars);
