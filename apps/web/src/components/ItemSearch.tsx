"use client";

import { useEffect, useState } from "react";
import { api, type FactorCodeKit, type Item, type ItemType } from "@/lib/api";

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Kit({ code, onClose }: { code: string; onClose: () => void }) {
  const [kit, setKit] = useState<FactorCodeKit | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The parent remounts this component per code (key), so state starts empty each time.
  useEffect(() => {
    api
      .factorCode(code)
      .then(setKit)
      .catch((e: Error) => setError(e.message));
  }, [code]);

  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-stone-900">Factor code {code}</h3>
          {kit && (
            <p className="text-sm text-stone-600">
              {kit.description ?? "No description"} · {kit.laborHours ?? 0} labor hours per unit
            </p>
          )}
        </div>
        <button onClick={onClose} className="text-sm text-stone-500 underline hover:text-stone-900">
          Close
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {!kit && !error && <p className="mt-2 text-sm text-stone-400">Loading kit…</p>}
      {kit && (
        <ul className="mt-3 divide-y divide-stone-200 text-sm">
          {kit.items.map((i) => (
            <li key={i.partNumber} className="flex justify-between gap-4 py-1.5">
              <span className="text-stone-800">
                {i.quantity ?? 1} × {i.description ?? i.partNumber}
              </span>
              <span className="whitespace-nowrap tabular-nums text-stone-600">
                {money(i.cost)}
                {i.bestVendorPrice !== null && ` · best quote ${money(i.bestVendorPrice)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search the item catalog in Neo4j: web → API → graph. */
export function ItemSearch() {
  const [q, setQ] = useState("juniper");
  const [type, setType] = useState("");
  const [types, setTypes] = useState<ItemType[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kitCode, setKitCode] = useState<string | null>(null);

  useEffect(() => {
    api
      .itemTypes()
      .then((r) => setTypes(r.types))
      .catch(() => setTypes([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .searchItems({ q, type: type || undefined, limit: 50 }, controller.signal)
        .then((r) => {
          setItems(r.items);
          setError(null);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, type]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="sr-only">Search items</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by description or part number"
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none placeholder:text-stone-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
          />
        </label>
        <label>
          <span className="sr-only">Item type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 sm:w-56"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label} ({t.itemCount.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
      </div>

      {kitCode && <Kit key={kitCode} code={kitCode} onClose={() => setKitCode(null)} />}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">Part #</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Unit</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Sale price</th>
              <th className="px-3 py-2 font-medium">Kit</th>
            </tr>
          </thead>
          <tbody className={`divide-y divide-stone-100 ${loading ? "opacity-50" : ""}`}>
            {items.map((i) => (
              <tr key={i.partNumber} className="hover:bg-stone-50">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-stone-600">{i.partNumber}</td>
                <td className="px-3 py-2 text-stone-900">{i.description ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-stone-600">{i.typeLabel ?? i.type ?? "—"}</td>
                <td className="px-3 py-2 text-stone-600">{i.unit ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-900">{money(i.cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-stone-900">{money(i.salePrice)}</td>
                <td className="px-3 py-2">
                  {i.factorCode ? (
                    <button
                      onClick={() => setKitCode(i.factorCode)}
                      className="font-mono text-xs text-emerald-700 underline hover:text-emerald-900"
                    >
                      {i.factorCode}
                    </button>
                  ) : (
                    <span className="text-stone-300">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-stone-500">
                  No items match “{q}”{type && " in this type"}. Try a plant name, a material or a part number.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        {loading ? "Searching…" : `${items.length} item${items.length === 1 ? "" : "s"} shown (first 50 matches)`}
      </p>
    </section>
  );
}
