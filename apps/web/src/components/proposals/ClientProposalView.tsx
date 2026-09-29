"use client";

// The proposal as the client sees it from their link: what will be done in each part of the
// garden, with photos, what it costs, the terms, and a way to accept it. Written for a homeowner:
// no part numbers, no notes to the architect. Prints cleanly for anyone who wants it on paper.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, api, clientPhotoUrl, type ClientProposal } from "@/lib/api";
import { Mark } from "@/components/SiteHeader";
import { Button, Notice } from "@/components/ui";
import { usePolling } from "@/components/walks/usePolling";
import { formatMoney } from "./totals";

const REFRESH_MS = 60_000;

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "failed"; message: string }
  | { state: "ready"; proposal: ClientProposal };

type Section = ClientProposal["sections"][number];
type Line = Section["lines"][number];

/** "September 29, 2026". */
const formatDate = (epochMs: number) =>
  new Date(epochMs).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "120 sq ft", "3", "1.5 hr". */
function quantityText(line: Line): string {
  if (line.quantity === null) return "";
  const n = line.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return line.unit ? `${n} ${line.unit}` : n;
}

/** "8.25%" for a tax rate kept as a fraction. */
const percent = (rate: number) => `${(rate * 100).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;

/** Text the architect wrote with blank lines between paragraphs. */
function Paragraphs({ text, className = "" }: { text: string; className?: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={`space-y-3 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

function AreaSection({ token, section }: { token: string; section: Section }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4 break-inside-avoid-page">
      <div className="space-y-2">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-ink">
          {sentence(section.area)}
        </h2>
        {section.summary && <Paragraphs text={section.summary} className="max-w-[68ch] text-base text-ink-2" />}
      </div>

      {section.photos.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {section.photos.map((photo) => (
            <figure key={photo.id} className="space-y-1.5 break-inside-avoid">
              {/* The share token in the URL is the key, so a plain <img> can load it; next/image would proxy it. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={clientPhotoUrl(token, photo.id)}
                alt={photo.caption ?? `Photo of the ${section.area}`}
                loading="lazy"
                decoding="async"
                className="aspect-[4/3] w-full rounded-md bg-sunken object-cover"
              />
              {photo.caption && <figcaption className="text-xs text-ink-2">{photo.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {section.lines.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Work and materials for the {section.area}</caption>
            <thead className="bg-sunken text-left text-xs text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium sm:px-4">
                  Item
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">
                  Quantity
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {section.lines.map((line) => (
                <tr key={line.id} className="break-inside-avoid align-top">
                  <td className="px-3 py-2.5 text-ink sm:px-4">{line.description}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-2 sm:px-4">
                    {quantityText(line)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums sm:px-4">
                    {line.amount === null ? (
                      <span className="text-ink-3">To be confirmed</span>
                    ) : (
                      <span className="text-ink">{formatMoney(line.amount)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line-strong">
              <tr>
                <th scope="row" colSpan={2} className="px-3 py-2.5 text-left font-medium text-ink sm:px-4">
                  Subtotal
                </th>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-ink sm:px-4">
                  {formatMoney(section.subtotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

function Totals({ proposal }: { proposal: ClientProposal }) {
  const { totals, taxRate } = proposal;
  const unconfirmed = proposal.sections.some((s) => s.lines.some((l) => l.amount === null));
  return (
    <section aria-labelledby="total" className="space-y-3 break-inside-avoid">
      <h2 id="total" className="text-xl font-semibold tracking-tight text-ink">
        Total
      </h2>
      <dl className="divide-y divide-line rounded-lg border border-line bg-surface text-sm sm:max-w-md">
        <div className="flex justify-between gap-4 px-4 py-2.5">
          <dt className="text-ink-2">Subtotal</dt>
          <dd className="tabular-nums text-ink">{formatMoney(totals.subtotal)}</dd>
        </div>
        {taxRate !== null && taxRate > 0 && (
          <div className="flex justify-between gap-4 px-4 py-2.5">
            <dt className="text-ink-2">Sales tax on materials ({percent(taxRate)})</dt>
            <dd className="tabular-nums text-ink">{formatMoney(totals.tax)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 px-4 py-3">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="text-lg font-semibold tabular-nums text-ink">{formatMoney(totals.total)}</dd>
        </div>
      </dl>
      {unconfirmed && (
        <p className="max-w-[68ch] text-sm text-ink-2">
          Items marked to be confirmed are not in the total yet. They will be priced with you before any work on
          them starts.
        </p>
      )}
    </section>
  );
}

/** Where the proposal stands once it is decided; after accepting here, a thank-you as well. */
function Standing({ proposal, thanked = false }: { proposal: ClientProposal; thanked?: boolean }) {
  // The thank-you replaces the form the client just used, so it takes the keyboard focus with it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thanked) box.current?.focus();
  }, [thanked]);

  if (proposal.status === "won") {
    const date = proposal.decidedAt ? ` on ${formatDate(proposal.decidedAt)}` : "";
    const who = proposal.decidedBy === "client" && proposal.acceptedName ? ` by ${proposal.acceptedName}` : "";
    return (
      <div
        ref={box}
        tabIndex={-1}
        className="settle space-y-1 rounded-lg border border-brand bg-brand-soft px-4 py-4 sm:px-6"
      >
        {thanked && <p className="text-base font-semibold text-brand">Thank you. Your acceptance has been sent.</p>}
        <p className="text-sm text-ink">
          Accepted{who}
          {date}.
        </p>
        {thanked && <p className="text-sm text-ink-2">You will hear back about the next steps and scheduling.</p>}
      </div>
    );
  }
  if (proposal.status === "lost") {
    return (
      <p className="rounded-lg border border-line bg-sunken px-4 py-4 text-sm text-ink-2 sm:px-6">
        This proposal is no longer open.
      </p>
    );
  }
  return null;
}

/** The client accepts by typing their name. Only offered while the proposal is pending. */
function AcceptForm({ token, onAnswer }: { token: string; onAnswer: (next: ClientProposal, accepted: boolean) => void }) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setProblem("Type your name first.");
      field.current?.focus();
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      onAnswer(await api.acceptProposal(token, name.trim()), true);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 409) {
        // Decided in the meantime: show where it stands now.
        try {
          const now = await api.clientProposal(token);
          if (now.status === "pending") setProblem(err.message);
          onAnswer(now, false);
        } catch {
          setProblem(err.message);
        }
      } else if (err instanceof ApiError && err.unreachable) {
        setProblem("The server could not be reached, so nothing was sent. Check your connection and try again.");
      } else {
        setProblem(err instanceof ApiError ? err.message : "The acceptance could not be sent. Try again.");
      }
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby={`${id}-heading`}
      className="space-y-4 rounded-lg border border-line bg-surface px-4 py-5 print:hidden sm:px-6"
    >
      <div className="space-y-1">
        <h2 id={`${id}-heading`} className="text-xl font-semibold tracking-tight text-ink">
          Accept this proposal
        </h2>
        <p className="max-w-[62ch] text-sm text-ink-2">
          Type your name and press Accept proposal. That tells us to go ahead; you will hear back about the next
          steps and scheduling.
        </p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          Your name
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={field}
            id={id}
            type="text"
            autoComplete="name"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-problem`}
            className="control flex-1"
          />
          <Button type="submit" busy={busy} className="shrink-0">
            {busy ? "Sending" : "Accept proposal"}
          </Button>
        </div>
        <p id={`${id}-problem`} role="alert" className="min-h-5 text-sm text-danger">
          {problem}
        </p>
      </div>
    </form>
  );
}

export function ClientProposalView({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Accepted from this page just now: the thank-you takes the place of the form.
  const [thanked, setThanked] = useState(false);

  const fetchProposal = useCallback(
    async (signal: AbortSignal) => {
      try {
        const proposal = await api.clientProposal(token, signal);
        setLoad({ state: "ready", proposal });
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setLoad({ state: "missing" });
          return;
        }
        const message =
          err instanceof ApiError && err.unreachable
            ? "The proposal could not be reached. Check your connection and try again."
            : "The proposal could not be loaded. Try again in a moment.";
        // A later refresh that fails leaves the proposal on screen.
        setLoad((current) => (current.state === "ready" ? current : { state: "failed", message }));
      }
    },
    [token],
  );

  // Loads once, then looks again now and then while the proposal is open, so a proposal the
  // architect closes in the meantime stops offering the accept form.
  const open = load.state === "loading" || load.state === "failed" || (load.state === "ready" && load.proposal.status === "pending");
  usePolling(fetchProposal, { everyMs: REFRESH_MS, active: open, reloadKey: attempt });

  let body;
  if (load.state === "loading") {
    body = (
      <div aria-busy aria-label="Loading the proposal" className="space-y-6">
        <div className="skeleton h-9 w-3/4" />
        <div className="skeleton h-5 w-1/2" />
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  } else if (load.state === "missing") {
    body = (
      <div className="space-y-2 rounded-lg border border-line bg-surface px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">This proposal link is not valid.</h1>
        <p className="max-w-[62ch] text-sm text-ink-2">
          Check that the whole link was copied from the email. If it still does not open, ask for a new link.
        </p>
      </div>
    );
  } else if (load.state === "failed") {
    body = (
      <Notice
        title="Something went wrong."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setLoad({ state: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        }
      >
        {load.message}
      </Notice>
    );
  } else {
    const p = load.proposal;
    const preparedFor = [p.client.name.trim(), p.client.address.trim()].filter(Boolean).join(", ");
    body = (
      <article className="space-y-12">
        <header className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-3xl font-semibold tracking-tight text-ink">{p.title || "Proposal"}</h1>
            <Button variant="secondary" onClick={() => window.print()} className="shrink-0 print:hidden">
              Print
            </Button>
          </div>
          <div className="space-y-0.5 text-sm text-ink-2">
            {preparedFor && <p>Prepared for {preparedFor}</p>}
            {p.sentAt && <p>Sent {formatDate(p.sentAt)}</p>}
          </div>
          {p.status !== "pending" && !thanked && <Standing proposal={p} />}
          {p.intro && <Paragraphs text={p.intro} className="max-w-[68ch] text-base text-ink" />}
        </header>

        {p.sections.map((section) => (
          <AreaSection key={section.id} token={token} section={section} />
        ))}

        <Totals proposal={p} />

        {p.terms.trim() && (
          <section aria-labelledby="terms" className="space-y-3 break-inside-avoid">
            <h2 id="terms" className="text-xl font-semibold tracking-tight text-ink">
              Terms
            </h2>
            <Paragraphs text={p.terms} className="max-w-[68ch] text-sm text-ink-2" />
          </section>
        )}

        {thanked ? (
          <Standing proposal={p} thanked />
        ) : (
          p.status === "pending" && (
            <AcceptForm
              token={token}
              onAnswer={(next, accepted) => {
                setThanked(accepted && next.status === "won");
                setLoad({ state: "ready", proposal: next });
              }}
            />
          )
        )}
      </article>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6 print:px-0 print:pt-0">
      <div className="mb-8 flex items-center gap-2 text-sm font-medium text-ink-3 print:mb-4">
        <Mark className="h-6 w-6" />
        Proposal
      </div>
      {body}
    </div>
  );
}
