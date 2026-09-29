import type { Metadata } from "next";
import { ProposalList } from "@/components/proposals/ProposalList";

export const metadata: Metadata = { title: "Proposals" };

export default function ProposalsPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Proposals</h1>
        <p className="max-w-[62ch] text-lg text-ink-2">
          Priced from a walk: each area of the site with the photos taken there and the catalog items it needs. Review
          one, send the client a link, and keep track of which are pending, won and lost.
        </p>
      </header>
      <ProposalList />
    </div>
  );
}
