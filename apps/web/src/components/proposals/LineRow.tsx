"use client";

// One priced line of a section, editable in place: what it is, how many, at what price. The
// amount follows as the architect types. Where the line came from and what still needs
// checking are shown under it for the architect; the client sees neither.
import type { ProposalLine } from "@/lib/api";
import { lineAmount, formatMoney } from "./totals";
import { NumberField } from "./NumberField";

const kindLabels: Record<ProposalLine["kind"], string> = {
  material: "Material",
  labor: "Labor",
  custom: "Other",
};

/** The id of a line's element, for the checklist's jump links. */
export const lineAnchor = (lineId: string) => `line-${lineId}`;
export const lineFieldId = (lineId: string, field: "description" | "quantity" | "price") => `line-${lineId}-${field}`;

/** A note the generator left about the price, which entering a price answers. */
const isPriceNote = (note: string | null) => note !== null && /price/i.test(note);

const fieldLabel = "block text-2xs font-medium text-ink-2";

export function LineRow({
  line,
  onChange,
  onDelete,
}: {
  line: ProposalLine;
  onChange: (line: ProposalLine) => void;
  onDelete: () => void;
}) {
  const amount = lineAmount(line);
  const noteId = `${lineAnchor(line.id)}-note`;
  const origin = [kindLabels[line.kind], line.category === "other" ? null : line.category, line.partNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <li id={lineAnchor(line.id)} className="scroll-mt-24 space-y-2 py-4 first:pt-2">
      <div className="space-y-1">
        <label htmlFor={lineFieldId(line.id, "description")} className={fieldLabel}>
          Description
        </label>
        <input
          id={lineFieldId(line.id, "description")}
          type="text"
          value={line.description}
          maxLength={500}
          onChange={(e) => onChange({ ...line, description: e.target.value })}
          aria-invalid={!line.description.trim() || undefined}
          aria-describedby={line.toConfirm ? noteId : undefined}
          className="control"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[6rem_6rem_8rem_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={lineFieldId(line.id, "quantity")} className={fieldLabel}>
            Quantity
          </label>
          <NumberField
            id={lineFieldId(line.id, "quantity")}
            value={line.quantity}
            max={1_000_000}
            onChange={(quantity) => onChange({ ...line, quantity })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${lineAnchor(line.id)}-unit`} className={fieldLabel}>
            Unit
          </label>
          <input
            id={`${lineAnchor(line.id)}-unit`}
            type="text"
            value={line.unit ?? ""}
            maxLength={20}
            placeholder="each"
            onChange={(e) => onChange({ ...line, unit: e.target.value.trim() ? e.target.value : null })}
            className="control"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={lineFieldId(line.id, "price")} className={fieldLabel}>
            Unit price ($)
          </label>
          <NumberField
            id={lineFieldId(line.id, "price")}
            value={line.unitPrice}
            max={10_000_000}
            money
            onChange={(unitPrice) =>
              onChange({
                ...line,
                unitPrice,
                priceSource: "architect",
                toConfirm: unitPrice !== null && isPriceNote(line.toConfirm) ? null : line.toConfirm,
              })
            }
          />
        </div>
        <div className="space-y-1 sm:text-right">
          <p className={fieldLabel}>Amount</p>
          <p className="flex min-h-11 items-center tabular-nums text-ink sm:justify-end">
            {amount === null ? <span className="text-sm text-confirm">Not priced</span> : formatMoney(amount)}
          </p>
        </div>
        <div className="col-span-2 flex justify-end sm:col-span-1">
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete line: ${line.description || "no description"}`}
            className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm text-ink-2 hover:bg-danger-soft hover:text-danger"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
            </svg>
            <span className="sm:sr-only">Delete line</span>
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        {origin && <p className="text-2xs text-ink-3">{origin}</p>}
        {line.basis && <p className="max-w-[68ch] text-xs text-ink-3">{line.basis}</p>}
        {line.toConfirm && (
          <div
            id={noteId}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-confirm-line bg-confirm-soft py-1 pl-3 pr-1 text-xs text-confirm"
          >
            <p>
              <span className="font-semibold">To confirm:</span> {line.toConfirm}
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...line, toConfirm: null })}
              className="min-h-11 rounded-md px-2 font-medium underline underline-offset-4 hover:bg-confirm-line/40"
            >
              Checked
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
