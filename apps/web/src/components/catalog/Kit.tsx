"use client";

// A kit: the installation materials and labor an item brings with it, opened in place under
// the item it belongs to.
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type FactorCodeKit } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, StatusLine, plural } from "@/components/ui";
import { labor, money, quantity, sentenceCase } from "./format";

type Material = FactorCodeKit["items"][number];

type KitState =
  | { status: "loading" }
  | { status: "ready"; kit: FactorCodeKit }
  /** missing: the catalog holds no materials for this kit, so trying again will not help. */
  | { status: "failed"; missing: boolean };

// Many items share one kit, and the same kit is reopened when the window changes layout.
const loaded = new Map<string, FactorCodeKit>();

// A kit line without a quantity counts once, as the price list does.
const extended = (m: Material) => (m.cost === null ? null : (m.quantity ?? 1) * m.cost);

const quoteBelowCost = (m: Material) =>
  m.bestVendorPrice !== null && m.cost !== null && m.bestVendorPrice < m.cost ? m.bestVendorPrice : null;

function Amount({ value }: { value: number | null }) {
  return value === null ? <span className="text-ink-3">not priced</span> : <>{money(value)}</>;
}

function VendorQuote({ material }: { material: Material }) {
  const quote = quoteBelowCost(material);
  if (quote === null) return null;
  return <p className="text-xs tabular-nums text-ink-2">best vendor quote {money(quote)}</p>;
}

function MaterialsTable({ kit, total }: { kit: FactorCodeKit; total: number }) {
  return (
    <table className="w-full table-fixed text-left text-sm">
      <caption className="sr-only">What kit {kit.code} adds for each unit installed</caption>
      <colgroup>
        <col className="w-24" />
        <col className="w-20" />
        <col />
        <col className="w-28" />
        <col className="w-32" />
      </colgroup>
      <thead>
        <tr className="border-b border-line-strong text-xs text-ink-2">
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Quantity
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Unit
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Material
          </th>
          <th scope="col" className="py-2 pr-4 text-right font-medium">
            Unit cost
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Extended cost
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {kit.items.map((m, i) => (
          <tr key={`${i}-${m.partNumber}`} className="align-top">
            <td className="py-2.5 pr-4 text-right tabular-nums text-ink">{quantity(m.quantity ?? 1)}</td>
            <td className="py-2.5 pr-4 text-ink-2">{m.unit?.trim() || <span className="text-ink-3">not given</span>}</td>
            <td className="break-words py-2.5 pr-4 text-ink">
              {m.description ?? m.partNumber}
              <VendorQuote material={m} />
            </td>
            <td className="whitespace-nowrap py-2.5 pr-4 text-right tabular-nums text-ink">
              <Amount value={m.cost} />
            </td>
            <td className="whitespace-nowrap py-2.5 text-right tabular-nums text-ink">
              <Amount value={extended(m)} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line-strong">
          <th scope="row" colSpan={4} className="py-3 pr-4 text-left font-semibold text-ink">
            Materials per unit installed
          </th>
          <td className="whitespace-nowrap py-3 text-right font-semibold tabular-nums text-ink">{money(total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** The same materials for a narrow screen: one block each, the extended cost at its right. */
function MaterialsList({ kit, total }: { kit: FactorCodeKit; total: number }) {
  return (
    <div className="text-sm">
      <ul aria-label={`What kit ${kit.code} adds for each unit installed`} className="divide-y divide-line border-t border-line-strong">
        {kit.items.map((m, i) => (
          <li key={`${i}-${m.partNumber}`} className="flex items-start justify-between gap-4 py-2.5">
            <div className="min-w-0 space-y-0.5">
              <p className="break-words text-ink">{m.description ?? m.partNumber}</p>
              <p className="text-xs tabular-nums text-ink-2">
                {quantity(m.quantity ?? 1)} {m.unit?.trim()} at{" "}
                {m.cost === null ? <span className="text-ink-3">not priced</span> : `${money(m.cost)} each`}
              </p>
              <VendorQuote material={m} />
            </div>
            <p className="shrink-0 whitespace-nowrap text-right tabular-nums text-ink">
              <span className="sr-only">Extended cost </span>
              <Amount value={extended(m)} />
            </p>
          </li>
        ))}
      </ul>
      <p className="flex items-baseline justify-between gap-4 border-t border-line-strong py-3 font-semibold text-ink">
        <span>Materials per unit installed</span>
        <span className="shrink-0 tabular-nums">{money(total)}</span>
      </p>
    </div>
  );
}

/** Reserves about the height of a kit of ten materials, so the page moves once, not twice. */
function MaterialsSkeleton({ wide }: { wide: boolean }) {
  return (
    <div aria-hidden className="divide-y divide-line border-t border-line-strong">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className={`flex items-center justify-between gap-4 ${wide ? "h-10" : "h-16"}`}>
          <div className={`skeleton h-4 ${i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-2/5" : "w-1/2"}`} />
          <div className="skeleton h-4 w-16" />
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton h-4 w-20" />
      </div>
    </div>
  );
}

export function Kit({
  id,
  code,
  wide,
  onClose,
  className = "",
}: {
  /** The id the kit button points at with aria-controls. */
  id: string;
  code: string;
  /** Wide enough for the materials to be a table. */
  wide: boolean;
  onClose: () => void;
  className?: string;
}) {
  const { recoveries } = useServer();
  const [state, setState] = useState<KitState>(() => {
    const kit = loaded.get(code);
    return kit ? { status: "ready", kit } : { status: "loading" };
  });
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opening a kit moves focus into it.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    if (loaded.has(code)) return;
    let cancelled = false;
    api
      .factorCode(code)
      .then((kit) => {
        loaded.set(code, kit);
        if (!cancelled) setState({ status: "ready", kit });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // The banner says the server is unreachable; this loads again when it is back.
        if (e instanceof ApiError && e.unreachable) return;
        setState({ status: "failed", missing: e instanceof ApiError && e.status === 404 });
      });
    return () => {
      cancelled = true;
    };
  }, [code, attempt, recoveries]);

  function tryAgain() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
    // The button that was pressed is about to go.
    heading.current?.focus();
  }

  const kit = state.status === "ready" ? state.kit : null;
  const total = kit ? kit.items.reduce((sum, m) => sum + (extended(m) ?? 0), 0) : 0;
  const unpriced = kit ? kit.items.filter((m) => m.cost === null).length : 0;

  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`bg-sunken px-4 py-4 sm:px-6 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-lg font-semibold tracking-tight text-ink">
            Kit {code}
          </h2>
          <StatusLine>
            {state.status === "loading" && "Loading what this kit adds…"}
            {kit && `${kit.description ? `${sentenceCase(kit.description)}. ` : ""}${labor(kit.laborHours)}.`}
          </StatusLine>
        </div>
        <Button variant="secondary" onClick={onClose} className="shrink-0">
          Close<span className="sr-only"> kit {code}</span>
        </Button>
      </div>

      <div className="mt-3">
        {state.status === "loading" && <MaterialsSkeleton wide={wide} />}
        {state.status === "failed" &&
          (state.missing ? (
            <Notice tone="neutral" title={`Kit ${code} has no materials listed.`}>
              The item is priced on its own.
            </Notice>
          ) : (
            <Notice
              title={`Kit ${code} did not load.`}
              action={
                <Button variant="secondary" onClick={tryAgain}>
                  Try again
                </Button>
              }
            >
              The catalog is still here; only this kit is missing.
            </Notice>
          ))}
        {kit && (
          <div className="settle">
            {wide ? <MaterialsTable kit={kit} total={total} /> : <MaterialsList kit={kit} total={total} />}
            {unpriced > 0 && (
              <p className="text-sm text-ink-2">
                {plural(unpriced, "material")} {unpriced === 1 ? "is" : "are"} not priced and left out of the total.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
