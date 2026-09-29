// A scripted walk of a residential garden, for showing the walk page when no phone is recording.
// sampleWalk() answers with the same shape the server does, for any moment of the playback, so
// the page draws it with the code that draws a real walk.
import type { SiteArea, SiteModel, Walk, WalkRecording } from "@/lib/api";

export const SAMPLE_WALK_ID = "sample";

/** The sample plays this many times faster than the walk it shows. */
const SPEED = 10;

/** Seconds of playback until the sample has settled. */
export const SAMPLE_SECONDS = 42;

/** The walk had been going this long, in its own time, when its first recording arrived. */
const FIRST_ARRIVAL = 88;

/** Playback second at which the architect stops the walk. */
const FINISHED_AT = 32.5;

interface ScriptedRecording {
  key: string;
  /** Seconds of audio. */
  length: number;
  /** Playback second the recording reaches the server. */
  arrives: number;
  /** Playback second its transcript is ready. */
  transcribed: number;
  text: string;
}

const RECORDINGS: ScriptedRecording[] = [
  {
    key: "sample-1",
    length: 88,
    arrives: 0,
    transcribed: 5,
    text:
      "Okay, starting at the back of the house. Back patio. I'm measuring twenty feet along the house wall and " +
      "fifteen feet out, so call it three hundred square feet. It's poured concrete, cracked right through the " +
      "middle and heaving at the northwest corner where the downspout lets go. Full sun from about ten until four. " +
      "The client wants the concrete out and flagstone down, dry laid, with room for a table for six. There's a " +
      "slight fall away from the house, which I want to keep.",
  },
  {
    key: "sample-2",
    length: 90,
    arrives: 9,
    transcribed: 13.5,
    text:
      "The downspout I'd like to pipe under the new patio and out to the lawn. I need to ask the client where it " +
      "can daylight. Moving to the east side now. East fence line. Cedar fence, six feet tall, in good shape. The " +
      "run is forty feet from the corner of the house to the back corner post, and the bed along it is four feet " +
      "deep, so a hundred and sixty square feet. Full afternoon sun. There's a juniper at the far end that is more " +
      "brown than green, that comes out. The client wants a pollinator border here, something that flowers from " +
      "spring through to fall and doesn't need much water.",
  },
  {
    key: "sample-3",
    length: 90,
    arrives: 18,
    transcribed: 23,
    text:
      "No irrigation along the fence that I can find. The nearest valve box is by the patio steps, so the border " +
      "gets its own drip line from there. Through the gate to the side yard. This is the north side of the house. " +
      "It's narrow, eight feet between the house and the property line, and thirty-two feet long. Mostly shade, " +
      "the neighbour's maple covers it. The ground is soft, it stays wet after rain, and there's moss on the old " +
      "stepping stones. The lawn is thin and patchy.",
  },
  {
    key: "sample-4",
    length: 90,
    arrives: 27,
    transcribed: 31.5,
    text:
      "What they'd like here is a gravel path, to get the bins from the gate to the back without walking through " +
      "mud. I'd do a path three feet wide for the full thirty-two feet, steel edging both sides, over a compacted " +
      "base, and a French drain along the house side to take the water to the front. The stepping stones come out, " +
      "there are nine of them. Shade planting either side, ferns and hostas, nothing that minds wet feet. I did " +
      "not check where the drain can discharge at the front.",
  },
  {
    key: "sample-5",
    length: 52,
    arrives: 32.2,
    transcribed: 37,
    text:
      "Back on the patio to finish. For the flagstone the client picked the bluestone sample, an inch and a half " +
      "thick, in the irregular pattern. Two low path lights at the patio steps. That's everything for today.",
  },
];

const PATIO_BASE = {
  name: "Back patio",
  measurements: [
    {
      subject: "Patio",
      lengthFt: 20,
      widthFt: 15,
      areaSqFt: 300,
      asSpoken: "twenty feet along the house wall and fifteen feet out",
    },
  ],
  existingFeatures: [
    { feature: "Poured concrete slab", condition: "Cracked through the middle, heaving at the northwest corner" },
    { feature: "Downspout at the northwest corner", condition: "Discharges onto the slab" },
  ],
  conditions: { sun: "full_sun", slope: "slight", drainage: null, notes: "Falls away from the house; keep the fall" },
  removals: [{ item: "Concrete slab", quantity: null, reason: "Cracked and heaving" }],
} satisfies Partial<SiteArea>;

const patioFirst: SiteArea = {
  ...PATIO_BASE,
  proposedChanges: [{ change: "Dry-laid flagstone patio", category: "hardscape", material: "Flagstone" }],
};

const patioPiped: SiteArea = {
  ...PATIO_BASE,
  proposedChanges: [
    { change: "Dry-laid flagstone patio", category: "hardscape", material: "Flagstone" },
    { change: "Pipe the downspout under the patio and out to the lawn", category: "drainage", material: null },
  ],
};

const patioFinal: SiteArea = {
  ...PATIO_BASE,
  proposedChanges: [
    {
      change: "Dry-laid flagstone patio, irregular pattern",
      category: "hardscape",
      material: "Bluestone, 1.5 in thick",
    },
    { change: "Pipe the downspout under the patio and out to the lawn", category: "drainage", material: null },
    { change: "Two low path lights at the patio steps", category: "lighting", material: null },
  ],
};

const FENCE_BASE = {
  name: "East fence line",
  measurements: [
    { subject: "Planting bed", lengthFt: 40, widthFt: 4, areaSqFt: 160, asSpoken: "forty feet, and the bed is four feet deep" },
  ],
  existingFeatures: [
    { feature: "Cedar fence, 6 ft tall", condition: "Good" },
    { feature: "Juniper at the far end", condition: "Dying" },
  ],
  conditions: { sun: "full_sun", slope: null, drainage: null, notes: "Sun through the afternoon" },
  removals: [{ item: "Juniper", quantity: 1, reason: "More brown than green" }],
} satisfies Partial<SiteArea>;

const POLLINATOR = {
  change: "Pollinator border that flowers from spring to fall",
  category: "plants",
  material: "Low-water perennials",
};

const fenceFirst: SiteArea = { ...FENCE_BASE, proposedChanges: [POLLINATOR] };

const fenceWithDrip: SiteArea = {
  ...FENCE_BASE,
  proposedChanges: [
    POLLINATOR,
    { change: "New drip line for the border, from the valve box by the patio steps", category: "irrigation", material: null },
  ],
};

const SIDE_BASE = {
  name: "Side yard",
  existingFeatures: [
    { feature: "Stepping stones", condition: "Mossy" },
    { feature: "Lawn", condition: "Thin and patchy" },
  ],
  conditions: {
    sun: "full_shade",
    slope: null,
    drainage: "poor",
    notes: "North side of the house, under the neighbour's maple. Stays wet after rain",
  },
} satisfies Partial<SiteArea>;

const SIDE_SIZE = {
  subject: "Side yard",
  lengthFt: 32,
  widthFt: 8,
  areaSqFt: 256,
  asSpoken: "eight feet between the house and the property line, and thirty-two feet long",
};

const sideFirst: SiteArea = { ...SIDE_BASE, measurements: [SIDE_SIZE], removals: [], proposedChanges: [] };

const sidePlanned: SiteArea = {
  ...SIDE_BASE,
  measurements: [
    SIDE_SIZE,
    { subject: "Gravel path", lengthFt: 32, widthFt: 3, areaSqFt: 96, asSpoken: "three feet wide for the full thirty-two feet" },
  ],
  removals: [{ item: "Stepping stones", quantity: 9, reason: "Replaced by the path" }],
  proposedChanges: [
    { change: "Gravel path over a compacted base, steel edging both sides", category: "hardscape", material: "Gravel" },
    { change: "French drain along the house side, draining to the front", category: "drainage", material: null },
    { change: "Shade planting either side of the path", category: "plants", material: "Ferns and hostas" },
  ],
};

const ASK_FLAGSTONE = { area: "Back patio", question: "Which flagstone: what stone, thickness and pattern?" };
const ASK_DOWNSPOUT = { area: "Back patio", question: "Where in the lawn can the downspout pipe come out?" };
const ASK_IRRIGATION = { area: "East fence line", question: "Is there irrigation along the fence, or does the border need its own line?" };
const ASK_SIDE_PLAN = { area: "Side yard", question: "What is wanted in the side yard? Nothing has been proposed for it yet." };
const ASK_DRAIN = { area: "Side yard", question: "Where can the French drain discharge at the front?" };

const TABLE = "Room on the patio for a table for six";
const LOW_WATER = "Planting that does not need much water";
const BINS = "A dry way to take the bins from the gate to the back";

/** The site model after each reading of the walk, and how many recordings that reading covered. */
const MODELS: { at: number; covers: number; pass: "live" | "final"; model: SiteModel }[] = [
  {
    at: 7,
    covers: 1,
    pass: "live",
    model: {
      areas: [patioFirst],
      clientPreferences: [TABLE],
      missing: [ASK_FLAGSTONE, { area: "Back patio", question: "Where should the downspout drain once the slab is gone?" }],
    },
  },
  {
    at: 16,
    covers: 2,
    pass: "live",
    model: {
      areas: [patioPiped, fenceFirst],
      clientPreferences: [TABLE, LOW_WATER],
      missing: [ASK_FLAGSTONE, ASK_DOWNSPOUT, ASK_IRRIGATION],
    },
  },
  {
    at: 25.5,
    covers: 3,
    pass: "live",
    model: {
      areas: [patioPiped, fenceWithDrip, sideFirst],
      clientPreferences: [TABLE, LOW_WATER],
      missing: [ASK_FLAGSTONE, ASK_DOWNSPOUT, ASK_SIDE_PLAN],
    },
  },
  {
    at: 34,
    covers: 4,
    pass: "live",
    model: {
      areas: [patioPiped, fenceWithDrip, sidePlanned],
      clientPreferences: [TABLE, LOW_WATER, BINS],
      missing: [ASK_FLAGSTONE, ASK_DOWNSPOUT, ASK_DRAIN],
    },
  },
  {
    at: SAMPLE_SECONDS,
    covers: 5,
    pass: "final",
    model: {
      areas: [patioFinal, fenceWithDrip, sidePlanned],
      clientPreferences: [TABLE, LOW_WATER, BINS],
      missing: [ASK_DOWNSPOUT, ASK_DRAIN],
    },
  },
];

function statusAt(recording: ScriptedRecording, elapsed: number): WalkRecording["status"] {
  if (elapsed >= recording.transcribed) return "done";
  const since = elapsed - recording.arrives;
  if (since < 0.4) return "received";
  if (since < 1.2) return "uploading";
  return "transcribing";
}

/**
 * The sample walk as it stands `elapsedSeconds` into the playback. `now` is the moment that
 * corresponds to, so the walk's own clock reads the same however often this is called.
 */
export function sampleWalk(elapsedSeconds: number, now: number = Date.now()): Walk {
  const elapsed = Math.min(Math.max(elapsedSeconds, 0), SAMPLE_SECONDS);
  const createdAt = Math.round(now - (FIRST_ARRIVAL + elapsed * SPEED) * 1000);
  const finished = elapsed >= FINISHED_AT;

  let recordedBefore = 0;
  const chunks: WalkRecording[] = [];
  for (const recording of RECORDINGS) {
    const startedAt = Math.round(createdAt / 1000) + recordedBefore;
    recordedBefore += recording.length;
    if (elapsed < recording.arrives) continue;
    const status = statusAt(recording, elapsed);
    const done = status === "done";
    chunks.push({
      key: recording.key,
      startedAt,
      bytes: recording.length * 16_000,
      gapMs: chunks.length === 0 ? null : 40,
      status,
      error: null,
      transcript: done ? recording.text : null,
      durationSec: done ? recording.length : null,
      latencyMs: done ? Math.round((recording.transcribed - recording.arrives) * SPEED * 1000) : null,
    });
  }

  const done = chunks.filter((c) => c.status === "done").length;
  const inFlight = chunks.length - done;
  const reading = MODELS.findLast((m) => elapsed >= m.at) ?? null;

  return {
    id: SAMPLE_WALK_ID,
    userId: "sample",
    status: finished ? "finished" : "active",
    cutSeconds: 90,
    createdAt,
    finishedAt: finished ? Math.round(createdAt + (FIRST_ARRIVAL + FINISHED_AT * SPEED) * 1000) : null,
    counts: { total: chunks.length, done, failed: 0, inFlight },
    settled: elapsed >= SAMPLE_SECONDS,
    // Recordings finish in order here, so there is never a part missing in the middle.
    transcript: chunks
      .filter((c) => c.status === "done")
      .map((c) => c.transcript)
      .join(" "),
    siteModel: reading?.model ?? null,
    siteModelMeta: reading ? { provider: "crusoe", model: "sample", latencyMs: 2_000 } : null,
    siteModelError: null,
    siteModelUpdatedAt: reading ? Math.round(now - (elapsed - reading.at) * SPEED * 1000) : null,
    siteModelPass: reading?.pass ?? null,
    siteModelCurrent: (reading?.covers ?? 0) === done && !(finished && inFlight === 0 && reading?.pass !== "final"),
    chunks,
  };
}
