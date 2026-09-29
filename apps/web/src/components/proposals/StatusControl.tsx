"use client";

// Where the proposal stands: draft, pending (sent, waiting on the client), won or lost. Any step
// may be taken from any other, since real jobs go back and forth. The ones that tell the client
// something (won, lost) or take their link away (back to draft) ask first.
import { useId, useState } from "react";
import type { ProposalStatus } from "@/lib/api";
import { Button } from "@/components/ui";
import type { ProposalRecord } from "./useProposalDraft";
import { statusLabels } from "./StatusBadge";

const ORDER: ProposalStatus[] = ["draft", "pending", "won", "lost"];

/** "today", "on 12 Sep". */
function day(ms: number): string {
  const date = new Date(ms);
  if (date.toDateString() === new Date().toDateString()) return "today";
  return `on ${date.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;
}

/** What the current status means, with the dates that go with it. */
function explain(record: ProposalRecord): string {
  const sent = record.sentAt ? ` Sent ${day(record.sentAt)}.` : "";
  const decided = record.decidedAt ? day(record.decidedAt) : null;
  switch (record.status) {
    case "draft":
      return `Being reviewed. The client's link does not work yet.${record.sentAt ? " It was sent before; it works again once marked as sent." : ""}`;
    case "pending":
      return `Waiting for the client's answer. They can accept it from their link.${sent}`;
    case "won":
      if (record.decidedBy === "client") {
        return `Accepted by ${record.acceptedName ?? "the client"}${decided ? ` ${decided}` : ""}, from their link.`;
      }
      return `Marked as won${decided ? ` ${decided}` : ""}. The client's link shows it as accepted.`;
    case "lost":
      return `Marked as lost${decided ? ` ${decided}` : ""}. The client's link says it is no longer open.`;
  }
}

/** The question asked before a step that changes what the client sees, or null to go ahead. */
function question(from: ProposalStatus, to: ProposalStatus): { title: string; body: string } | null {
  if (to === "won") {
    return {
      title: "Mark this proposal as won?",
      body: "Do this when the client has said yes some other way. Their link will show it as accepted.",
    };
  }
  if (to === "lost") {
    return {
      title: "Mark this proposal as lost?",
      body: "The client's link will say the proposal is no longer open, and they cannot accept it.",
    };
  }
  if (to === "draft" && from !== "draft") {
    return {
      title: "Move it back to draft?",
      body: "The client's link stops working until it is marked as sent again.",
    };
  }
  return null;
}

export function StatusControl({
  record,
  onChange,
}: {
  record: ProposalRecord;
  /** Resolves once the server has the new status; rejects with a message to show. */
  onChange: (status: ProposalStatus) => Promise<void>;
}) {
  const id = useId();
  const [asking, setAsking] = useState<ProposalStatus | null>(null);
  const [busy, setBusy] = useState<ProposalStatus | null>(null);
  const [problem, setProblem] = useState("");
  const ask = asking ? question(record.status, asking) : null;

  async function go(to: ProposalStatus) {
    setAsking(null);
    setBusy(to);
    setProblem("");
    try {
      await onChange(to);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "The status could not be changed.");
    } finally {
      setBusy(null);
    }
  }

  function choose(to: ProposalStatus) {
    if (to === record.status || busy) return;
    if (question(record.status, to)) setAsking(to);
    else void go(to);
  }

  return (
    <div className="space-y-2">
      <div role="group" aria-labelledby={`${id}-label`} className="space-y-1.5">
        <p id={`${id}-label`} className="text-sm font-medium text-ink">
          Status
        </p>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-sunken p-1 ring-1 ring-inset ring-line sm:inline-grid">
          {ORDER.map((status) => {
            const current = status === record.status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={current}
                aria-disabled={busy !== null || undefined}
                onClick={() => choose(status)}
                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 sm:px-4 ${
                  current ? "bg-surface text-ink shadow-sm ring-1 ring-line-strong" : "text-ink-2 hover:bg-surface/70 hover:text-ink"
                } ${busy !== null ? "cursor-progress" : ""}`}
              >
                {busy === status && <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-current" />}
                {statusLabels[status]}
              </button>
            );
          })}
        </div>
      </div>

      <p role="status" aria-live="polite" className="max-w-[62ch] text-sm text-ink-2">
        {busy ? `Marking as ${statusLabels[busy].toLowerCase()}…` : explain(record)}
      </p>

      {asking && ask && (
        <div role="alertdialog" aria-labelledby={`${id}-ask`} className="space-y-3 rounded-lg border border-confirm-line bg-confirm-soft px-4 py-3 text-sm text-confirm">
          <p>
            <span id={`${id}-ask`} className="font-semibold">
              {ask.title}
            </span>{" "}
            {ask.body}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void go(asking)} autoFocus>
              Mark as {statusLabels[asking].toLowerCase()}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
