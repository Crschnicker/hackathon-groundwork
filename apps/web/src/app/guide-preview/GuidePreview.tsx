"use client";

// Shows the walk guide in each of its states, picked by hand, and plays the sample walk's guide
// through it the way a live walk would fill it in.
import { useEffect, useId, useState } from "react";
import type { WalkGuide as Guide } from "@/lib/api";
import { sampleGuideAt, sampleTakenAt } from "@/lib/sampleGuide";
import { SAMPLE_SECONDS } from "@/lib/sampleWalk";
import { WalkGuide } from "@/components/walks/WalkGuide";
import { Button, StatusLine } from "@/components/ui";

const SAMPLE_STEP_MS = 500;

type Taken = { sectionId: string | null; promptId: string | null }[];

// The photos of a walk well under way: the prompts photographed by then, three of the crack in
// the patio, and five that answer no prompt of the guide.
const PHOTOS: Taken = [
  ...sampleTakenAt(30),
  { sectionId: "back-patio", promptId: "cracked-concrete" },
  { sectionId: "back-patio", promptId: "cracked-concrete" },
  { sectionId: "east-fence-line", promptId: "full-run" },
  { sectionId: "side-yard", promptId: null },
  { sectionId: "side-yard", promptId: "a-prompt-since-withdrawn" },
  { sectionId: null, promptId: null },
  { sectionId: null, promptId: null },
  { sectionId: null, promptId: null },
];

interface Shown {
  guide: Guide | null;
  taken: Taken;
  live: boolean;
}

// Example data has no clock of its own; the guide does not show when it was written.
const WRITTEN_AT = 0;

const backyard = sampleGuideAt(SAMPLE_SECONDS, WRITTEN_AT);

const frontYard: Guide = {
  projectType: "New front yard",
  headline: "A bare front yard on a new build: a walk to the door, low-water planting and no lawn.",
  basis: "model",
  updatedAt: WRITTEN_AT,
  current: true,
  sections: [
    {
      id: "front-walk",
      title: "Front walk",
      source: "heard",
      why: null,
      photos: [
        { id: "from-the-street", prompt: "From the sidewalk to the front door", reason: "Shows the line the new walk takes" },
        { id: "porch-step", prompt: "The porch step, from the side", reason: "Shows the height the walk has to meet" },
      ],
      ask: ["How wide should the walk be: one person or two side by side?", "How far is it from the sidewalk to the step?"],
    },
    {
      id: "planting-beds",
      title: "Planting beds",
      source: "heard",
      why: null,
      photos: [
        { id: "left-of-walk", prompt: "The ground to the left of the walk", reason: "Shows the larger bed and the builder's fill in it" },
        { id: "under-window", prompt: "Under the front window", reason: "Shows how tall the planting can grow there" },
        { id: "soil", prompt: "The soil, a spade deep", reason: "Shows how much has to be brought in before planting" },
      ],
      ask: ["Which way does the front of the house face?"],
    },
    {
      id: "driveway-edge",
      title: "Driveway edge",
      source: "heard",
      why: null,
      photos: [{ id: "edge", prompt: "The driveway edge along the yard", reason: "Shows where the bed meets the concrete" }],
      ask: [],
    },
    {
      id: "water-supply",
      title: "Water meter and supply",
      source: "suggested",
      why: "A new yard has no irrigation yet, and the meter decides where the main line starts.",
      photos: [
        { id: "meter", prompt: "The water meter, lid open", reason: "Shows the meter size, for how many zones it can feed" },
        { id: "hose-bib", prompt: "The hose bib on the front wall", reason: "Shows where the house supply comes out" },
      ],
      ask: ["Did the builder leave a sleeve under the driveway?"],
    },
    {
      id: "parkway-strip",
      title: "Parkway strip",
      source: "suggested",
      why: "The city often has rules for the strip between the sidewalk and the curb.",
      photos: [{ id: "strip", prompt: "The strip between the sidewalk and the curb", reason: "Shows its width and any street tree in it" }],
      ask: ["Does the client look after the strip, or does the city?"],
    },
    {
      id: "street-view",
      title: "House from the street",
      source: "suggested",
      why: "The proposal opens with this view, before and after.",
      photos: [{ id: "straight-on", prompt: "The whole front, from across the street", reason: null }],
      ask: [],
    },
  ],
};

// What the server falls back to: one section for each area of the site model, plainly worded.
const ruleBased: Guide = {
  projectType: "Landscape remodel",
  headline: "Three areas were named on this walk: back patio, east fence line and side yard.",
  basis: "rules",
  updatedAt: WRITTEN_AT,
  current: true,
  sections: [
    {
      id: "back-patio",
      title: "Back patio",
      source: "heard",
      why: null,
      photos: [
        { id: "wide-view", prompt: "The whole of the back patio", reason: "Shows the area as it is now" },
        { id: "removal-1", prompt: "The concrete slab that comes out", reason: "Shows the estimator what has to be removed" },
      ],
      ask: ["Where in the lawn can the downspout pipe come out?"],
    },
    {
      id: "east-fence-line",
      title: "East fence line",
      source: "heard",
      why: null,
      photos: [
        { id: "wide-view", prompt: "The whole of the east fence line", reason: "Shows the area as it is now" },
        { id: "removal-1", prompt: "The juniper that comes out", reason: "Shows the estimator what has to be removed" },
      ],
      ask: [],
    },
    {
      id: "side-yard",
      title: "Side yard",
      source: "heard",
      why: null,
      photos: [{ id: "wide-view", prompt: "The whole of the side yard", reason: "Shows the area as it is now" }],
      ask: ["Where can the French drain discharge at the front?"],
    },
  ],
};

const STATES = {
  waiting: { label: "No guide yet", shown: { guide: null, taken: [], live: true } },
  early: { label: "Early guide with one section", shown: { guide: sampleGuideAt(7, WRITTEN_AT), taken: [], live: true } },
  backyard: { label: "Full backyard guide", shown: { guide: backyard, taken: [], live: false } },
  frontYard: { label: "Full front yard guide", shown: { guide: frontYard, taken: [], live: false } },
  taken: {
    label: "Guide with photos taken",
    shown: { guide: backyard, taken: PHOTOS, live: false },
  },
  updating: {
    label: "Guide marked not current",
    shown: { guide: backyard && { ...backyard, current: false }, taken: sampleTakenAt(30), live: true },
  },
  rules: { label: "Rule-based guide", shown: { guide: ruleBased, taken: [], live: false } },
  none: { label: "Finished walk with no guide", shown: { guide: null, taken: [], live: false } },
} satisfies Record<string, { label: string; shown: Shown }>;

type StateName = keyof typeof STATES;

const WIDTHS = {
  column: { label: "As on the walk page", className: "max-w-[40rem]" },
  full: { label: "Full width", className: "" },
};

type WidthName = keyof typeof WIDTHS;

export function GuidePreview() {
  const stateId = useId();
  const widthId = useId();
  const [state, setState] = useState<StateName>("backyard");
  const [width, setWidth] = useState<WidthName>("column");
  // Counts the plays of the sample; 0 while a state picked by hand is shown.
  const [play, setPlay] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const playing = play > 0;
  const finished = playing && elapsed >= SAMPLE_SECONDS;

  useEffect(() => {
    if (play === 0) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function step() {
      const seconds = Math.min((Date.now() - started) / 1000, SAMPLE_SECONDS);
      setElapsed(seconds);
      if (seconds < SAMPLE_SECONDS) timer = setTimeout(step, SAMPLE_STEP_MS);
    }
    timer = setTimeout(step, 0);
    return () => clearTimeout(timer);
  }, [play]);

  const shown: Shown = playing
    ? { guide: sampleGuideAt(elapsed, WRITTEN_AT), taken: sampleTakenAt(elapsed), live: !finished }
    : STATES[state].shown;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="w-full space-y-1 sm:w-72">
            <label htmlFor={stateId} className="block text-sm font-medium text-ink">
              State
            </label>
            <select
              id={stateId}
              className="control"
              value={playing ? "sample" : state}
              onChange={(e) => {
                setPlay(0);
                setState(e.target.value as StateName);
              }}
            >
              {playing && <option value="sample">The sample, as it plays</option>}
              {(Object.keys(STATES) as StateName[]).map((name) => (
                <option key={name} value={name}>
                  {STATES[name].label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-full space-y-1 sm:w-56">
            <label htmlFor={widthId} className="block text-sm font-medium text-ink">
              Width
            </label>
            <select id={widthId} className="control" value={width} onChange={(e) => setWidth(e.target.value as WidthName)}>
              {(Object.keys(WIDTHS) as WidthName[]).map((name) => (
                <option key={name} value={name}>
                  {WIDTHS[name].label}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setElapsed(0);
              setPlay((n) => n + 1);
            }}
          >
            {playing ? "Play the sample again" : "Play the sample"}
          </Button>
        </div>
        {/* The count of seconds is kept out of the status line, which would read out every one. */}
        <div className="flex flex-wrap gap-x-2">
          <StatusLine>
            {playing &&
              (finished
                ? "The sample has finished. Its guide stays as the walk left it."
                : "Playing the sample, a seven minute walk in under a minute.")}
          </StatusLine>
          {playing && !finished && (
            <p className="text-sm tabular-nums text-ink-2">
              {Math.floor(elapsed)} of {SAMPLE_SECONDS} seconds.
            </p>
          )}
        </div>
      </div>

      {/* A state picked by hand starts a fresh guide, so nothing is announced as having arrived;
          the sample keeps one guide for the whole of a play, as a walk does. */}
      <div className={WIDTHS[width].className}>
        <WalkGuide key={playing ? `sample-${play}` : state} guide={shown.guide} taken={shown.taken} live={shown.live} />
      </div>
    </div>
  );
}
