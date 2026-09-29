"use client";

// One area of the proposal: what the client is told about it, the photos that show it, and its
// priced lines. Lines come from the catalog (priced at its sale price) or are typed in by hand.
import { useEffect, useRef, useState } from "react";
import type { Item, LineCategory, ProposalLine, ProposalSection, WalkPhoto } from "@/lib/api";
import { Button, buttonClass, plural } from "@/components/ui";
import { given } from "@/components/catalog/format";
import { CatalogPicker, itemName, itemPrice } from "./CatalogPicker";
import { LineRow, lineFieldId } from "./LineRow";
import { SectionPhotos } from "./SectionPhotos";
import { formatMoney } from "./totals";

/** An id for a line added here; the server only needs it to be unique within the proposal. */
function newLineId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The category most of the section's lines already have, for a line added to it. */
function usualCategory(lines: ProposalLine[]): LineCategory {
  const counts = new Map<LineCategory, number>();
  for (const line of lines) if (line.category !== "removal") counts.set(line.category, (counts.get(line.category) ?? 0) + 1);
  let best: LineCategory = "other";
  let most = 0;
  for (const [category, n] of counts) if (n > most) [best, most] = [category, n];
  return best;
}

export const sectionAnchor = (sectionId: string) => `section-${sectionId}`;

export function SectionEditor({
  section,
  walkId,
  photos,
  subtotal,
  onChange,
}: {
  section: ProposalSection;
  walkId: string;
  photos: WalkPhoto[];
  subtotal: number;
  onChange: (section: ProposalSection) => void;
}) {
  const [picking, setPicking] = useState(false);
  const headingId = `${sectionAnchor(section.id)}-heading`;
  // The field to put the cursor in once a newly added line is on screen.
  const focusNext = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusNext.current) return;
    document.getElementById(focusNext.current)?.focus();
    focusNext.current = null;
  });

  const unpriced = section.lines.filter((l) => l.quantity === null || l.unitPrice === null).length;

  function setLine(line: ProposalLine) {
    onChange({ ...section, lines: section.lines.map((l) => (l.id === line.id ? line : l)) });
  }

  function addLine(line: ProposalLine, focus: "description" | "quantity") {
    focusNext.current = lineFieldId(line.id, focus);
    onChange({ ...section, lines: [...section.lines, line] });
  }

  function addItem(item: Item) {
    const price = itemPrice(item);
    const size = given(item.size);
    setPicking(false);
    addLine(
      {
        id: newLineId(),
        kind: "material",
        category: usualCategory(section.lines),
        partNumber: item.partNumber,
        description: size ? `${itemName(item)} (${size})` : itemName(item),
        quantity: null,
        unit: given(item.unit)?.toLowerCase() ?? null,
        unitPrice: price,
        priceSource: price === null ? null : "catalog",
        basis: null,
        toConfirm: price === null ? "No catalog price" : null,
      },
      "quantity",
    );
  }

  function addCustom() {
    addLine(
      {
        id: newLineId(),
        kind: "custom",
        category: usualCategory(section.lines),
        partNumber: null,
        description: "",
        quantity: 1,
        unit: null,
        unitPrice: null,
        priceSource: null,
        basis: null,
        toConfirm: null,
      },
      "description",
    );
  }

  return (
    <section
      id={sectionAnchor(section.id)}
      aria-labelledby={headingId}
      className="scroll-mt-24 space-y-5 rounded-lg border border-line bg-surface px-4 py-5 sm:px-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} tabIndex={-1} className="text-lg font-semibold tracking-tight text-ink">
          {section.area}
        </h3>
        <p className="text-sm tabular-nums text-ink-2">
          {formatMoney(subtotal)}
          {unpriced > 0 && <span className="text-confirm"> · {plural(unpriced, "line")} not priced</span>}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${headingId}-summary`} className="block text-sm font-medium text-ink">
          What the client reads about this area
        </label>
        <textarea
          id={`${headingId}-summary`}
          value={section.summary}
          maxLength={2000}
          rows={3}
          onChange={(e) => onChange({ ...section, summary: e.target.value })}
          className="control resize-y"
        />
      </div>

      <SectionPhotos
        walkId={walkId}
        area={section.area}
        photos={photos}
        photoIds={section.photoIds}
        onChange={(photoIds) => onChange({ ...section, photoIds })}
      />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-ink">Lines</h4>
        {section.lines.length === 0 ? (
          <p className="text-sm text-ink-2">No lines yet. Add one from the catalog, or type one in.</p>
        ) : (
          <ul className="divide-y divide-line">
            {section.lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                onChange={setLine}
                onDelete={() => {
                  onChange({ ...section, lines: section.lines.filter((l) => l.id !== line.id) });
                  addButton.current?.focus();
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {picking ? (
        <CatalogPicker
          onPick={addItem}
          onClose={() => {
            setPicking(false);
            focusNext.current = null;
            requestAnimationFrame(() => addButton.current?.focus());
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            ref={addButton}
            type="button"
            onClick={() => setPicking(true)}
            className={buttonClass("secondary")}
          >
            Add catalog item
          </button>
          <Button variant="secondary" onClick={addCustom}>
            Add line
          </Button>
        </div>
      )}

      <p className="flex justify-between border-t border-line pt-3 text-sm font-medium text-ink">
        <span>{section.area} subtotal</span>
        <span className="tabular-nums">{formatMoney(subtotal)}</span>
      </p>
    </section>
  );
}
