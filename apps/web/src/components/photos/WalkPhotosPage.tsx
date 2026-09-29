"use client";

// One walk's photos on a page of their own, at /walks/[id]/photos: loads the walk and keeps it
// fresh, since photos from the phone and the areas they are matched to keep arriving after the
// walk has finished.
import Link from "next/link";
import { useCallback, useState } from "react";
import { ApiError, api, type Walk } from "@/lib/api";
import { SAMPLE_WALK_ID } from "@/lib/sampleWalk";
import { useServer } from "@/lib/server";
import { Button, Notice, StatusLine, buttonClass, formatWhen } from "@/components/ui";
import { usePolling } from "@/components/walks/usePolling";
import { WalkTokenForm } from "@/components/walks/WalkTokenForm";
import { WalkPhotos } from "./WalkPhotos";

const LIVE_REFRESH_MS = 3_000;
// A finished walk still gains photos queued on the phone, and their areas; just less often.
const SETTLED_REFRESH_MS = 10_000;

const h1Class = "text-3xl font-semibold tracking-tight text-ink";

function BackLink({ id }: { id: string }) {
  return (
    <Link
      href={`/walks/${encodeURIComponent(id)}`}
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-strong"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3 5 8l5 5" />
      </svg>
      Back to the walk
    </Link>
  );
}

function Shell({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <BackLink id={id} />
        <h1 className={h1Class}>{title}</h1>
      </header>
      {children}
    </div>
  );
}

type Problem = "token" | "missing" | "failed" | null;

function ServerWalkPhotos({ id }: { id: string }) {
  const { state: server, recoveries } = useServer();
  const [walk, setWalk] = useState<Walk | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        setWalk(await api.walk(id, signal));
        setProblem(null);
      } catch (err) {
        if (signal.aborted) return;
        // The banner says the server is unreachable; what is on screen stays.
        if (err instanceof ApiError && err.unreachable) return;
        if (err instanceof ApiError && err.needsToken) setProblem("token");
        else if (err instanceof ApiError && err.status === 404) setProblem("missing");
        else setProblem("failed");
      }
    },
    [id],
  );

  usePolling(load, {
    everyMs: walk?.settled ? SETTLED_REFRESH_MS : LIVE_REFRESH_MS,
    active: problem !== "token" && problem !== "missing",
    reloadKey: `${recoveries}:${reloads}`,
  });

  if (problem === "token") {
    return (
      <Shell id={id} title="Walk photos">
        <WalkTokenForm verify={() => api.walk(id)} onAccepted={() => setProblem(null)} />
      </Shell>
    );
  }

  if (problem === "missing") {
    return (
      <div className="space-y-6">
        <header className="space-y-3">
          <h1 className={h1Class}>Walk not found</h1>
          <p className="max-w-[62ch] text-base text-ink-2">
            There is no walk at this address. The link may be incomplete, or the walk may have been recorded to a
            different server.
          </p>
        </header>
        <Link href="/" className={buttonClass("secondary")}>
          All walks
        </Link>
      </div>
    );
  }

  const failed = problem === "failed" && (
    <Notice
      title={walk ? "The photos could not be refreshed." : "The walk could not be loaded."}
      action={
        <Button variant="secondary" onClick={() => setReloads((n) => n + 1)}>
          Try again
        </Button>
      }
    >
      The server answered, but not with the walk. Groundwork keeps trying every few seconds.
    </Notice>
  );

  if (!walk) {
    return (
      <Shell id={id} title="Walk photos">
        {failed ||
          (server === "offline" ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
              The photos appear here as soon as the server can be reached again.
            </p>
          ) : (
            <div className="space-y-3">
              <div aria-hidden className="skeleton h-7 w-48" />
              <div aria-hidden className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="skeleton h-32" />
                <div className="skeleton h-32" />
              </div>
              <StatusLine>Loading the walk.</StatusLine>
            </div>
          ))}
      </Shell>
    );
  }

  const when = formatWhen(walk.createdAt).replace(/^Today, /, "today ");
  return (
    <Shell id={id} title={`Walk, ${when}`}>
      {failed}
      {/* Anything changed here is fetched again at once, rather than at the next refresh. */}
      <WalkPhotos walk={walk} onChanged={() => setReloads((n) => n + 1)} />
    </Shell>
  );
}

export function WalkPhotosPage({ id }: { id: string }) {
  if (id === SAMPLE_WALK_ID) {
    return (
      <Shell id={id} title="Sample walk">
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          The sample walk has no photos. Photos belong to walks recorded on the phone, where they are taken in the Walk
          tab.
        </p>
      </Shell>
    );
  }
  return <ServerWalkPhotos key={id} id={id} />;
}
