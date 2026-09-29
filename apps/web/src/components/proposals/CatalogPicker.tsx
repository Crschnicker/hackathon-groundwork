"use client";

// Finds a catalog item to add to a section as a priced line. The same search as the catalog
// page, cut down to what choosing one needs: the name, its size and unit, and its price.
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, api, type Item } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, StatusLine } from "@/components/ui";
import { given, sentenceCase } from "@/components/catalog/format";
import { formatMoney } from "./totals";

const LIMIT = 8;
const DEBOUNCE_MS = 250;

/** The price a catalog item goes into a proposal at: its sale price, else its cost. */
export const itemPrice = (item: Item) => item.salePrice ?? item.cost;

export const itemName = (item: Item) => {
  const description = given(item.description);
  return description ? sentenceCase(description) : item.partNumber;
};

export function CatalogPicker({ onPick, onClose }: { onPick: (item: Item) => void; onClose: () => void }) {
  const id = useId();
  const { recoveries } = useServer();
  const field = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ term: string; items: Item[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const term = q.trim();

  useEffect(() => field.current?.focus(), []);

  useEffect(() => {
    if (!term) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      api
        .searchItems({ q: term, limit: LIMIT }, controller.signal)
        .then((r) => {
          setFound({ term, items: r.items });
          setFailed(false);
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          if (e instanceof ApiError && e.unreachable) return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, recoveries]);

  const items = term && found ? found.items : [];
  let status = "";
  if (!term) status = "Type a plant name, a material or a part number.";
  else if (busy) status = "Searching…";
  else if (failed) status = "The search did not go through. Change the words to try again.";
  else if (found && found.items.length === 0) status = `No items match ${found.term}.`;
  else if (found) status = `${found.items.length === LIMIT ? `The first ${LIMIT}` : found.items.length} ${found.items.length === 1 ? "item matches" : "items match"} ${found.term}.`;

  return (
    <div
      className="space-y-3 rounded-lg border border-line bg-sunken p-3 sm:p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={`${id}-q`} className="block text-sm font-medium text-ink">
          Search the catalog
        </label>
        <div className="flex gap-2">
          <input
            ref={field}
            id={`${id}-q`}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Flagstone, lavender 1 gal, 2822-315"
            autoComplete="off"
            enterKeyHint="search"
            className="control flex-1"
          />
          <Button variant="secondary" onClick={onClose} className="shrink-0">
            Close
          </Button>
        </div>
      </div>
      <StatusLine>{status}</StatusLine>
      {items.length > 0 && (
        <ul aria-busy={busy} className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((item) => {
            const price = itemPrice(item);
            const detail = [given(item.size), given(item.unit) && `per ${given(item.unit)!.toLowerCase()}`, item.partNumber]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={item.partNumber}>
                <button
                  type="button"
                  onClick={() => onPick(item)}
                  className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-brand-soft focus-visible:bg-brand-soft"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium text-ink">{itemName(item)}</span>
                    <span className="block break-words text-xs text-ink-2">{detail}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {price === null ? <span className="text-ink-3">not priced</span> : formatMoney(price)}
                    <span className="block text-xs font-medium text-brand">Add</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
