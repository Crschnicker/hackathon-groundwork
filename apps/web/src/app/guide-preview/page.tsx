import type { Metadata } from "next";
import { GuidePreview } from "./GuidePreview";

export const metadata: Metadata = { title: "Walk guide preview" };

export default function GuidePreviewPage() {
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Walk guide preview</h1>
        <p className="max-w-[62ch] text-lg text-ink-2">
          A preview of the walk guide in each of its states, with example data and no recorder.
        </p>
      </header>
      <GuidePreview />
    </div>
  );
}
