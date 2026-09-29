import { SectionHeading } from "@/components/ui";
import { WalkList } from "@/components/walks/WalkList";
import { WalkthroughTry } from "@/components/WalkthroughTry";

export default function Home() {
  return (
    <div className="space-y-14">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Site walks</h1>
        <p className="max-w-[62ch] text-lg text-ink-2">
          Talk through the site as you walk it. Groundwork turns what you said into areas, measurements and the
          questions a quote still needs.
        </p>
      </header>

      <section aria-labelledby="walks" className="space-y-4">
        <SectionHeading id="walks" title="Walks">
          Recorded with the Groundwork Walk app on the phone. A walk in progress fills in here while the architect
          is still talking.
        </SectionHeading>
        <WalkList />
      </section>

      <section aria-labelledby="try" className="space-y-4">
        <SectionHeading id="try" title="Try it with a walkthrough">
          No recording to hand? Type or paste what was said on site. Anything the quote needs that was not said is
          listed to confirm, never guessed.
        </SectionHeading>
        <WalkthroughTry />
      </section>
    </div>
  );
}
