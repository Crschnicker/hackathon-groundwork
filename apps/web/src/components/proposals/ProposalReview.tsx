"use client";

// The review step: the drafted proposal, open for the architect to check and change before it
// goes to the client. Who it is for, what they are told, each area's photos and priced lines,
// the small print. Edits save themselves; the totals and the "Before you send" checklist follow
// every keystroke. Sending turns on the client's link; the status then records how it went.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, type Proposal, type ProposalEdit, type ProposalStatus } from "@/lib/api";
import { useServer } from "@/lib/server";
import { Button, Notice, StatusLine, buttonClass, formatWhen, plural } from "@/components/ui";
import { usePolling } from "@/components/walks/usePolling";
import { WalkTokenForm } from "@/components/walks/WalkTokenForm";
import { CLIENT_EMAIL_FIELD, CLIENT_NAME_FIELD, ReviewChecklist, reviewOf } from "./ReviewChecklist";
import { NumberField } from "./NumberField";
import { SectionEditor } from "./SectionEditor";
import { SendPanel } from "./SendPanel";
import { StatusBadge } from "./StatusBadge";
import { StatusControl } from "./StatusControl";
import { formatMoney, proposalTotals } from "./totals";
import { saveWords, toRecord, useProposalDraft, type SaveState } from "./useProposalDraft";

/** How often the page asks whether the client has answered, and for newly arrived photos. */
const REFRESH_MS = 20_000;

const h1Class = "text-3xl font-semibold tracking-tight text-ink";
const cardClass = "space-y-4 rounded-lg border border-line bg-surface px-4 py-5 sm:px-6";
const labelClass = "block text-sm font-medium text-ink";

function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

function BackLinks({ walkId }: { walkId?: string }) {
  const link =
    "-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-brand underline underline-offset-4 hover:text-brand-strong";
  return (
    <nav aria-label="Back" className="flex flex-wrap gap-x-6">
      <Link href="/proposals" className={link}>
        <Chevron />
        All proposals
      </Link>
      {walkId && (
        <Link href={`/walks/${encodeURIComponent(walkId)}`} className={link}>
          The walk it came from
        </Link>
      )}
    </nav>
  );
}

// Loading ---------------------------------------------------------------------------------------

type Problem = "token" | "missing" | "failed" | null;

export function ProposalReview({ id }: { id: string }) {
  const { state: server, recoveries } = useServer();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.proposal(id, controller.signal).then(
      (p) => {
        setProposal(p);
        setProblem(null);
      },
      (err: unknown) => {
        if (controller.signal.aborted) return;
        // The banner says the server is unreachable; this loads again when it is back.
        if (err instanceof ApiError && err.unreachable) return;
        if (err instanceof ApiError && err.needsToken) setProblem("token");
        else if (err instanceof ApiError && err.status === 404) setProblem("missing");
        else setProblem("failed");
      },
    );
    return () => controller.abort();
  }, [id, recoveries, reloads]);

  if (proposal) return <ProposalEditor key={proposal.id} initial={proposal} />;

  if (problem === "token") {
    return (
      <div className="space-y-6">
        <header className="space-y-3">
          <BackLinks />
          <h1 className={h1Class}>Proposal</h1>
        </header>
        <WalkTokenForm verify={() => api.proposal(id)} onAccepted={() => setReloads((n) => n + 1)} />
      </div>
    );
  }

  if (problem === "missing") {
    return (
      <div className="space-y-6">
        <header className="space-y-3">
          <h1 className={h1Class}>Proposal not found</h1>
          <p className="max-w-[62ch] text-base text-ink-2">
            There is no proposal at this address. It may have been deleted, or the link may be incomplete.
          </p>
        </header>
        <Link href="/proposals" className={buttonClass("secondary")}>
          All proposals
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <BackLinks />
        <h1 className={h1Class}>Proposal</h1>
      </header>
      {problem === "failed" ? (
        <Notice
          title="The proposal could not be loaded."
          action={
            <Button variant="secondary" onClick={() => setReloads((n) => n + 1)}>
              Try again
            </Button>
          }
        >
          The server answered, but not with the proposal.
        </Notice>
      ) : server === "offline" ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          The proposal appears here as soon as the server can be reached again.
        </p>
      ) : (
        <div aria-hidden className="space-y-4">
          <StatusLine>Loading the proposal.</StatusLine>
          <div className="skeleton h-11 w-96 max-w-full" />
          <div className="skeleton h-11 w-80 max-w-full" />
          <div className="skeleton h-48 w-full" />
          <div className="skeleton h-72 w-full" />
        </div>
      )}
    </div>
  );
}

// Editing ---------------------------------------------------------------------------------------

function Card({ title, id, children, note }: { title: string; id: string; children: ReactNode; note?: string }) {
  return (
    <section aria-labelledby={id} className={cardClass}>
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {note && <p className="max-w-[62ch] text-sm text-ink-2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function saveTone(save: SaveState): string {
  if (save.kind === "invalid" || save.kind === "rejected" || save.kind === "token") return "text-danger";
  if (save.kind === "retrying") return "text-confirm";
  return "";
}

function ProposalEditor({ initial }: { initial: Proposal }) {
  const id = initial.id;
  const router = useRouter();
  const base = useId();
  const { recoveries } = useServer();
  const { edit, change, record, setRecord, save, saveNow, flush, close } = useProposalDraft(initial);
  const [deleting, setDeleting] = useState<"asking" | "busy" | null>(null);
  const [deleteProblem, setDeleteProblem] = useState("");

  const totals = useMemo(() => proposalTotals(edit), [edit]);
  const review = useMemo(() => reviewOf(edit, record.photos), [edit, record.photos]);

  // The client may accept while this page is open, and photos may still be arriving from the phone.
  const refresh = useCallback(
    async (signal: AbortSignal) => {
      try {
        setRecord(toRecord(await api.proposal(id, signal)));
      } catch {
        // The next refresh tries again; the save status says if something is really wrong.
      }
    },
    [id, setRecord],
  );
  usePolling(refresh, { everyMs: REFRESH_MS, active: true, reloadKey: recoveries });

  const set = <K extends keyof ProposalEdit>(key: K, value: ProposalEdit[K]) => change((e) => ({ ...e, [key]: value }));
  const setClient = (key: keyof ProposalEdit["client"], value: string) =>
    change((e) => ({ ...e, client: { ...e.client, [key]: value } }));

  async function setStatus(status: ProposalStatus) {
    // The client should see what is on screen, so edits reach the server before the link opens.
    if (status === "pending" && !(await flush())) {
      throw new Error("The latest changes could not be saved, so the status was not changed.");
    }
    setRecord(toRecord(await api.setProposalStatus(id, status)));
  }

  async function remove() {
    setDeleting("busy");
    setDeleteProblem("");
    try {
      await api.deleteProposal(id);
      close();
      router.push("/proposals");
    } catch (err) {
      setDeleting("asking");
      setDeleteProblem(err instanceof Error ? err.message : "The proposal could not be deleted.");
    }
  }

  const taxPercent = edit.taxRate === null ? null : Math.round(edit.taxRate * 100_000) / 1_000;
  const words = saveWords(save);

  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <BackLinks walkId={record.walkId} />
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="flex items-center gap-3 text-sm text-ink-2">
              <StatusBadge status={record.status} />
              <span>Drafted {formatWhen(record.createdAt).replace(/^Today, /, "today, ")}</span>
            </p>
            {deleting === null && (
              <Button variant="quiet" onClick={() => setDeleting("asking")} className="px-1 text-ink-2!">
                Delete proposal
              </Button>
            )}
          </div>
          <h1 className="sr-only">{edit.title.trim() || "Untitled proposal"}</h1>
          <label htmlFor={`${base}-title`} className="sr-only">
            Title
          </label>
          <input
            id={`${base}-title`}
            type="text"
            value={edit.title}
            maxLength={200}
            placeholder="Title of the proposal"
            onChange={(e) => set("title", e.target.value)}
            aria-invalid={!edit.title.trim() || undefined}
            className="control min-h-14! text-2xl! font-semibold tracking-tight sm:text-3xl!"
          />
        </div>

        {deleting !== null && (
          <div role="alertdialog" aria-labelledby={`${base}-delete`} className="space-y-3 rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger">
            <p>
              <span id={`${base}-delete`} className="font-semibold">
                Delete this proposal?
              </span>{" "}
              {record.status === "draft" ? "" : "The client's link stops working. "}The walk and its photos stay as they are.
            </p>
            {deleteProblem && <p role="alert">{deleteProblem}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={remove} busy={deleting === "busy"} autoFocus className="bg-danger! hover:opacity-90">
                Delete proposal
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Keep it
              </Button>
            </div>
          </div>
        )}

        <StatusControl record={record} onChange={setStatus} />
      </header>

      {save.kind === "token" && (
        <div className="space-y-3">
          <Notice title="Your changes are not saved.">The server wants the walk token again. Once it is in, they save.</Notice>
          <WalkTokenForm verify={() => api.proposal(id)} onAccepted={() => void saveNow()} />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="min-w-0 space-y-8">
          <Card title="Client" id={`${base}-client`} note="Who the proposal is for. The name and address are shown on it; the email is where you send it.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor={CLIENT_NAME_FIELD} className={labelClass}>
                  Name
                </label>
                <input
                  id={CLIENT_NAME_FIELD}
                  type="text"
                  autoComplete="off"
                  value={edit.client.name}
                  maxLength={200}
                  onChange={(e) => setClient("name", e.target.value)}
                  className="control"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={CLIENT_EMAIL_FIELD} className={labelClass}>
                  Email
                </label>
                <input
                  id={CLIENT_EMAIL_FIELD}
                  type="email"
                  autoComplete="off"
                  inputMode="email"
                  value={edit.client.email}
                  maxLength={200}
                  onChange={(e) => setClient("email", e.target.value)}
                  className="control"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label htmlFor={`${base}-address`} className={labelClass}>
                  Address
                </label>
                <input
                  id={`${base}-address`}
                  type="text"
                  autoComplete="off"
                  value={edit.client.address}
                  maxLength={400}
                  onChange={(e) => setClient("address", e.target.value)}
                  className="control"
                />
              </div>
            </div>
          </Card>

          <Card title="Opening" id={`${base}-intro`} note="The first thing the client reads. Plain words, no prices.">
            <label htmlFor={`${base}-intro-text`} className="sr-only">
              Opening paragraph
            </label>
            <textarea
              id={`${base}-intro-text`}
              value={edit.intro}
              maxLength={5000}
              rows={5}
              onChange={(e) => set("intro", e.target.value)}
              className="control resize-y"
            />
          </Card>

          <section aria-labelledby={`${base}-areas`} className="space-y-4">
            <div className="space-y-1">
              <h2 id={`${base}-areas`} className="text-xl font-semibold tracking-tight text-ink">
                Areas
              </h2>
              <p className="max-w-[62ch] text-sm text-ink-2">
                One section per area of the walk. The client sees each summary, its photos and its lines with their
                amounts. Notes in amber and the grey working under each line are for you only.
              </p>
            </div>
            {edit.sections.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
                The walk had no areas to price.
              </p>
            ) : (
              edit.sections.map((section) => (
                <SectionEditor
                  key={section.id}
                  section={section}
                  walkId={record.walkId}
                  photos={record.photos}
                  subtotal={totals.sections[section.id] ?? 0}
                  onChange={(next) => change((e) => ({ ...e, sections: e.sections.map((s) => (s.id === next.id ? next : s)) }))}
                />
              ))
            )}
          </section>

          <Card title="Terms and tax" id={`${base}-terms`}>
            <div className="space-y-1.5">
              <label htmlFor={`${base}-terms-text`} className={labelClass}>
                Terms
              </label>
              <p id={`${base}-terms-help`} className="text-sm text-ink-2">
                Shown last: how long the price holds, payments, what is not included.
              </p>
              <textarea
                id={`${base}-terms-text`}
                aria-describedby={`${base}-terms-help`}
                value={edit.terms}
                maxLength={5000}
                rows={5}
                onChange={(e) => set("terms", e.target.value)}
                className="control resize-y"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${base}-tax`} className={labelClass}>
                Sales tax on materials (%)
              </label>
              <p id={`${base}-tax-help`} className="text-sm text-ink-2">
                Leave it empty for no tax line. Labor is not taxed.
              </p>
              <NumberField
                id={`${base}-tax`}
                value={taxPercent}
                max={20}
                describedBy={`${base}-tax-help`}
                onChange={(n) => set("taxRate", n === null ? null : Math.round(n * 1_000) / 100_000)}
                className="max-w-32"
              />
            </div>
          </Card>

          {/* On a narrow screen the totals are at the end of the page, so the total and the save status ride along the bottom. */}
          <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-4 border-t border-line bg-page/95 px-4 py-2 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:hidden">
            <p className="text-sm font-semibold tabular-nums text-ink">Total {formatMoney(totals.total)}</p>
            <StatusLine className={`text-right text-xs ${saveTone(save)}`}>{words}</StatusLine>
          </div>
        </div>

        <aside aria-label="Totals and sending" className="min-w-0 space-y-6 lg:sticky lg:top-5 lg:-m-1 lg:max-h-[calc(100dvh-2.5rem)] lg:overflow-y-auto lg:p-1">
          <section aria-labelledby={`${base}-totals`} className="space-y-3 rounded-lg border border-line bg-surface px-4 py-4">
            <h2 id={`${base}-totals`} className="text-lg font-semibold tracking-tight text-ink">
              Totals
            </h2>
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ["Materials", totals.materials],
                  ["Labor", totals.labor],
                  ["Other", totals.other],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 text-ink-2">
                  <dt>{label}</dt>
                  <dd className="tabular-nums">{formatMoney(value)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 text-ink-2">
                <dt>{edit.taxRate === null ? "Tax" : `Tax (${taxPercent}% of materials)`}</dt>
                <dd className="tabular-nums">{edit.taxRate === null ? "None" : formatMoney(totals.tax)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-semibold text-ink">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatMoney(totals.total)}</dd>
              </div>
            </dl>
            {totals.unpriced > 0 && (
              <p className="text-xs text-confirm">
                {plural(totals.unpriced, "line")} not priced {totals.unpriced === 1 ? "is" : "are"} left out of the total.
              </p>
            )}
            <StatusLine className={`hidden text-xs lg:block ${saveTone(save)}`}>{words}</StatusLine>
          </section>

          <section aria-labelledby={`${base}-review`} className="space-y-4 rounded-lg border border-line bg-surface px-4 py-4">
            <div className="space-y-1">
              <h2 id={`${base}-review`} className="text-lg font-semibold tracking-tight text-ink">
                {record.status === "draft" ? "Before you send" : "Sharing"}
              </h2>
              {record.status !== "draft" && (
                <p className="text-xs text-ink-2">Changes save to the client&rsquo;s page as you make them.</p>
              )}
            </div>
            {record.status === "draft" && (
              <ReviewChecklist
                review={review}
                openQuestions={edit.openQuestions}
                onQuestionDealtWith={(index) =>
                  change((e) => ({ ...e, openQuestions: e.openQuestions.filter((_, i) => i !== index) }))
                }
              />
            )}
            <SendPanel record={record} edit={edit} blocking={review.blocking} onSend={() => setStatus("pending")} />
          </section>
        </aside>
      </div>
    </div>
  );
}
