"use client";

// The catalog's results, drawn from one list of rows: a table where there is room for one,
// a stacked list where there is not. An open kit sits directly under its item in both.
import { Fragment } from "react";
import type { Item } from "@/lib/api";
import { buttonClass } from "@/components/ui";
import { Kit } from "./Kit";
import { given, money } from "./format";

/** One item, worked out once for both layouts. */
export interface CatalogRow {
  partNumber: string;
  description: string;
  type: string | null;
  unit: string | null;
  cost: number | null;
  salePrice: number | null;
  belowCost: boolean;
  kitCode: string | null;
}

export function toRow(item: Item): CatalogRow {
  return {
    partNumber: item.partNumber,
    description: given(item.description) ?? item.partNumber,
    type: given(item.typeLabel) ?? given(item.type),
    unit: given(item.unit),
    cost: item.cost,
    salePrice: item.salePrice,
    belowCost: item.cost !== null && item.salePrice !== null && item.salePrice < item.cost,
    kitCode: given(item.factorCode),
  };
}

interface ResultsProps {
  rows: CatalogRow[];
  /** Part number of the item whose kit is open. Many items share one kit, so not the kit code. */
  openPart: string | null;
  /** Prefix for the ids that tie each kit button to its kit. */
  idBase: string;
  wide: boolean;
  busy: boolean;
  onToggle: (partNumber: string) => void;
  onClose: () => void;
}

export const kitButtonId = (idBase: string, partNumber: string) => `${idBase}-button-${partNumber.replace(/\s+/g, "_")}`;
const kitPanelId = (idBase: string, partNumber: string) => `${idBase}-kit-${partNumber.replace(/\s+/g, "_")}`;

const openKitButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-soft px-4 text-sm font-medium " +
  "text-brand ring-1 ring-inset ring-brand transition-colors duration-150";

function Price({ value }: { value: number | null }) {
  return value === null ? <span className="text-ink-3">not priced</span> : <>{money(value)}</>;
}

const Missing = ({ children }: { children: string }) => <span className="text-ink-3">{children}</span>;

function KitButton({ row, open, idBase, onToggle }: { row: CatalogRow; open: boolean; idBase: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      id={kitButtonId(idBase, row.partNumber)}
      aria-expanded={open}
      aria-controls={kitPanelId(idBase, row.partNumber)}
      onClick={onToggle}
      className={`whitespace-nowrap tabular-nums ${open ? openKitButton : buttonClass("secondary")}`}
    >
      Kit {row.kitCode}
    </button>
  );
}

function ResultsTable({ rows, openPart, idBase, busy, onToggle, onClose }: ResultsProps) {
  return (
    <div aria-busy={busy} className="overflow-hidden rounded-lg border border-line bg-surface">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Catalog items that match the search, with their prices and kits</caption>
        <colgroup>
          <col />
          <col className="w-24 lg:w-40" />
          <col className="w-16" />
          <col className="w-24 lg:w-28" />
          <col className="w-32 lg:w-40" />
          <col className="w-32 lg:w-36" />
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-sunken text-xs text-ink-2">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Item
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Type
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Unit
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Cost
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              Sale price
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              Kit
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const open = row.partNumber === openPart && row.kitCode !== null;
            return (
              <Fragment key={row.partNumber}>
                <tr className={`transition-colors duration-150 ${open ? "bg-brand-soft" : ""}`}>
                  <th scope="row" className="px-4 py-2 font-normal">
                    <span className="block break-words font-medium text-ink">{row.description}</span>
                    <span className="block break-all font-mono text-xs text-ink-2">{row.partNumber}</span>
                  </th>
                  <td className="break-words px-3 py-2 text-ink-2">{row.type ?? <Missing>not given</Missing>}</td>
                  <td className="px-3 py-2 text-ink-2">{row.unit ?? <Missing>none</Missing>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">
                    <Price value={row.cost} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    <span className="flex flex-wrap items-baseline justify-end gap-x-2">
                      {row.belowCost && <span className="text-xs text-danger">below cost</span>}
                      <span className="whitespace-nowrap">
                        <Price value={row.salePrice} />
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.kitCode ? (
                      <KitButton row={row} open={open} idBase={idBase} onToggle={() => onToggle(row.partNumber)} />
                    ) : (
                      <Missing>no kit</Missing>
                    )}
                  </td>
                </tr>
                {open && row.kitCode && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <Kit
                        key={row.partNumber}
                        id={kitPanelId(idBase, row.partNumber)}
                        code={row.kitCode}
                        wide
                        onClose={onClose}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultsList({ rows, openPart, idBase, busy, onToggle, onClose }: ResultsProps) {
  return (
    <ul aria-busy={busy} aria-label="Catalog items that match the search" className="divide-y divide-line border-y border-line">
      {rows.map((row) => {
        const open = row.partNumber === openPart && row.kitCode !== null;
        const facts = [row.type, row.unit].filter(Boolean);
        return (
          <li key={row.partNumber} className="space-y-3 py-4">
            <div className="space-y-0.5">
              <p className="break-words text-base font-medium text-ink">{row.description}</p>
              <p className="break-words text-sm text-ink-2">
                <span className="font-mono text-xs">{row.partNumber}</span>
                {facts.map((fact) => (
                  <Fragment key={fact}> · {fact}</Fragment>
                ))}
              </p>
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">Cost</dt>
                <dd className="text-right tabular-nums text-ink">
                  <Price value={row.cost} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-2">Sale price</dt>
                <dd className="flex flex-wrap items-baseline justify-end gap-x-2 text-right tabular-nums text-ink">
                  {row.belowCost && <span className="text-xs text-danger">below cost</span>}
                  <span>
                    <Price value={row.salePrice} />
                  </span>
                </dd>
              </div>
            </dl>
            {row.kitCode ? (
              <KitButton row={row} open={open} idBase={idBase} onToggle={() => onToggle(row.partNumber)} />
            ) : (
              <p className="text-sm text-ink-3">No kit</p>
            )}
            {open && row.kitCode && (
              <Kit
                key={row.partNumber}
                id={kitPanelId(idBase, row.partNumber)}
                code={row.kitCode}
                wide={false}
                onClose={onClose}
                className="rounded-lg"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Results(props: ResultsProps) {
  return props.wide ? <ResultsTable {...props} /> : <ResultsList {...props} />;
}

/**
 * The first load, in the place and at about the height of ten results. Both layouts are in
 * the page and the stylesheet picks one, because this is drawn before the window is measured.
 */
export function ResultsSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div aria-hidden>
      <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
        <div className="h-[2.375rem] border-b border-line bg-sunken" />
        <div className="divide-y divide-line">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex h-[3.75rem] items-center gap-6 px-4">
              <div className="flex-1 space-y-2">
                <div className={`skeleton h-4 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-2/5" : "w-1/2"}`} />
                <div className="skeleton h-3 w-20" />
              </div>
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-4 w-16" />
              <div className="skeleton h-9 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="divide-y divide-line border-y border-line md:hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-[11.5rem] space-y-3 py-4">
            <div className={`skeleton h-5 ${i % 2 === 0 ? "w-4/5" : "w-3/5"}`} />
            <div className="skeleton h-4 w-2/5" />
            <div className="skeleton h-10 w-full" />
            <div className="skeleton h-11 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
