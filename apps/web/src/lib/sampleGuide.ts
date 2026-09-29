// The walk guide for the scripted sample walk (sampleWalk.ts), for any moment of its playback.
// Each version is what the server would have written from the recordings transcribed by then:
// a section appears once its area has been talked about, suggested sections once the kind of
// job is clear, and nothing already issued is renamed or moved.
import type { GuidePhoto, GuideSection, WalkGuide } from "@/lib/api";
import { SAMPLE_SECONDS } from "@/lib/sampleWalk";

/** The same speed and transcript times as sampleWalk.ts, which keeps them to itself. */
const SPEED = 10;
const TRANSCRIBED = [5, 13.5, 23, 31.5, 37];

const photo = (id: string, prompt: string, reason: string | null): GuidePhoto => ({ id, prompt, reason });

const heard = (id: string, title: string, photos: GuidePhoto[], ask: string[]): GuideSection => ({
  id,
  title,
  source: "heard",
  why: null,
  photos,
  ask,
});

const suggested = (id: string, title: string, why: string, photos: GuidePhoto[], ask: string[]): GuideSection => ({
  id,
  title,
  source: "suggested",
  why,
  photos,
  ask,
});

const PATIO_PHOTOS = [
  photo("wide-view", "The whole patio from the back door", "Shows the size and how the patio meets the house"),
  photo("cracked-concrete", "The cracked concrete, close up", "Shows the estimator how much has to come out"),
  photo("heaving-corner", "The heaving corner at the downspout", "Shows where water has been getting under the slab"),
];

const ASK_SLAB = "How thick is the slab at its broken edge?";
const ASK_FLAGSTONE = "Which flagstone: what stone, thickness and pattern?";
const ASK_DOWNSPOUT = "Where in the lawn can the downspout pipe come out?";

const patioFirst = heard("back-patio", "Back patio", PATIO_PHOTOS, [ASK_SLAB, ASK_FLAGSTONE]);
const patioPiped = heard("back-patio", "Back patio", PATIO_PHOTOS, [ASK_SLAB, ASK_FLAGSTONE, ASK_DOWNSPOUT]);
const patioFinal = heard(
  "back-patio",
  "Back patio",
  [...PATIO_PHOTOS, photo("patio-steps", "The patio steps, where the two lights go", "Shows where the path lights and their cable would sit")],
  [ASK_SLAB, ASK_DOWNSPOUT],
);

const FENCE_PHOTOS = [
  photo("full-run", "The full fence run from the house corner", "Shows the 40 ft bed the border has to fill"),
  photo("juniper", "The juniper at the far end", "Shows the size of what comes out, roots and all"),
  photo("bed-soil", "The soil in the bed, close up", "Helps choose plants that will take in this ground"),
];

const fenceFirst = heard("east-fence-line", "East fence line", FENCE_PHOTOS, [
  "Is there irrigation along the fence?",
  "Is anything in the bed to be kept?",
]);
const fenceWatered = heard("east-fence-line", "East fence line", FENCE_PHOTOS, ["Is anything in the bed to be kept?"]);

const IRRIGATION_PHOTOS = [
  photo("valve-box", "The nearest valve box, lid open", "Shows how many valves there are and whether one is spare"),
  photo("controller", "The irrigation controller", "Shows the make and how many zones it can run"),
];
const ASK_ZONE = "Is there a spare zone on the controller?";

const irrigationSuggested = suggested(
  "irrigation",
  "Irrigation",
  "A new border needs water, and nobody has said where it comes from.",
  IRRIGATION_PHOTOS,
  [ASK_ZONE],
);
// The architect got to it: the same section, in the same place, now one that was heard.
const irrigationHeard = heard(
  "irrigation",
  "Irrigation",
  [...IRRIGATION_PHOTOS, photo("drip-route", "From the valve box to the fence bed", "Shows how far the new drip line has to run")],
  [ASK_ZONE, "How far is it from the valve box to the start of the border?"],
);

const access = suggested(
  "gate-and-access",
  "Gate and access",
  "The old concrete goes out through the gate and the flagstone comes in through it.",
  [
    photo("gate", "The side gate, with the whole opening in view", "Shows whether a wheelbarrow or a small loader fits"),
    photo("route", "The way from the street to the back", "Shows what has to be protected while material moves"),
  ],
  ["How wide is the gate opening?", "Where can a pallet of stone be dropped?"],
);

const SIDE_PHOTOS = [
  photo("length", "Down the length of the side yard from the gate", "Shows how narrow it is and how little light gets in"),
  photo("wet-ground", "The soft ground and the mossy stepping stones", "Shows how wet it stays, for the drainage work"),
];

const sideFirst = heard("side-yard", "Side yard", SIDE_PHOTOS, ["What is wanted in the side yard?"]);
const sidePlanned = heard(
  "side-yard",
  "Side yard",
  [...SIDE_PHOTOS, photo("house-wall", "Along the house wall, where the drain would go", "Shows vents, pipes and steps the drain has to pass")],
  ["Where can the French drain discharge at the front?", "Which way does the ground fall, to the front or to the back?"],
);

const front = suggested(
  "front-of-the-house",
  "Front of the house",
  "The French drain runs to the front, and where it lets out has not been seen.",
  [
    photo("side-meets-front", "Where the side yard meets the front", "Shows where the drain could come out"),
    photo("curb", "The curb and the street gutter", "Shows whether water can be let out to the street"),
  ],
  ["Is there a storm drain or a curb outlet to tie into?"],
);

const REMODEL = "Backyard remodel";

/** The guide after each writing of it, and how many recordings that writing covered. */
const GUIDES: { at: number; covers: number; projectType: string; headline: string; sections: GuideSection[] }[] = [
  {
    at: 6,
    covers: 1,
    // One area in, it is a patio job. It becomes a remodel when the second area is talked about.
    projectType: "Patio replacement",
    headline: "The cracked concrete patio comes out and dry-laid flagstone goes down in its place.",
    sections: [patioFirst],
  },
  {
    at: 15,
    covers: 2,
    projectType: REMODEL,
    headline: "A flagstone patio in place of the cracked concrete, and a pollinator border along the east fence.",
    sections: [patioPiped, fenceFirst, irrigationSuggested, access],
  },
  {
    at: 24.5,
    covers: 3,
    projectType: REMODEL,
    headline: "A flagstone patio, a pollinator border on its own drip line, and a wet side yard still to be planned.",
    sections: [patioPiped, fenceWatered, irrigationHeard, sideFirst, access],
  },
  {
    at: 33,
    covers: 4,
    projectType: REMODEL,
    headline: "A flagstone patio, a pollinator border along the east fence, and a dry gravel path down the side yard.",
    sections: [patioPiped, fenceWatered, irrigationHeard, sidePlanned, access, front],
  },
  {
    at: 38.5,
    covers: 5,
    projectType: REMODEL,
    headline: "A bluestone patio, a pollinator border along the east fence, and a dry gravel path down the side yard.",
    sections: [patioFinal, fenceWatered, irrigationHeard, sidePlanned, access, front],
  },
];

/**
 * The sample walk's guide as it stands `seconds` into the playback, or null before the first
 * one is written. `now` is the moment that corresponds to, as in sampleWalk().
 */
export function sampleGuideAt(seconds: number, now: number = Date.now()): WalkGuide | null {
  const elapsed = Math.min(Math.max(seconds, 0), SAMPLE_SECONDS);
  const written = GUIDES.findLast((g) => elapsed >= g.at);
  if (!written) return null;
  const transcribed = TRANSCRIBED.filter((at) => elapsed >= at).length;
  return {
    projectType: written.projectType,
    headline: written.headline,
    basis: "model",
    updatedAt: Math.round(now - (elapsed - written.at) * SPEED * 1000),
    current: written.covers === transcribed,
    sections: written.sections,
  };
}

/** Playback second at which the sample's architect photographs each prompt, in the order walked. */
const TAKEN: [at: number, sectionId: string, promptId: string][] = [
  [8, "back-patio", "wide-view"],
  [9.5, "back-patio", "cracked-concrete"],
  [11, "back-patio", "heaving-corner"],
  [17, "east-fence-line", "full-run"],
  [18.5, "east-fence-line", "juniper"],
  [20, "east-fence-line", "bed-soil"],
  [21.5, "irrigation", "valve-box"],
  [22.5, "gate-and-access", "gate"],
  [26.5, "side-yard", "length"],
  [28, "side-yard", "wet-ground"],
  [35, "side-yard", "house-wall"],
  [40, "back-patio", "patio-steps"],
];

/** The prompts photographed `seconds` into the playback. Photos are not part of sampleWalk(). */
export function sampleTakenAt(seconds: number): { sectionId: string; promptId: string }[] {
  return TAKEN.filter(([at]) => seconds >= at).map(([, sectionId, promptId]) => ({ sectionId, promptId }));
}
