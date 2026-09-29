"use client";

// Sending: marking the proposal as sent opens the client's link, and this panel hands the
// architect that link to copy, to email, or to look at the way the client will see it.
import { useId, useState } from "react";
import type { ProposalEdit } from "@/lib/api";
import { Button, StatusLine, buttonClass, plural } from "@/components/ui";
import type { ProposalRecord } from "./useProposalDraft";

function mailto(edit: ProposalEdit, link: string): string {
  const first = edit.client.name.trim().split(/\s+/)[0];
  const subject = edit.title.trim() || "Your landscape proposal";
  const body = [
    first ? `Hello ${first},` : "Hello,",
    "",
    "Here is the proposal for the work we talked about on the walk:",
    link,
    "",
    "It shows each area with photos and prices. When you are happy with it, you can accept it on that page. Any questions, just reply to this email.",
  ].join("\n");
  return `mailto:${encodeURIComponent(edit.client.email.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function SendPanel({
  record,
  edit,
  blocking,
  onSend,
}: {
  record: ProposalRecord;
  edit: ProposalEdit;
  /** How many checklist items still stop it being sent. */
  blocking: number;
  /** Saves what is on screen and marks the proposal as sent. Rejects with a message to show. */
  onSend: () => Promise<void>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const link = `${window.location.origin}/p/${record.shareToken}`;

  async function send() {
    setBusy(true);
    setSaid("");
    try {
      await onSend();
      setSaid("Marked as sent. The client's link works now.");
    } catch (err) {
      setSaid(err instanceof Error ? `Not sent. ${err.message}` : "Not sent.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setSaid("Link copied.");
    } catch {
      setSaid("Could not copy. Select the link and copy it by hand.");
    }
  }

  // One status line for both states, so "Marked as sent" is read out as the panel changes.
  return (
    <div className="space-y-2">
      {record.status === "draft" ? (
        <>
          <Button onClick={send} busy={busy} disabled={blocking > 0 && !busy} aria-describedby={`${id}-why`} className="w-full">
            {busy ? "Sending" : "Mark as sent"}
          </Button>
          <p id={`${id}-why`} className="text-xs text-ink-2">
            {blocking > 0
              ? `${plural(blocking, "item")} above ${blocking === 1 ? "needs" : "need"} doing first.`
              : "This saves the proposal and turns on the client's link. Then copy the link or email it."}
          </p>
        </>
      ) : (
        <>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-link`} className="block text-sm font-medium text-ink">
              The client&rsquo;s link
            </label>
            <input
              id={`${id}-link`}
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="control font-mono text-xs!"
            />
          </div>
          <div className="grid gap-2 pt-1">
            <Button variant="secondary" onClick={copy}>
              Copy link
            </Button>
            <a href={mailto(edit, link)} className={buttonClass("secondary")}>
              Email to client
            </a>
            <a href={`/p/${record.shareToken}`} target="_blank" rel="noopener" className={buttonClass("quiet")}>
              Open client view
            </a>
          </div>
        </>
      )}
      <StatusLine className="text-xs">{said}</StatusLine>
    </div>
  );
}
