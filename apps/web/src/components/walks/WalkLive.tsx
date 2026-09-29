"use client";

// One walk, filling in while the architect is still talking: whether it is live, what
// Groundwork has understood so far, and the walkthrough as text. /walks/sample plays a scripted
// walk through the same view, so the page can be shown without a phone recording.
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, api, type Walk } from "@/lib/api";
import { SAMPLE_SECONDS, SAMPLE_WALK_ID, sampleWalk } from "@/lib/sampleWalk";
import { useServer } from "@/lib/server";
import { SiteModelSkeleton, SiteModelView, summarizeSiteModel } from "@/components/SiteModelView";
import { Button, Notice, StatusLine, buttonClass, formatDuration, formatWhen } from "@/components/ui";
import { usePolling } from "./usePolling";
import { WalkRecordings } from "./WalkRecordings";
import { WalkTokenForm } from "./WalkTokenForm";
import { WalkTranscript, readableTranscript } from "./WalkTranscript";

const REFRESH_MS = 3_000;
const SAMPLE_STEP_MS = 500;

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** What changed between two versions of a walk that is worth saying out loud, if anything. */
function arrivals(before: Walk, after: Walk): string {
  const known = new Set((before.siteModel?.areas ?? []).map((a) => a.name.trim().toLowerCase()));
  const fresh = (after.siteModel?.areas ?? []).filter((a) => !known.has(a.name.trim().toLowerCase()));
  const said: string[] = [];
  if (fresh.length > 0) {
    said.push(`${fresh.length === 1 ? "New area" : "New areas"}: ${fresh.map((a) => sentence(a.name.trim())).join(", ")}.`);
  }
  if (after.settled && !before.settled) said.push("Walk finished.");
  return said.join(" ");
}

/** Holds the walk on screen and works out what to announce each time a newer version arrives. */
function useWalk() {
  const [walk, setWalk] = useState<Walk | null>(null);
  const [now, setNow] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const previous = useRef<Walk | null>(null);

  const accept = useCallback((next: Walk) => {
    const said = previous.current ? arrivals(previous.current, next) : "";
    previous.current = next;
    setWalk(next);
    setNow(Date.now());
    if (said) setAnnouncement(said);
  }, []);

  /** Start over with a walk that is not a newer version of the one on screen. */
  const restart = useCallback((first: Walk) => {
    previous.current = first;
    setWalk(first);
    setNow(Date.now());
    setAnnouncement("");
  }, []);

  return { walk, now, announcement, accept, restart, setNow };
}

function BackLink() {
  return (
    <Link
      href="/"
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
      All walks
    </Link>
  );
}

const h1Class = "text-3xl font-semibold tracking-tight text-ink";

/** Reserves the space of the walk view while the first answer is on its way. */
function WalkLoading({ title }: { title: string }) {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <BackLink />
        <h1 className={h1Class}>{title}</h1>
        <div aria-hidden className="skeleton h-8 w-72 max-w-full" />
        <StatusLine>Loading the walk.</StatusLine>
      </header>
      <div className="grid gap-10 lg:grid-cols-3 lg:gap-8">
        <div className="space-y-4 lg:col-span-2">
          <div aria-hidden className="skeleton h-7 w-64 max-w-full" />
          <SiteModelSkeleton />
        </div>
        <div aria-hidden className="space-y-3">
          <div className="skeleton h-7 w-40" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-4/5" />
        </div>
      </div>
    </div>
  );
}

/** The one row that says, from across a room, whether the walk is live and how far along it is. */
function StatusRow({ walk, now }: { walk: Walk; now: number }) {
  const live = walk.status === "active";
  const length = formatDuration(((walk.finishedAt ?? now) - walk.createdAt) / 1000);
  const { total, done, inFlight } = walk.counts;

  let word = "Finished";
  let detail = length;
  if (live) {
    word = "Live";
  } else if (!walk.settled) {
    word = "Finishing";
    detail =
      inFlight > 1
        ? "transcribing the last recordings"
        : inFlight === 1
          ? "transcribing the last recording"
          : "reading the whole walk";
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
      <p className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-tight text-ink">
        <span className="inline-flex items-center gap-2.5">
          {live && <span aria-hidden className="live-dot h-3 w-3 rounded-full bg-danger" />}
          {word}
        </span>
        <span className={`font-normal text-ink-2 ${live || walk.settled ? "tabular-nums" : "text-lg"}`}>{detail}</span>
      </p>
      <p className="text-lg tabular-nums text-ink-2">
        {total === 0
          ? live
            ? "No recordings yet"
            : "No recordings arrived"
          : `${done} of ${total} ${total === 1 ? "recording" : "recordings"} transcribed`}
      </p>
    </div>
  );
}

/** The server's reason for a failed recording, in words that mean something on site. */
function plainReason(error: string | null): string {
  const text = (error ?? "").toLowerCase();
  if (text.includes("restarted")) return "The server restarted before it had finished receiving the audio.";
  if (text.includes("still running")) return "Transcribing took longer than 20 minutes and was stopped.";
  if (text.startsWith("transcription")) return "The audio could not be turned into text.";
  return "The audio did not get through to be transcribed.";
}

function FailedRecordings({ walk }: { walk: Walk }) {
  const failed = walk.chunks.filter((c) => c.status === "failed");
  if (failed.length === 0) return null;
  const reasons = [...new Set(failed.map((c) => plainReason(c.error)))];
  return (
    <Notice
      title={`${failed.length} ${failed.length === 1 ? "recording" : "recordings"} could not be transcribed.`}
    >
      {reasons.join(" ")} The audio is still on the phone, under Files.
    </Notice>
  );
}

function SiteModelSection({ walk }: { walk: Walk }) {
  const model = walk.siteModel;
  return (
    <section aria-labelledby="understood" className="min-w-0 space-y-4 lg:col-span-2">
      <div className="space-y-1">
        <h2 id="understood" className="text-xl font-semibold tracking-tight text-ink">
          What Groundwork understood
        </h2>
        {model ? (
          <>
            <p className="text-base text-ink">{summarizeSiteModel(model)}</p>
            <p className="text-sm text-ink-2">
              {walk.siteModelPass === "final"
                ? "Final. Read from the whole walk."
                : "Draft. It is rebuilt each time a recording is transcribed."}
              {!walk.siteModelCurrent && !walk.settled && " A newer version is on its way."}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">
            {walk.settled
              ? "Nothing. The walk finished without enough transcribed speech to read."
              : "Waiting for the first recording to be transcribed."}
          </p>
        )}
      </div>

      {walk.siteModelError && (
        <Notice title="The last attempt to read the walk failed.">
          {model
            ? "The version shown is the previous one."
            : walk.settled
              ? "There is no earlier version to show."
              : "Groundwork tries again when the next recording is transcribed."}
        </Notice>
      )}

      {model ? (
        <SiteModelView model={model} stale={!walk.siteModelCurrent} />
      ) : (
        !walk.settled && <SiteModelSkeleton areas={2} />
      )}
    </section>
  );
}

function download(walk: Walk, sample: boolean) {
  const file = new Blob([JSON.stringify(walk, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = sample ? "sample-walk.json" : `walk-${new Date(walk.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function TranscriptSection({ walk, sample }: { walk: Walk; sample: boolean }) {
  const headingId = useId();
  // Read once: a walk that is over when the page opens is read from its first words.
  const [follow] = useState(!walk.settled);
  const [feedback, setFeedback] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(readableTranscript(walk.transcript));
      setFeedback("Walkthrough copied.");
    } catch {
      setFeedback("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
    >
      <h2 id={headingId} className="text-xl font-semibold tracking-tight text-ink">
        Walkthrough
      </h2>

      <WalkTranscript
        transcript={walk.transcript}
        follow={follow}
        labelledBy={headingId}
        empty={
          walk.settled
            ? "Nothing was transcribed on this walk."
            : walk.counts.total === 0
              ? "Nothing to read yet. The first recording arrives about a minute and a half into the walk, and its words follow within a minute."
              : "Nothing to read yet. The first recording is being transcribed."
        }
      />

      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          {walk.transcript && (
            <Button variant="secondary" onClick={copy}>
              Copy transcript
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => {
              download(walk, sample);
              setFeedback("Walk downloaded.");
            }}
          >
            Download JSON
          </Button>
        </div>
        <StatusLine>{feedback}</StatusLine>
      </div>

      <WalkRecordings recordings={walk.chunks} />
    </section>
  );
}

function WalkView({
  walk,
  now,
  announcement,
  sample = false,
  plays = 0,
  onPlayAgain,
  notice,
}: {
  walk: Walk;
  now: number;
  announcement: string;
  sample?: boolean;
  /** How many times the sample has been started again. */
  plays?: number;
  onPlayAgain?: () => void;
  notice?: React.ReactNode;
}) {
  const when = formatWhen(walk.createdAt).replace(/^Today, /, "today ");
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        {sample && (
          <Notice
            tone="neutral"
            title="Sample walk."
            action={
              <Button variant="secondary" onClick={onPlayAgain}>
                Play again
              </Button>
            }
          >
            A scripted example, not a real recording. It plays a seven minute walk in under a minute.
          </Notice>
        )}
        <BackLink />
        <h1 className={h1Class}>{sample ? "Sample walk" : `Walk, ${when}`}</h1>
        <StatusRow walk={walk} now={now} />
        <StatusLine>{announcement}</StatusLine>
      </header>

      {notice}
      <FailedRecordings walk={walk} />

      <div className="grid gap-10 lg:grid-cols-3 lg:items-start lg:gap-8">
        <SiteModelSection walk={walk} />
        {/* A fresh walkthrough for each play of the sample, so it starts at its first words again. */}
        <TranscriptSection key={plays} walk={walk} sample={sample} />
      </div>
    </div>
  );
}

function SampleWalk() {
  const { walk, now, announcement, accept, restart } = useWalk();
  const [plays, setPlays] = useState(0);

  useEffect(() => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function step() {
      const elapsed = (Date.now() - started) / 1000;
      accept(sampleWalk(elapsed));
      if (elapsed < SAMPLE_SECONDS) timer = setTimeout(step, SAMPLE_STEP_MS);
    }
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [plays, accept]);

  if (!walk) return <WalkLoading title="Sample walk" />;
  return (
    <WalkView
      walk={walk}
      now={now}
      announcement={announcement}
      sample
      plays={plays}
      onPlayAgain={() => {
        restart(sampleWalk(0));
        setPlays((n) => n + 1);
      }}
    />
  );
}

type Problem = "token" | "missing" | "failed" | null;

function ServerWalk({ id }: { id: string }) {
  const { state: server, recoveries } = useServer();
  const { walk, now, announcement, accept, setNow } = useWalk();
  const [problem, setProblem] = useState<Problem>(null);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        accept(await api.walk(id, signal));
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
    [id, accept],
  );

  usePolling(load, {
    everyMs: REFRESH_MS,
    active: problem !== "token" && problem !== "missing" && !walk?.settled,
    reloadKey: `${recoveries}:${reloads}`,
  });

  // The elapsed time of a live walk ticks between refreshes.
  const live = walk?.status === "active";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [live, setNow]);

  if (problem === "token") {
    return (
      <div className="space-y-6">
        <header className="space-y-3">
          <BackLink />
          <h1 className={h1Class}>Walk</h1>
        </header>
        <WalkTokenForm verify={() => api.walk(id)} onAccepted={() => setProblem(null)} />
      </div>
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
      title={walk ? "The walk could not be refreshed." : "The walk could not be loaded."}
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
    if (failed) {
      return (
        <div className="space-y-6">
          <header className="space-y-3">
            <BackLink />
            <h1 className={h1Class}>Walk</h1>
          </header>
          {failed}
        </div>
      );
    }
    if (server === "offline") {
      return (
        <div className="space-y-6">
          <header className="space-y-3">
            <BackLink />
            <h1 className={h1Class}>Walk</h1>
          </header>
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
            The walk appears here as soon as the server can be reached again.
          </p>
        </div>
      );
    }
    return <WalkLoading title="Walk" />;
  }

  return <WalkView walk={walk} now={now} announcement={announcement} notice={failed} />;
}

export function WalkLive({ id }: { id: string }) {
  if (id === SAMPLE_WALK_ID) return <SampleWalk />;
  return <ServerWalk key={id} id={id} />;
}
