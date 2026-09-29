// How the catalog writes amounts, quantities and the text that comes from the price list.

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.50". An amount that would round to nothing is "under $0.01", never "$0.00". */
export function money(amount: number): string {
  if (amount > 0 && amount < 0.005) return "under $0.01";
  return dollars.format(amount);
}

/** "6", "0.008": a kit's quantities go down to thousandths of a bag. */
export function quantity(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** "1.01 labor hours per unit installed". */
export function labor(hours: number | null): string {
  if (hours === null) return "No labor listed";
  const n = hours.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${n} labor ${hours === 1 ? "hour" : "hours"} per unit installed`;
}

/** The price list is typed in capitals: "15GTREE,NO BACKFILL" reads as "15gtree, no backfill". */
export function sentenceCase(text: string): string {
  const lower = text.trim().toLowerCase().replace(/,(?=\S)/g, ", ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The price list leaves some fields blank, or holds a lone full stop in them. */
export function given(text: string | null): string | null {
  const trimmed = (text ?? "").trim();
  return trimmed === "" || trimmed === "." ? null : trimmed;
}
