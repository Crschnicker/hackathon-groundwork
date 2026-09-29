import type { Metadata } from "next";
import { WalkPhotosPage } from "@/components/photos/WalkPhotosPage";

export const metadata: Metadata = { title: "Walk photos" };

export default async function WalkPhotosRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WalkPhotosPage id={id} />;
}
