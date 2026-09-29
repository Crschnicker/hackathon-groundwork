"use client";

// The walkthrough box: the architect types or pastes what was said on site and Groundwork
// reads it into a site model. Answers to open questions are written back into the text, so
// the walkthrough stays the one source the site model is read from.
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type OpenQuestion, type Provider, type ProviderName, type SiteModelResult } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, StatusLine, formatDuration, plural } from "@/components/ui";
import { SiteModelSkeleton, SiteModelView, summarizeSiteModel } from "@/components/SiteModelView";
import {
  MIN_WALKTHROUGH_LENGTH,
  SAMPLE_WALKTHROUGH,
  appendAnswer,
  loadSaved,
  save,
  siteModelToText,
} from "@/components/walkthrough/siteModelText";

const SLOW_AFTER_MS = 20_000;

interface Failure {
  /** What went wrong, for the architect. */
  message: string;
  /** What the server said, for whoever runs it. */
  detail: string | null;
}

function explain(err: unknown): Failure {
  const detail = err instanceof Error && err.message ? err.message : null;
  if (!(err instanceof ApiError)) {
    return { message: "Something went wrong while reading. Your walkthrough is still here.", detail };
  }
  const details = Array.isArray(err.details) ? ` ${JSON.stringify(err.details)}` : "";
  const full = `${err.status}: ${err.message}${details}`;
  if (err.status === 400) {
    return { message: "The text could not be read as it is. Check that it is at least a sentence long.", detail: full };
  }
  if (err.status === 429) {
    return { message: "The language model is busy right now. Wait a moment, then try again.", detail: full };
  }
  if (err.status === 503) {
    return { message: "The language model that was chosen is not set up on this server.", detail: full };
  }
  if (err.status === 502 || err.status === 504) {
    return {
      message: "The language model did not give an answer Groundwork could use. This usually passes on a second try.",
      detail: full,
    };
  }
  return { message: "Something went wrong while reading. Your walkthrough is still here.", detail: full };
}

/** For browsers that refuse the clipboard API: copy from a selected, off-screen text box. */
function copyBySelection(plain: string): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const box = document.createElement("textarea");
  box.value = plain;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.top = "0";
  box.style.left = "-9999px";
  document.body.appendChild(box);
  box.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  box.remove();
  active?.focus({ preventScroll: true });
  return copied;
}

function Chevron() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

const summaryClass =
  "inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded text-sm font-medium text-ink-2 " +
  "hover:text-ink [&::-webkit-details-marker]:hidden";

export function WalkthroughTry() {
  const server = useServer();
  const id = useId();

  const [text, setText] = useState(SAMPLE_WALKTHROUGH);
  const [result, setResult] = useState<SiteModelResult | null>(null);
  const [answers, setAnswers] = useState(0);
  const [restored, setRestored] = useState(false);

  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providersFailed, setProvidersFailed] = useState(false);
  const [providersAttempt, setProvidersAttempt] = useState(0);
  const [choice, setChoice] = useState<ProviderName | "">("");

  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [status, setStatus] = useState("");
  // Goes up when a read lands or fails, so the page can move to what changed once it is drawn.
  const [landed, setLanded] = useState({ count: 0, ok: true });

  const request = useRef<AbortController | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const focusPrimary = () => document.getElementById(`${id}-read`)?.focus({ preventScroll: true });
  const heading = useRef<HTMLHeadingElement>(null);
  const failureBox = useRef<HTMLDivElement>(null);

  // Restored after mount, so the first render matches what the server sent.
  useEffect(() => {
    const saved = loadSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage can only be read after mount
    setRestored(true);
    if (!saved) return;
    setText(saved.text);
    setResult(saved.result);
    setAnswers(saved.answers);
  }, []);

  useEffect(() => {
    if (restored) save({ text, result, answers });
  }, [restored, text, result, answers]);

  useEffect(() => {
    let ignore = false;
    api
      .providers()
      .then((r) => {
        if (ignore) return;
        setProviders(r.providers);
        setProvidersFailed(false);
      })
      .catch((err) => {
        // Unreachable is covered by the banner; the list reloads when the server is back.
        if (!ignore && !(err instanceof ApiError && err.unreachable)) setProvidersFailed(true);
      });
    return () => {
      ignore = true;
    };
  }, [server.recoveries, providersAttempt]);

  // Leaving the page stops a read that is still in flight.
  useEffect(
    () => () => {
      request.current?.abort();
      clearTimeout(slowTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (landed.count === 0) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const target = landed.ok ? heading.current : (failureBox.current ?? heading.current);
    target?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
    if (landed.ok) heading.current?.focus({ preventScroll: true });
  }, [landed]);

  const noModel = providers !== null && !providers.some((p) => p.configured);
  // A choice that is no longer set up falls back to automatic.
  const provider = choice && providers?.some((p) => p.name === choice && p.configured) ? choice : "";

  const blocked =
    text.trim().length < MIN_WALKTHROUGH_LENGTH
      ? "Add at least a sentence for Groundwork to read."
      : server.state === "offline"
        ? "Waiting for the server."
        : noModel
          ? "No language model is set up on this server."
          : null;

  async function read() {
    if (reading || blocked) return;
    const controller = new AbortController();
    request.current = controller;
    const answersSent = answers;

    setReading(true);
    setFailure(null);
    setStatus("Reading the walkthrough. This usually takes about 15 seconds.");
    clearTimeout(slowTimer.current);
    slowTimer.current = setTimeout(
      () => setStatus("Still reading. Longer walkthroughs take longer."),
      SLOW_AFTER_MS,
    );

    try {
      const next = await api.extractSiteModel(text.trim(), provider || undefined, controller.signal);
      if (controller.signal.aborted) return;
      setResult(next);
      setAnswers((n) => Math.max(0, n - answersSent));
      setStatus(summarizeSiteModel(next.siteModel));
      setLanded((l) => ({ count: l.count + 1, ok: true }));
    } catch (err) {
      // Cancelled: cancel() has already said so.
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.unreachable) {
        // The banner says the server is unreachable; this only says what happened to the read.
        setStatus("Not read, because the server could not be reached. Your walkthrough is still here.");
        return;
      }
      setFailure(explain(err));
      setStatus("");
      setLanded((l) => ({ count: l.count + 1, ok: false }));
    } finally {
      if (request.current === controller) {
        clearTimeout(slowTimer.current);
        request.current = null;
        setReading(false);
      }
    }
  }

  function cancel() {
    request.current?.abort();
    request.current = null;
    clearTimeout(slowTimer.current);
    setReading(false);
    setStatus(result ? "Stopped reading. The earlier result is unchanged." : "Stopped reading.");
    // The Cancel button is about to go; focus returns to the button that started the read.
    focusPrimary();
  }

  function useSample() {
    setText(SAMPLE_WALKTHROUGH);
    setAnswers(0);
    setStatus("The sample walkthrough is back in the box.");
    textarea.current?.focus();
  }

  function answer(question: OpenQuestion, said: string) {
    // The answer form closes once this returns; focus goes back to the question's Answer button.
    const item = document.activeElement?.closest("li") ?? null;
    const total = answers + 1;
    setText((current) => appendAnswer(current, question, said));
    setAnswers(total);
    setStatus(`Answer added to the walkthrough. Read again to bring ${total === 1 ? "it" : "them"} into the site model.`);
    requestAnimationFrame(() => {
      const back = item?.isConnected ? item.querySelector<HTMLButtonElement>("button") : null;
      if (back) back.focus({ preventScroll: true });
      else focusPrimary();
    });
  }

  async function copyText() {
    if (!result) return;
    const plain = siteModelToText(result.siteModel);
    try {
      await navigator.clipboard.writeText(plain);
      setStatus("Copied.");
    } catch {
      setStatus(copyBySelection(plain) ? "Copied." : "The browser did not allow copying. Use Download JSON instead.");
    }
  }

  function retry() {
    // The notice holding "Try again" goes away while reading; focus waits on the primary button.
    focusPrimary();
    read();
  }

  function downloadJson() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result.siteModel, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "site-model.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Downloaded site-model.json.");
  }

  const hint = blocked ?? (answers > 0 ? `${plural(answers, "answer")} added since the last read.` : null);
  const readLabel = reading
    ? "Reading…"
    : answers > 0 && !blocked
      ? `Read again with ${plural(answers, "answer")}`
      : "Read the walkthrough";

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        {noModel && (
          <Notice
            tone="neutral"
            action={
              <details className="group basis-full">
                <summary className={summaryClass}>
                  <Chevron />
                  For whoever runs the server
                </summary>
                <p className="pb-2 text-sm text-ink-2">
                  Add <code className="font-mono text-xs text-ink">OPENROUTER_API_KEY</code> or{" "}
                  <code className="font-mono text-xs text-ink">CRUSOE_API_KEY</code> to the{" "}
                  <code className="font-mono text-xs text-ink">.env</code> file, then restart the API.
                </p>
              </details>
            }
          >
            No language model is set up on this server, so walkthroughs can&rsquo;t be read yet.
          </Notice>
        )}

        <div>
          <div className="flex min-h-11 flex-wrap items-end justify-between gap-x-4">
            <label htmlFor={`${id}-text`} className="pb-2 text-sm font-medium text-ink">
              What was said on site
            </label>
            {text !== SAMPLE_WALKTHROUGH && (
              <Button variant="quiet" onClick={useSample} className="-mr-4">
                Use the sample
              </Button>
            )}
          </div>
          <textarea
            ref={textarea}
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="control block resize-y leading-relaxed"
          />
        </div>

        <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            id={`${id}-read`}
            busy={reading}
            disabled={!reading && blocked !== null}
            aria-describedby={hint ? `${id}-hint` : undefined}
            onClick={read}
          >
            {readLabel}
          </Button>
          {reading && (
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          )}
          {hint && (
            <p id={`${id}-hint`} className="text-sm text-ink-2">
              {hint}
            </p>
          )}
        </div>

        <StatusLine>{status}</StatusLine>

        <details className="group border-t border-line">
          <summary className={summaryClass}>
            <Chevron />
            Model settings
          </summary>
          <div className="max-w-md space-y-2 pb-2">
            <label htmlFor={`${id}-model`} className="block text-sm font-medium text-ink">
              Language model
            </label>
            <select
              id={`${id}-model`}
              value={provider}
              onChange={(e) => setChoice(e.target.value as ProviderName | "")}
              className="control"
            >
              <option value="">Automatic</option>
              {providers?.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.configured}>
                  {p.label}
                  {p.configured ? ` (${p.defaultModel})` : " (not set up)"}
                </option>
              ))}
            </select>
            <p className="text-sm text-ink-2">
              Automatic uses the first model that is set up, and moves to the next one if it does not answer.
            </p>
            {providersFailed && (
              <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
                The list of models could not be loaded.
                <Button variant="quiet" className="px-0" onClick={() => setProvidersAttempt((n) => n + 1)}>
                  Load it again
                </Button>
              </p>
            )}
            {result && (
              <p className="text-sm text-ink-2">
                The result on screen was read by <span className="text-ink">{result.meta.model}</span> in{" "}
                <span className="tabular-nums">{formatDuration(result.meta.latencyMs / 1000)}</span>.
              </p>
            )}
          </div>
        </details>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <h3 ref={heading} tabIndex={-1} className="scroll-mt-4 text-lg font-semibold tracking-tight text-ink">
            What Groundwork understood
          </h3>
          {result && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={copyText}>
                Copy as text
              </Button>
              <Button variant="secondary" onClick={downloadJson}>
                Download JSON
              </Button>
            </div>
          )}
        </div>

        {failure && (
          <div ref={failureBox} className="scroll-mt-4">
            <Notice
              tone="danger"
              title="The walkthrough was not read."
              action={
                <>
                  <Button variant="secondary" onClick={retry}>
                    Try again
                  </Button>
                  {failure.detail && (
                    <details className="group basis-full">
                      <summary className={`${summaryClass} text-danger hover:text-danger`}>
                        <Chevron />
                        Detail for a developer
                      </summary>
                      <p className="break-words pb-2 font-mono text-xs text-ink-2">{failure.detail}</p>
                    </details>
                  )}
                </>
              }
            >
              {failure.message}
            </Notice>
          </div>
        )}

        {result ? (
          <SiteModelView model={result.siteModel} stale={reading} onAnswer={answer} />
        ) : reading ? (
          <SiteModelSkeleton />
        ) : (
          <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
            Nothing read yet. Choose &ldquo;Read the walkthrough&rdquo; and the areas, their measurements and what is
            still to confirm appear here.
          </p>
        )}
      </div>
    </div>
  );
}
