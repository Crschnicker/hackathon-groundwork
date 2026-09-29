"use client";

// Drafts a proposal from a walk and opens it for review. Drafting reads the whole walk, looks
// every item up in the catalog and prices it, so it takes a minute or two; the button says so
// while it works. Used on a walk's page and by the walk picker on the proposals page.
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, UNREACHABLE_MESSAGE, api, type Walk } from "@/lib/api";
import { SAMPLE_WALK_ID } from "@/lib/sampleWalk";
import { Button, Notice, StatusLine } from "@/components/ui";

export const DRAFTING_MESSAGE = "Drafting the proposal. This can take a minute or two.";

/** What a failed draft means, in words the architect can act on. */
function draftError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.unreachable) return UNREACHABLE_MESSAGE;
    if (err.needsToken) return "This server wants the walk token. Open the walk list and type it in first.";
    return err.message;
  }
  return "The proposal could not be drafted.";
}

/** Drafts a proposal from one walk, then goes to its review screen. */
export function useDraftProposal() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Leaving the page does not stop the draft on the server, but it must not pull the architect back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const draft = useCallback(
    async (walkId: string) => {
      setBusy(true);
      setError("");
      try {
        const proposal = await api.generateProposal(walkId);
        if (mounted.current) router.push(`/proposals/${encodeURIComponent(proposal.id)}`);
      } catch (err) {
        if (mounted.current) {
          setError(draftError(err));
          setBusy(false);
        }
      }
    },
    [router],
  );

  return { draft, busy, error };
}

export function GenerateProposalButton({ walk }: { walk: Walk }) {
  const { draft, busy, error } = useDraftProposal();
  const reason =
    walk.id === SAMPLE_WALK_ID
      ? "The sample walk is not saved on the server, so it cannot be made into a proposal."
      : !walk.siteModel || walk.siteModel.areas.length === 0
        ? "A proposal can be drafted once Groundwork has found at least one area in the walk."
        : "";

  return (
    <div className="space-y-2">
      <Button onClick={() => void draft(walk.id)} busy={busy} disabled={Boolean(reason)} aria-describedby={`draft-${walk.id}`}>
        {busy ? "Drafting the proposal" : "Draft the proposal"}
      </Button>
      <StatusLine>{busy ? DRAFTING_MESSAGE : ""}</StatusLine>
      <p id={`draft-${walk.id}`} className="max-w-[62ch] text-sm text-ink-2">
        {reason ||
          "Prices each area from the catalog and adds the walk's photos. You review everything before it goes to the client."}
      </p>
      {error && <Notice title="The proposal could not be drafted.">{error}</Notice>}
    </div>
  );
}
