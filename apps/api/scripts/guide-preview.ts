// Try the walk guide from the command line. The transcript is fed to the generator in three
// growing parts, as recordings would arrive on a walk, and the guide is printed after each,
// with a line saying whether every id from the part before survived.
//
//   npm run guide:preview -- <text file | backyard | frontyard | irrigation> [--json] [--rules]
//
// --json prints the last guide as JSON as well; --rules skips the language model for the guide
// and shows what the rule-based fallback writes from the site model.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { extractSiteModel } from '../src/site-model/extract.ts';
import { generateGuide, guideFromSiteModel, type WalkGuide } from '../src/walks/guide.ts';

const SAMPLES: Record<string, string[]> = {
  backyard: [
    `Okay, we're in the backyard at the Henderson place. Starting at the back patio, right off the sliding door. It's the original concrete slab, broom finish, and it's cracked pretty badly. There's a big crack running diagonal from the door out toward the lawn, and the far corner has settled, I'd say an inch and a half, maybe two. So this all comes out. Slab's roughly twenty by fourteen. She wants flagstone, she said something warm, not gray, so I'm thinking a buff or a gold quartzite, dry laid on a compacted base. There's a downspout that dumps right on the corner of the slab, which is probably why it settled. The patio cover posts stay, so we're working around two posts.`,
    `Moving over to the back fence. There's a planting border along the fence line, maybe three feet deep, runs the whole length of the fence, call it forty five feet. It's got three junipers in it that are mostly dead, brown all the way through on the fence side, those come out. And a bunch of ivy climbing the fence, that has to go too, it's pulling the boards apart. The fence itself is cedar, leaning a little in the middle, and I don't know if it's theirs or the neighbor's. She wants something lower maintenance here, grasses, maybe some salvia, she likes purple. It gets sun most of the day, faces south. There's no irrigation in this bed that I can see, she's been hand watering.`,
    `Now the side yard, north side of the house. This is the problem area. It's wet. It's the end of summer and the ground is still soft, there's moss on the pavers. It's narrow, maybe five feet between the house and the fence. There are old concrete stepping pavers, twelve or so, sunk into the mud, those come out. Water's coming off the roof, there's a downspout here with no extension on it, and the grade pitches back toward the foundation. So I'm thinking a French drain down the length of it, daylight it out front toward the street, and then gravel over the top with new steppers. Need to figure out where that drain can discharge. And the AC unit is sitting right in the middle of the run, so we have to go around that.`,
  ],
  frontyard: [
    `All right, front yard at the Okafor house. This is basically a blank slate job. The whole front is lawn right now, it's tired, mostly brown, a lot of crabgrass, and they want it gone. They want out of mowing and they want the water bill down. So full lawn removal. It's about thirty feet across the front and maybe twenty two deep from the sidewalk to the house. There are spray heads in the lawn, old ones, I count six or seven, a couple of them are broken off. We'd cap those or convert to drip. It's pretty flat, slight fall toward the street. Full sun, west facing, it's going to bake in the afternoon.`,
    `The path to the front door. Right now you walk up the driveway and then cut across on this narrow concrete walk, it's maybe thirty inches wide, and it's heaved up where it meets the porch step, there's a trip edge there. They want a real front walk, straight from the sidewalk to the door. So a new path, I'm thinking four feet wide so two people can walk side by side. He mentioned pavers, something with a bit of color, and he wants low lights along it. The old walk comes out. The porch step is brick, that stays, so we need to meet that height.`,
    `Then along the street side, behind the sidewalk, they want a planting band so the house has some presence from the street. Low stuff near the sidewalk so it doesn't flop over, and then taller behind. He said natives, he said no roses, his words, and she wants something that flowers for the bees. I'm thinking manzanita, some yarrow, deer grass, a couple of boulders. There's one big shrub by the corner of the driveway, an old photinia, it's leggy and half dead, that comes out. Mulch over everything, drip irrigation. I don't know yet where the irrigation valves are, I haven't found the box.`,
  ],
  irrigation: [
    `Okay, this one's an irrigation call at the Delgado place. They've got a system, it's maybe fifteen years old, and half of it isn't working. Starting at the controller, it's in the garage. It's an old six station unit, the display is faded, and she says zone four never comes on. I ran it manually. Zones one through three come up, four is dead, five and six are weak. So could be a valve, could be a wire, could be pressure.`,
    `Out in the backyard lawn, that's zone two. There's a geyser, one head is snapped off at the riser right by the edge of the patio, probably the mower. And there are two heads sunk so low they're spraying into the grass, and one's tilted and watering the fence. Coverage is bad in the back corner, there's a dry brown patch maybe ten by ten. The heads are a mix, some rotors, some sprays, on the same zone, which is part of the problem.`,
    `Valve box. Found one by the side of the house, it's full of mud and the lid's cracked. Three valves in there, one's weeping, there's standing water in the box. I haven't found the second box, there should be another one for zones four through six, probably buried under the shrubs out front. And the drip line in the front planter, it's been chewed, there are breaks all along it. I'd replace that whole run, it's maybe forty feet. She also wants a rain sensor or a smart controller, she's tired of it running in the rain.`,
  ],
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    rules: { type: 'boolean', default: false },
  },
});

const input = positionals[0];
if (!input) {
  console.error(`Usage: npm run guide:preview -- <text file | ${Object.keys(SAMPLES).join(' | ')}> [--json] [--rules]`);
  process.exit(1);
}

/** Cut a transcript into three parts of about the same length, at sentence ends. */
function inThree(text: string): string[] {
  const sentences = text.replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const parts = ['', '', ''];
  let seen = 0;
  for (const sentence of sentences) {
    parts[Math.min(2, Math.floor((seen * 3) / text.length))] += sentence;
    seen += sentence.length;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

const parts = SAMPLES[input] ?? inThree(readFileSync(path.resolve(input), 'utf8'));

function print(guide: WalkGuide): void {
  console.log(`Job type: ${guide.projectType}   (written by ${guide.basis === 'model' ? 'the language model' : 'rule'})`);
  console.log(`About:    ${guide.headline}`);
  for (const section of guide.sections) {
    console.log(`\n  ${section.title}  [${section.id}]  ${section.source}`);
    if (section.why) console.log(`    Why: ${section.why}`);
    for (const photo of section.photos) {
      console.log(`    Photo [${photo.id}] ${photo.prompt}${photo.reason ? `\n          ${photo.reason}` : ''}`);
    }
    for (const ask of section.ask) console.log(`    To confirm: ${ask}`);
  }
}

/** Every section id, and every photo id as "section/photo". */
function idsOf(guide: WalkGuide): string[] {
  return guide.sections.flatMap((s) => [s.id, ...s.photos.map((p) => `${s.id}/${p.id}`)]);
}

/** Section ids in the order of the earlier guide, to show that nothing was reshuffled. */
function sameOrder(before: WalkGuide, after: WalkGuide): boolean {
  const kept = after.sections.map((s) => s.id).filter((id) => before.sections.some((s) => s.id === id));
  return kept.join() === before.sections.map((s) => s.id).join();
}

let guide: WalkGuide | null = null;
let failed = false;

for (const [i, part] of parts.entries()) {
  const transcript = parts.slice(0, i + 1).join(' ');
  console.log(`\n=== Part ${i + 1} of ${parts.length}: ${transcript.length} characters heard so far ===`);
  console.log(`New: "${part.slice(0, 90)}…"\n`);

  const started = Date.now();
  const { siteModel, meta: siteMeta } = await extractSiteModel(transcript, { prefer: 'crusoe' });
  const before: WalkGuide | null = guide;
  let by = 'rule';
  if (values.rules) {
    guide = guideFromSiteModel(siteModel, before);
  } else {
    try {
      const result = await generateGuide({ transcript, siteModel, previous: before });
      guide = result.guide;
      by = `${result.meta.model} in ${(result.meta.latencyMs / 1000).toFixed(1)}s`;
    } catch (err) {
      console.log(`The language model call failed (${err instanceof Error ? err.message : String(err)}); falling back to the rules.`);
      guide = guideFromSiteModel(siteModel, before);
    }
  }
  print(guide);
  console.log(`\nSite model by ${siteMeta.model}, guide by ${by}, ${((Date.now() - started) / 1000).toFixed(1)}s in all`);

  if (before) {
    const now = new Set(idsOf(guide));
    const lost = idsOf(before).filter((id) => !now.has(id));
    const order = sameOrder(before, guide) ? 'order kept' : 'ORDER CHANGED';
    if (lost.length > 0) failed = true;
    if (order !== 'order kept') failed = true;
    console.log(
      lost.length === 0
        ? `Ids: all ${idsOf(before).length} from part ${i} survived, ${order}`
        : `Ids: LOST from part ${i}: ${lost.join(', ')}; ${order}`,
    );
  }
}

if (values.json && guide) console.log(`\n${JSON.stringify(guide, null, 2)}`);
process.exit(failed ? 1 : 0);
