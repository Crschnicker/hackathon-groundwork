"use client";

// The catalog: a searchable price list. An item with a kit opens it in place, under itself.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type ItemType } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, StatusLine, plural } from "@/components/ui";
import { Results, ResultsSkeleton, kitButtonId, toRow, type CatalogRow } from "@/components/catalog/Results";
import { useWide } from "@/components/catalog/useWide";

const FIRST = 10;
const MORE = 20;
/** The most the server gives for one search. */
const MOST = 200;
const DEBOUNCE_MS = 250;

/** What the last finished search found, and what it searched for. */
interface Found {
  rows: CatalogRow[];
  /** Every match, shown or not. Null when the server does not say and there may be more. */
  total: number | null;
  term: string;
  type: string;
  limit: number;
  /** These results extend the ones before them: "Show 20 more" was used. */
  more: boolean;
}

export function Catalog() {
  const { state: serverState, recoveries } = useServer();
  const wide = useWide();
  const idBase = useId();

  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(FIRST);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [found, setFound] = useState<Found | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openPart, setOpenPart] = useState<string | null>(null);

  const term = q.trim();
  const searched = useRef<string | null>(null);
  const typeSelect = useRef<HTMLSelectElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .itemTypes()
      .then((r) => {
        if (!cancelled) setTypes(r.types);
      })
      // Without the types the search still works across all of them.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [recoveries]);

  useEffect(() => {
    const controller = new AbortController();
    // Only typing waits; a new type, more rows or a retry are single deliberate actions.
    const wait = searched.current === null || searched.current === term ? 0 : DEBOUNCE_MS;
    const timer = setTimeout(() => {
      searched.current = term;
      setBusy(true);
      api
        .searchItems({ q: term, type: type || undefined, limit }, controller.signal)
        .then((r) => {
          const rows = r.items.map(toRow);
          setFound((before) => ({
            rows,
            total: r.total ?? (rows.length < limit ? rows.length : null),
            term,
            type,
            limit,
            more: before !== null && before.term === term && before.type === type && limit > before.limit,
          }));
          setFailed(false);
          // A kit belongs to its item: when the item leaves the results, the kit goes with it.
          setOpenPart((part) => (part !== null && rows.some((row) => row.partNumber === part) ? part : null));
        })
        .catch((e: unknown) => {
          if (controller.signal.aborted) return;
          // The banner says the server is unreachable; what is on screen stays until it is back.
          if (e instanceof ApiError && e.unreachable) return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, wait);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, type, limit, recoveries, attempt]);

  // Escape closes the open kit and hands focus back to the button that opened it. In a text
  // field or a select, Escape keeps its own meaning.
  useEffect(() => {
    if (openPart === null) return;
    const part = openPart;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const at = e.target;
      if (at instanceof HTMLInputElement || at instanceof HTMLSelectElement || at instanceof HTMLTextAreaElement) return;
      closeKit(part);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // closeKit only reads idBase, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPart]);

  const shown = found?.rows.length ?? 0;
  const mayHaveMore = found !== null && (found.total === null ? shown === found.limit : shown < found.total);
  const canShowMore = mayHaveMore && found.limit < MOST;
  const nextStep = found === null ? MORE : Math.min(MORE, MOST - found.limit, found.total === null ? MORE : found.total - shown);
  const loadingMore = busy && found !== null && found.term === term && found.type === type && limit > found.limit;

  // When the last rows have arrived the "Show more" button is gone; focus goes to the count.
  useEffect(() => {
    if (found?.more && !canShowMore && document.activeElement === document.body) summary.current?.focus();
  }, [found, canShowMore]);

  function closeKit(part: string) {
    document.getElementById(kitButtonId(idBase, part))?.focus();
    setOpenPart(null);
  }

  function searchAllTypes() {
    setType("");
    setLimit(FIRST);
    // The button that was pressed goes away with the empty result.
    typeSelect.current?.focus();
  }

  const labelOf = (code: string) => types.find((t) => t.code === code)?.label ?? "this type";
  const within = found?.type ? ` in ${labelOf(found.type)}` : "";

  let status = "";
  if (busy) status = found === null ? "Loading the catalog…" : loadingMore ? "Loading more items…" : "Searching…";
  else if (found !== null && !failed) {
    if (found.more) status = `Showing ${countLine(shown, found.total)}${within}.`;
    else if (found.total === null) status = found.term ? `The first ${plural(shown, "item")} that match ${found.term}${within}.` : "";
    else if (found.total === 0) status = `No items${found.term ? ` match ${found.term}` : ""}${within}.`;
    else if (found.term) status = `${plural(found.total, "item")} ${found.total === 1 ? "matches" : "match"} ${found.term}${within}.`;
    else status = `${plural(found.total, "item")} in ${found.type ? labelOf(found.type) : "the catalog"}.`;
  }

  return (
    <section aria-label="Search the catalog" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="space-y-1.5">
          <label htmlFor={`${idBase}-search`} className="block text-sm font-medium text-ink">
            Search the catalog
          </label>
          <input
            id={`${idBase}-search`}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(FIRST);
            }}
            placeholder="Plant name, material or part number"
            autoComplete="off"
            enterKeyHint="search"
            className="control"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${idBase}-type`} className="block text-sm font-medium text-ink">
            Type
          </label>
          <select
            id={`${idBase}-type`}
            ref={typeSelect}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setLimit(FIRST);
            }}
            className="control"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label} ({t.itemCount.toLocaleString("en-US")})
              </option>
            ))}
          </select>
        </div>
      </div>

      <StatusLine>{status}</StatusLine>

      {failed && (
        <Notice
          title="The search did not go through."
          action={
            <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)} busy={busy}>
              Try again
            </Button>
          }
        >
          {found === null ? "Nothing is wrong with the catalog itself." : "What is shown below is from the search before it."}
        </Notice>
      )}

      {found === null ? (
        failed ? null : serverState === "offline" && !busy ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-8 text-sm text-ink-2 sm:px-6">
            The catalog will appear here once the server is back.
          </p>
        ) : (
          <ResultsSkeleton rows={FIRST} />
        )
      ) : shown === 0 ? (
        <div aria-busy={busy} className="space-y-3 rounded-lg border border-line bg-surface px-4 py-8 sm:px-6">
          <h2 className="break-words text-lg font-semibold tracking-tight text-ink">
            {found.term ? (
              <>
                No items match &ldquo;{found.term}&rdquo;{within}
              </>
            ) : (
              <>No items{within}</>
            )}
          </h2>
          <p className="max-w-[62ch] text-sm text-ink-2">
            Try a plant name such as juniper, a material such as gravel, or a part number such as 2822-315.
            {found.type && ` Or search every type instead of only ${labelOf(found.type)}.`}
          </p>
          {found.type && (
            <Button variant="secondary" onClick={searchAllTypes}>
              Search all types
            </Button>
          )}
        </div>
      ) : (
        <>
          <Results
            rows={found.rows}
            openPart={openPart}
            idBase={idBase}
            wide={wide}
            busy={busy}
            onToggle={(part) => setOpenPart((current) => (current === part ? null : part))}
            onClose={() => openPart !== null && closeKit(openPart)}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p ref={summary} tabIndex={-1} className="text-sm tabular-nums text-ink-2">
              Showing {countLine(shown, found.total)}
              {mayHaveMore && !canShowMore && `. The list stops at ${MOST}; narrow the search to find the rest.`}
            </p>
            {canShowMore && (
              <Button variant="secondary" busy={loadingMore} onClick={() => setLimit(Math.min(MOST, found.limit + MORE))}>
                Show {nextStep} more
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** "10 of 312 items", or "10 items" when the server does not say how many there are. */
function countLine(shown: number, total: number | null): string {
  return total === null ? plural(shown, "item") : `${shown.toLocaleString("en-US")} of ${plural(total, "item")}`;
}
