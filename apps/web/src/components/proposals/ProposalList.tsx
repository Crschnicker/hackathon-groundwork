"use client";

// Every proposal, newest change first: how much is waiting on clients, how much has been won,
// and a filter by status. Below it, a walk can be picked to draft a new proposal from. The list
// refreshes by itself, so a client accepting from their link shows up here as won.
import Link from "next/link";
import { useCallback, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, type ProposalStatus, type ProposalSummary, type WalkSummary } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, SectionHeading, StatusLine, buttonClass, formatWhen, plural } from "@/components/ui";
import { usePolling } from "@/components/walks/usePolling";
import { WalkTokenForm } from "@/components/walks/WalkTokenForm";
import { DRAFTING_MESSAGE, useDraftProposal } from "./GenerateProposalButton";
import { StatusBadge, statusLabels } from "./StatusBadge";
import { formatMoney } from "./totals";

const REFRESH_MS = 10_000;

type Filter = "all" | ProposalStatus;
const FILTERS: Filter[] = ["all", "draft", "pending", "won", "lost"];

/** Sums for the numbers at the top: what is out with clients, what has been won, and how often. */
function headline(proposals: ProposalSummary[]) {
  const pending = proposals.filter((p) => p.status === "pending");
  const won = proposals.filter((p) => p.status === "won");
  const lost = proposals.filter((p) => p.status === "lost");
  const sum = (list: ProposalSummary[]) => list.reduce((total, p) => total + p.total, 0);
  const decided = won.length + lost.length;
  return {
    pendingValue: sum(pending),
    pendingCount: pending.length,
    wonValue: sum(won),
    wonCount: won.length,
    winRate: decided > 0 ? Math.round((won.length / decided) * 100) : null,
    decided,
  };
}

function Figure({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="space-y-0.5 rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums tracking-tight text-ink">{value}</dd>
      <dd className="text-xs text-ink-3">{detail}</dd>
    </div>
  );
}

function Headline({ proposals }: { proposals: ProposalSummary[] }) {
  const h = headline(proposals);
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <Figure
        label="Waiting on clients"
        value={formatMoney(h.pendingValue)}
        detail={h.pendingCount === 0 ? "Nothing sent and open." : `${plural(h.pendingCount, "proposal")} pending.`}
      />
      <Figure
        label="Won"
        value={formatMoney(h.wonValue)}
        detail={h.wonCount === 0 ? "None won yet." : `${plural(h.wonCount, "proposal")} won.`}
      />
      <Figure
        label="Win rate"
        value={h.winRate === null ? "None yet" : `${h.winRate}%`}
        detail={h.decided === 0 ? "Counts proposals marked won or lost." : `Of ${plural(h.decided, "decided proposal")}.`}
      />
    </dl>
  );
}

/** All / Draft / Pending / Won / Lost, each with how many there are. */
function FilterBar({
  value,
  counts,
  onChange,
}: {
  value: Filter;
  counts: Record<Filter, number>;
  onChange: (next: Filter) => void;
}) {
  return (
    <div role="group" aria-label="Show proposals" className="flex flex-wrap gap-1 rounded-lg bg-sunken p-1">
      {FILTERS.map((filter) => {
        const current = filter === value;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={current}
            onClick={() => onChange(filter)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${
              current ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-ink-2 hover:text-ink"
            }`}
          >
            {filter === "all" ? "All" : statusLabels[filter]}
            <span className="tabular-nums text-ink-3">{counts[filter]}</span>
          </button>
        );
      })}
    </div>
  );
}

function Rows({ proposals }: { proposals: ProposalSummary[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {proposals.map((p) => (
        <li key={p.id}>
          <Link
            href={`/proposals/${encodeURIComponent(p.id)}`}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 text-sm transition-colors duration-150 hover:bg-sunken focus-visible:-outline-offset-2 sm:grid-cols-[minmax(0,1fr)_6rem_8rem] sm:px-6"
          >
            <span className="min-w-0 space-y-0.5">
              <span className="block truncate text-base font-medium text-ink">{p.title || "Untitled proposal"}</span>
              <span className="block truncate text-ink-2">
                {p.clientName.trim() || "No client yet"}
                <span className="text-ink-3"> · Updated {formatWhen(p.updatedAt)}</span>
              </span>
            </span>
            <span className="justify-self-end sm:justify-self-start">
              <StatusBadge status={p.status} />
            </span>
            <span className="col-span-2 tabular-nums text-ink sm:col-span-1 sm:text-right sm:text-base sm:font-medium">
              {formatMoney(p.total)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Picks a walk and drafts a proposal from it. Walks with no recordings cannot have areas yet. */
function DraftFromWalk({ walks }: { walks: WalkSummary[] | null }) {
  const id = useId();
  const { draft, busy, error } = useDraftProposal();
  const usable = useMemo(() => (walks ?? []).filter((w) => w.chunks > 0), [walks]);
  const [picked, setPicked] = useState("");
  const walkId = usable.some((w) => w.id === picked) ? picked : (usable[0]?.id ?? "");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && walkId) void draft(walkId);
  }

  if (walks === null) {
    return <div aria-busy aria-label="Loading walks" className="skeleton h-24 max-w-xl" />;
  }

  if (usable.length === 0) {
    return (
      <div className="max-w-xl space-y-3 rounded-lg border border-line bg-surface px-4 py-5 sm:px-6">
        <p className="text-sm text-ink-2">
          No walk has recordings yet. Walk the site with the Groundwork Walk app first; its proposal is drafted from
          what was said.
        </p>
        <Link href="/" className={buttonClass("secondary")}>
          See the walks
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-3 rounded-lg border border-line bg-surface px-4 py-5 sm:px-6">
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          Walk
        </label>
        <select id={id} value={walkId} onChange={(e) => setPicked(e.target.value)} disabled={busy} className="control">
          {usable.map((w) => (
            <option key={w.id} value={w.id}>
              {formatWhen(w.createdAt)} · {plural(w.chunks, "recording")}
              {w.status === "active" ? " · live" : ""}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" busy={busy}>
        {busy ? "Drafting the proposal" : "Draft the proposal"}
      </Button>
      <StatusLine>{busy ? DRAFTING_MESSAGE : ""}</StatusLine>
      {error && <Notice title="The proposal could not be drafted.">{error}</Notice>}
    </form>
  );
}

export function ProposalList() {
  const { state: server, recoveries } = useServer();
  const [proposals, setProposals] = useState<ProposalSummary[] | null>(null);
  const [walks, setWalks] = useState<WalkSummary[] | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      // The walk picker is secondary: a walk list that fails to load leaves the proposals showing.
      const [nextProposals, nextWalks] = await Promise.all([
        api.proposals(signal),
        api.walks(signal).catch(() => null),
      ]);
      setProposals(nextProposals);
      if (nextWalks) setWalks(nextWalks);
      setFailed(false);
    } catch (err) {
      if (signal.aborted) return;
      // The banner says the server is unreachable; what is on screen stays.
      if (err instanceof ApiError && err.unreachable) return;
      if (err instanceof ApiError && err.needsToken) setNeedsToken(true);
      else setFailed(true);
    }
  }, []);

  usePolling(load, { everyMs: REFRESH_MS, active: !needsToken, reloadKey: `${recoveries}:${reloads}` });

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, draft: 0, pending: 0, won: 0, lost: 0 };
    for (const p of proposals ?? []) {
      c.all++;
      c[p.status]++;
    }
    return c;
  }, [proposals]);

  if (needsToken) {
    return (
      <WalkTokenForm
        verify={() => api.proposals()}
        onAccepted={() => {
          setProposals(null);
          setWalks(null);
          setNeedsToken(false);
        }}
      />
    );
  }

  let list: ReactNode;
  if (failed && proposals === null) {
    list = (
      <Notice
        title="The proposals could not be loaded."
        action={
          <Button variant="secondary" onClick={() => setReloads((n) => n + 1)}>
            Try again
          </Button>
        }
      >
        The server answered, but not with the list. Groundwork keeps trying every few seconds.
      </Notice>
    );
  } else if (proposals === null) {
    list =
      server === "offline" ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          Proposals appear here as soon as the server can be reached again.
        </p>
      ) : (
        <ul aria-busy aria-label="Loading proposals" className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 sm:px-6">
              <div className="skeleton h-5 w-48" />
              <div className="skeleton h-5 w-20" />
            </li>
          ))}
        </ul>
      );
  } else if (proposals.length === 0) {
    list = (
      <div className="max-w-[62ch] space-y-1 rounded-lg border border-line bg-surface px-4 py-6 sm:px-6">
        <p className="text-base font-medium text-ink">No proposals yet.</p>
        <p className="text-sm text-ink-2">
          Draft one from a walk below. It starts as a draft for you to review; the client sees nothing until you mark
          it as sent.
        </p>
      </div>
    );
  } else {
    const shown = filter === "all" ? proposals : proposals.filter((p) => p.status === filter);
    list = (
      <div className="space-y-4">
        <Headline proposals={proposals} />
        <FilterBar value={filter} counts={counts} onChange={setFilter} />
        {shown.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
            No {statusLabels[filter as ProposalStatus].toLowerCase()} proposals.
          </p>
        ) : (
          <Rows proposals={shown} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-14">
      <section aria-labelledby="proposals" className="space-y-4">
        <SectionHeading id="proposals" title="Your proposals">
          Draft until you send it, then pending until the client accepts or you mark it won or lost.
        </SectionHeading>
        {list}
      </section>

      <section aria-labelledby="draft" className="space-y-4">
        <SectionHeading id="draft" title="Draft a proposal from a walk">
          Groundwork prices each area of the walk from the catalog and adds the photos taken there. Pick a walk that
          has found at least one area.
        </SectionHeading>
        <DraftFromWalk walks={walks} />
      </section>
    </div>
  );
}
