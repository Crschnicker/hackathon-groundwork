import type { Metadata } from "next";
import { ProposalReview } from "@/components/proposals/ProposalReview";

export const metadata: Metadata = { title: "Proposal" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalReview key={id} id={id} />;
}
