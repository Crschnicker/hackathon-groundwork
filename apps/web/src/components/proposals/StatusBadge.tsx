// A proposal's status as a small badge: the same words and colours in the list and on the
// review screen. Draft is quiet, pending waits on the client (amber), won is green, lost is red.
import type { ProposalStatus } from "@/lib/api";

export const statusLabels: Record<ProposalStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  won: "Won",
  lost: "Lost",
};

const tones: Record<ProposalStatus, string> = {
  draft: "border-line-strong bg-surface text-ink-2",
  pending: "border-confirm-line bg-confirm-soft text-confirm",
  won: "border-brand bg-brand-soft text-brand",
  lost: "border-danger-line bg-danger-soft text-danger",
};

export function StatusBadge({ status, className = "" }: { status: ProposalStatus; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[status]} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${status === "draft" ? "border border-current" : "bg-current"}`} />
      {statusLabels[status]}
    </span>
  );
}
