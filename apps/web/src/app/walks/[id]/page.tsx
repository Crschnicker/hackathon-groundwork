import type { Metadata } from "next";
import { WalkLive } from "@/components/walks/WalkLive";

export const metadata: Metadata = { title: "Walk" };

export default async function WalkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WalkLive id={id} />;
}
