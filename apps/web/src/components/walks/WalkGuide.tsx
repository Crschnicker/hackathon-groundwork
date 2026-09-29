"use client";

// The walk guide: what kind of job this walk is and, section by section, the photos worth
// taking and the things worth measuring or asking while standing there. It is for reading, at a
// desk or on a screen in the room during the walk; the photos are taken on the phone.
import { useId, useState } from "react";
import type { GuidePhoto, GuideSection, WalkGuide as Guide } from "@/lib/api";
import { StatusLine, plural } from "@/components/ui";

/** A photo as far as the guide cares: the section and prompt it answers. A walk's photos fit. */
export type Taken = { sectionId: string | null; promptId: string | null };

const NO_PHOTOS: Taken[] = [];

const takenKey = (sectionId: string, promptId: string) => `${sectionId}/${promptId}`;

/** How many photos each prompt of the guide has, and how many photos answer none of them. */
function countTaken(guide: Guide, taken: Taken[]) {
  const perPrompt = new Map<string, number>();
  for (const section of guide.sections) {
    for (const photo of section.photos) perPrompt.set(takenKey(section.id, photo.id), 0);
  }
  let other = 0;
  for (const { sectionId, promptId } of taken) {
    const key = sectionId !== null && promptId !== null ? takenKey(sectionId, promptId) : null;
    const soFar = key === null ? undefined : perPrompt.get(key);
    if (key === null || soFar === undefined) other += 1;
    else perPrompt.set(key, soFar + 1);
  }
  return { perPrompt, other };
}

/** What is on screen that is worth announcing when it changes: the job type and the sections. */
interface Seen {
  projectType: string | null;
  sections: string[];
}

const seenIn = (guide: Guide | null): Seen => ({
  projectType: guide?.projectType ?? null,
  sections: guide?.sections.map((s) => s.id) ?? [],
});

const sameSeen = (a: Seen, b: Seen) => a.projectType === b.projectType && a.sections.join("\n") === b.sections.join("\n");

/** What a newer guide brought that is worth saying out loud, if anything. */
function arrivals(before: Seen, guide: Guide): string {
  const said: string[] = [];
  if (guide.projectType !== before.projectType) said.push(`Job type: ${guide.projectType}.`);
  const fresh = guide.sections.filter((s) => !before.sections.includes(s.id));
  if (fresh.length > 0) {
    said.push(`${fresh.length === 1 ? "New section" : "New sections"}: ${fresh.map((s) => s.title).join(", ")}.`);
  }
  return said.join(" ");
}

/**
 * The line to announce. It changes when a section arrives or the job type does, and not when
 * the guide is only refreshed. A guide that is there when the page opens is not announced.
 */
function useArrivals(guide: Guide | null): string {
  const [seen, setSeen] = useState(() => seenIn(guide));
  const [announcement, setAnnouncement] = useState("");

  const next = seenIn(guide);
  if (!sameSeen(seen, next)) {
    setSeen(next);
    const said = guide ? arrivals(seen, guide) : "";
    if (said || !guide) setAnnouncement(said);
  }
  return announcement;
}

/** A ring, with a check mark that draws itself in when the photo has been taken. */
function Mark({ taken }: { taken: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={`mt-0.5 h-5 w-5 shrink-0 transition-colors duration-200 motion-reduce:transition-none ${
        taken ? "text-brand" : "text-line-strong"
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="8" />
      <path
        d="m6.5 10.5 2.5 2.5 4.5-5.5"
        className="transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none"
        style={{ strokeDasharray: 11, strokeDashoffset: taken ? 0 : 11 }}
      />
    </svg>
  );
}

function Photo({ photo, count }: { photo: GuidePhoto; count: number }) {
  const taken = count > 0;
  return (
    <li className="flex gap-3">
      <Mark taken={taken} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-x-4 text-base text-ink">
          <span className="min-w-0">
            {photo.prompt}
            <span className="sr-only">{taken ? " (taken)" : " (not taken yet)"}</span>
          </span>
          {count > 1 && <span className="shrink-0 text-sm tabular-nums text-ink-2">{count} photos</span>}
        </p>
        {photo.reason && <p className="text-sm text-ink-3">{photo.reason}</p>}
      </div>
    </li>
  );
}

function Section({ section, taken }: { section: GuideSection; taken: Map<string, number> }) {
  const countFor = (photo: GuidePhoto) => taken.get(takenKey(section.id, photo.id)) ?? 0;
  const done = section.photos.filter((p) => countFor(p) > 0).length;
  const complete = section.photos.length > 0 && done === section.photos.length;

  return (
    <li className="settle grid gap-x-8 gap-y-3 px-4 py-5 @xl:grid-cols-[minmax(0,12rem)_1fr] @xl:px-6">
      <div className="space-y-1">
        {/* Side by side where the section is one column; stacked where the title has its own. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 @xl:flex-col @xl:justify-start">
          <h3 className="text-lg font-semibold tracking-tight text-ink">{section.title}</h3>
          {complete ? (
            <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
              <svg
                aria-hidden
                viewBox="0 0 16 16"
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m3 8.5 3.5 3.5L13 4.5" />
              </svg>
              All photos taken
            </p>
          ) : (
            <p className="text-sm tabular-nums text-ink-3">
              {done} of {plural(section.photos.length, "photo")}
            </p>
          )}
        </div>
        {section.source === "suggested" && (
          <p className="text-sm text-ink-2">
            <span className="font-semibold">Suggested.</span> {section.why}
          </p>
        )}
      </div>

      <div className="min-w-0">
        <ul className="space-y-3">
          {section.photos.map((photo) => (
            <Photo key={photo.id} photo={photo} count={countFor(photo)} />
          ))}
        </ul>

        {section.ask.length > 0 && (
          <div className="mt-4 rounded-lg border border-confirm-line bg-confirm-soft px-4 py-3">
            <h4 className="text-xs font-semibold text-confirm">Measure or ask</h4>
            <ul className="mt-2 space-y-1.5 text-sm text-confirm">
              {section.ask.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/** "7 of 12 photos taken, 4 to measure or ask". Only photos the guide asks for are counted. */
function progress(guide: Guide, taken: Map<string, number>): string {
  const done = [...taken.values()].filter((n) => n > 0).length;
  const asks = guide.sections.reduce((n, s) => n + s.ask.length, 0);
  const line = `${done} of ${plural(taken.size, "photo")} taken`;
  return asks > 0 ? `${line}, ${asks} to measure or ask` : line;
}

/** The shape of the guide while the first recording of a live walk is being read. */
function GuideSkeleton() {
  return (
    <ul aria-hidden className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {[0, 1].map((i) => (
        <li key={i} className="grid gap-x-8 gap-y-3 px-4 py-5 @xl:grid-cols-[minmax(0,12rem)_1fr] @xl:px-6">
          <div className="skeleton h-6 w-32" />
          <div className="space-y-3">
            <div className="skeleton h-5 w-4/5" />
            <div className="skeleton h-5 w-3/5" />
            <div className="skeleton h-5 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WalkGuide({
  guide,
  taken = NO_PHOTOS,
  live = false,
}: {
  guide: Guide | null;
  /** The walk's photos. One that answers a prompt ticks it off; the rest are counted at the end. */
  taken?: Taken[];
  /** The walk is still being recorded, so a guide that is missing is on its way. */
  live?: boolean;
}) {
  const headingId = useId();
  const announcement = useArrivals(guide);
  const { perPrompt: takenKeys, other } = guide ? countTaken(guide, taken) : { perPrompt: new Map<string, number>(), other: 0 };
  const updating = guide !== null && !guide.current;

  return (
    <section aria-labelledby={headingId} aria-busy={updating} className="@container min-w-0 space-y-4">
      <div className="space-y-1">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-ink">
          {guide ? guide.projectType : "Walk guide"}
        </h2>
        {guide ? (
          <>
            <p className="max-w-[68ch] text-base text-ink">{guide.headline}</p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-ink-2">
              <p className="tabular-nums">{progress(guide, takenKeys)}</p>
              {updating && (
                <p className="flex items-center gap-2">
                  <span aria-hidden className="live-dot h-2 w-2 shrink-0 rounded-full bg-brand" />
                  Updating with what was just said.
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="max-w-[68ch] text-sm text-ink-2">
            {live
              ? "Listening. Sections appear once the first part of the walk has been transcribed."
              : "This walk has no guide."}
          </p>
        )}
        <StatusLine>{announcement}</StatusLine>
      </div>

      {guide?.sections.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 @xl:px-6">
          No sections yet. A section appears once the walk names a part of the property.
        </p>
      ) : guide ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {guide.sections.map((section) => (
            <Section key={section.id} section={section} taken={takenKeys} />
          ))}
        </ul>
      ) : (
        live && <GuideSkeleton />
      )}

      {guide && other > 0 && (
        <p className="px-1 text-sm tabular-nums text-ink-3">{plural(other, "other photo")} taken on this walk.</p>
      )}

      {guide?.basis === "rules" && (
        <p className="max-w-[68ch] px-1 text-sm text-ink-3">
          Written from the site model because the language model could not be reached. It will be rewritten on the
          next recording.
        </p>
      )}
    </section>
  );
}
