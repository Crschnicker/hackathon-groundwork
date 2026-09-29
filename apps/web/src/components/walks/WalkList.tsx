"use client";

// The walks recorded on the phone, newest first. A walk in progress is marked live, and the
// list keeps itself up to date while the page is being looked at.
import Link from "next/link";
import { useCallback, useState } from "react";
import { ApiError, api, type WalkSummary } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, buttonClass, formatWhen, plural } from "@/components/ui";
import { usePolling } from "./usePolling";
import { WalkTokenForm } from "./WalkTokenForm";

const REFRESH_MS = 5_000;

function State({ status }: { status: WalkSummary["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-2 font-medium text-ink">
        <span aria-hidden className="live-dot h-2.5 w-2.5 rounded-full bg-danger" />
        Live
      </span>
    );
  }
  return <span className="text-ink-2">Finished</span>;
}

export function WalkList() {
  const { state: server, recoveries } = useServer();
  const [walks, setWalks] = useState<WalkSummary[] | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const next = await api.walks(signal);
      setWalks(next);
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

  if (needsToken) {
    return (
      <WalkTokenForm
        verify={() => api.walks()}
        onAccepted={() => {
          setWalks(null);
          setNeedsToken(false);
        }}
      />
    );
  }

  if (failed && walks === null) {
    return (
      <Notice
        title="The walks could not be loaded."
        action={
          <Button variant="secondary" onClick={() => setReloads((n) => n + 1)}>
            Try again
          </Button>
        }
      >
        The server answered, but not with the list. Groundwork keeps trying every few seconds.
      </Notice>
    );
  }

  if (walks === null) {
    if (server === "offline") {
      return (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          Walks appear here as soon as the server can be reached again.
        </p>
      );
    }
    return (
      <ul aria-busy aria-label="Loading walks" className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="skeleton h-5 w-40" />
            <div className="skeleton h-5 w-20" />
          </li>
        ))}
      </ul>
    );
  }

  if (walks.length === 0) {
    return (
      <div className="space-y-4 rounded-lg border border-line bg-surface px-4 py-6 sm:px-6">
        <div className="max-w-[62ch] space-y-1">
          <p className="text-base font-medium text-ink">No walks yet.</p>
          <p className="text-sm text-ink-2">
            Start one from the Walk tab of the Groundwork Walk app on the phone. It appears here when the first
            recording arrives, usually about a minute and a half in.
          </p>
        </div>
        <Link href="/walks/sample" className={buttonClass("secondary")}>
          See a sample walk
        </Link>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {walks.map((walk) => (
        <li key={walk.id}>
          <Link
            href={`/walks/${encodeURIComponent(walk.id)}`}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-3 text-sm transition-colors duration-150 hover:bg-sunken focus-visible:-outline-offset-2 sm:grid-cols-[minmax(0,1fr)_9rem_6rem] sm:px-6"
          >
            <span className="text-base font-medium text-ink">{formatWhen(walk.createdAt)}</span>
            <span className="col-start-1 row-start-2 tabular-nums text-ink-2 sm:col-start-auto sm:row-start-auto">
              {walk.chunks === 0 ? "No recordings yet" : plural(walk.chunks, "recording")}
            </span>
            <span className="col-start-2 row-span-2 row-start-1 sm:col-start-auto sm:row-span-1 sm:row-start-auto">
              <State status={walk.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
