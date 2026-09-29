import type { Metadata } from "next";
import { ClientProposalView } from "@/components/proposals/ClientProposalView";

// The client's page, reached from the link in the architect's email. The link is the key, so the
// page is kept out of search engines.
export const metadata: Metadata = { title: "Proposal", robots: { index: false, follow: false } };

// The root layout puts the architect's header and footer around every page. The client sees only
// their proposal: it covers the viewport on screen, and in print everything else is left out.
const printOnlyTheProposal = `
@media print {
  body > :not(main) { display: none !important; }
  main { padding: 0 !important; max-width: none !important; }
  [data-client-proposal] { position: static !important; overflow: visible !important; }
}
`;

export default async function ClientProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div data-client-proposal className="fixed inset-0 z-40 overflow-y-auto bg-page">
      <style>{printOnlyTheProposal}</style>
      <ClientProposalView token={token} />
    </div>
  );
}
