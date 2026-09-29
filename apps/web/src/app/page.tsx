import { ItemSearch } from "@/components/ItemSearch";
import { SiteModelDemo } from "@/components/SiteModelDemo";
import { StatusBar } from "@/components/StatusBar";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-12 px-4 py-10 sm:px-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-stone-900">Groundwork</h1>
        <p className="max-w-2xl text-stone-600">
          Walk the site, talk it through, get a quote. This page exercises the foundation: the item catalog in
          Neo4j and the transcript extraction that turns a walkthrough into a site model.
        </p>
        <StatusBar />
      </header>

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Item catalog</h2>
          <p className="text-sm text-stone-600">
            Plants, irrigation, drainage and materials with cost and sale price. Open a kit to see what a factor
            code pulls in.
          </p>
        </div>
        <ItemSearch />
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">Walkthrough to site model</h2>
          <p className="text-sm text-stone-600">
            Paste what the architect said on site. Gaps the quote needs are flagged for review rather than
            guessed.
          </p>
        </div>
        <SiteModelDemo />
      </div>
    </main>
  );
}
