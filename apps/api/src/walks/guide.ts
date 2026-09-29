// The walk guide: what kind of job this walk is, and the sections of the property worth
// photographing, each with the photos to take and the things to measure or ask while standing
// there. It is rewritten from the whole transcript after every recording. What is already on
// the architect's screen keeps its id, title and place, because photos are taken against it.
import { z } from 'zod';
import { HttpError } from '../http.ts';
import { chatJson, type ChatResult } from '../llm/chat.ts';
import type { ProviderName } from '../llm/providers.ts';
import { logger } from '../logger.ts';
import type { SiteModel } from '../site-model/schema.ts';
import { save, stitchTranscript, type Walk } from './store.ts';

export interface GuidePhoto {
  /** Slug, unique within the section; never changes once issued. */
  id: string;
  /** What to photograph. */
  prompt: string;
  /** What the photo is for. */
  reason: string | null;
}

export interface GuideSection {
  /** Lower-case slug; never changes once issued for a walk. */
  id: string;
  title: string;
  /** 'heard': the architect talked about it. 'suggested': this kind of job usually needs it. */
  source: 'heard' | 'suggested';
  /** For a suggested section, why this job needs it; null for a heard one. */
  why: string | null;
  photos: GuidePhoto[];
  /** Things to measure or ask on the spot. */
  ask: string[];
}

export interface WalkGuide {
  projectType: string;
  headline: string;
  /** 'model': written by the language model. 'rules': derived from the site model when that call failed. */
  basis: 'model' | 'rules';
  updatedAt: number;
  /** False while newer transcripts exist than the ones this guide was written from. */
  current: boolean;
  sections: GuideSection[];
}

const MAX_SECTIONS = 12;
const MAX_SUGGESTED = 3;
const MAX_PHOTOS = 4;
const MAX_ASKS = 3;
const MAX_PROMPT_CHARS = 60;
const MAX_REASON_CHARS = 90;
const MAX_ASK_CHARS = 90;
const MAX_TITLE_CHARS = 40;
const MAX_TYPE_CHARS = 40;
const MAX_HEADLINE_CHARS = 140;
const MAX_WHY_CHARS = 140;
const MAX_ID_CHARS = 40;
const UNKNOWN_TYPE = 'Site walk';

/** Shorter than this is a cough or a greeting (the same floor the site model uses). */
const MIN_TRANSCRIPT_CHARS = 20;
/** The guide is rewritten after every recording, so it goes to the fast provider first, as the live site model does. */
const GUIDE_PROVIDER: ProviderName = 'crusoe';
const GUIDE_TIMEOUT_MS = 45_000;

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60);

/** The guide as the contract has it; used to check a guide a client sends back. */
export const walkGuideSchema: z.ZodType<WalkGuide> = z.object({
  projectType: z.string().trim().min(1).max(MAX_TYPE_CHARS),
  headline: z.string().trim().max(MAX_HEADLINE_CHARS),
  basis: z.enum(['model', 'rules']),
  updatedAt: z.number(),
  current: z.boolean(),
  sections: z
    .array(
      z.object({
        id: slugSchema,
        title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
        source: z.enum(['heard', 'suggested']),
        why: z.string().trim().max(MAX_WHY_CHARS).nullable(),
        photos: z
          .array(
            z.object({
              id: slugSchema,
              prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS),
              reason: z.string().trim().max(MAX_REASON_CHARS).nullable(),
            }),
          )
          .min(1)
          .max(MAX_PHOTOS),
        ask: z.array(z.string().trim().min(1).max(MAX_ASK_CHARS)).max(MAX_ASKS),
      }),
    )
    .max(MAX_SECTIONS),
});

// What the language model returns. No limits here: every field is required-but-nullable so the
// schema works with strict structured output, and the limits are applied in code afterwards.
const draftSchema = z.object({
  projectType: z.string(),
  headline: z.string(),
  sections: z.array(
    z.object({
      id: z.string().nullable(),
      title: z.string(),
      source: z.enum(['heard', 'suggested']),
      why: z.string().nullable(),
      photos: z.array(z.object({ id: z.string().nullable(), prompt: z.string(), reason: z.string().nullable() })),
      ask: z.array(z.string()),
    }),
  ),
});

type Draft = z.infer<typeof draftSchema>;
type DraftSection = Draft['sections'][number];
type DraftPhoto = DraftSection['photos'][number];

const SYSTEM = `You are the assistant of an experienced landscape estimator. You are walking a client's property beside the landscape architect, who wears a recorder and talks through the site. From everything said so far you keep the guide for this walk on the architect's phone: the sections of the property to photograph, the photos to take in each, and what to measure or ask while standing there. The estimator prices the job later from these photos and answers, so think about what the estimator will wish had been captured. The architect reads the guide between sentences: every line is short, concrete and about THIS property.

Job type
- "projectType": what kind of job this is, from what was said, in two to four plain words, sentence case. Examples: "Backyard remodel", "New front yard", "Irrigation repair", "Drainage fix", "Patio replacement".
- If it is too early to tell, use "Site walk".
- "headline": one sentence, at most 120 characters, on what this walk is about, in the architect's own terms.

Heard sections
- One section per part of the property or topic the architect has talked about, in the order they came up, with source "heard" and why null.
- Title it the way the architect named the place or topic, in two to four words, sentence case: "Back patio", "Fence line border", "Side yard", "Front lawn". Never the client's name or the address.
- Keep one place in one section. Something to be removed or repaired that came up while the architect was talking about a place is a close-up in that place's section, not a section of its own.
- No section for small talk or for something mentioned only in passing.

Photos (1 to 4 per section)
- The first photo of a section is the wide shot, with id "wide-view": the whole section, framed so the same shot can be taken again after the work for a before-and-after pair. Say where to stand or what to get in frame, using what was said about the place.
- Then close-ups of what the architect SAID is to be removed, repaired, replaced or measured: the cracked concrete, the dying juniper, the wet ground in the side yard. Where size matters for the price, ask for something for scale in the shot, such as a tape or a boot.
- "prompt": what to photograph, at most 55 characters, starting with the subject. Not "Take a photo of".
- "reason": what the photo is for, at most 80 characters, for example "Shows the estimator how much has to come out".
- Never generic filler such as "Photos of the area" or "General condition". When nothing specific was said about a section, the wide shot alone is enough.

Ask (0 to 3 per section)
- What the estimator needs before pricing and has NOT been said: a missing dimension, a depth or thickness, a quantity, access, where the water goes, who owns the fence.
- Use the site model's "missing" questions for that area, reworded as something to measure or ask on the spot: "Measure the fence line border, length and depth", "Ask who owns the back fence".
- One thing per line, each at most 80 characters. When there are more than three, keep the three that move the price most.
- Leave out anything the architect has already answered.

Suggested sections (at most 3 in the whole guide)
- Sections this kind of job genuinely needs and the walk has not covered yet, with source "suggested". They come after the heard sections.
- "why": one short sentence, at most 120 characters, tied to THIS job, said the way you would say it walking beside the architect: "The flagstone and base rock come through the side gate, so its width decides the equipment."
- Choose by the kind of job and by where the work is, and pick the ones that would change the price or the plan most. The kind of thing that fits:
  - Work in a backyard: everything has to get there from the street, so access for materials and equipment comes first (gate width, the path in, what gets crossed). Then where downspouts and low spots send water; utilities, meters and cleanouts near the digging; the property line along a fence that is being touched; the water source and irrigation controller when planting or irrigation is part of the job.
  - Work in a front yard: the work is open to the street and meets what the city owns, so access is rarely the question. What fits is the view of the house from the street; the parking strip and the sidewalk edge, where the work stops and the curb begins; the path to the front door; the city tree; the water meter and shutoff box, which usually sit where the digging happens; the driveway edge.
  - Irrigation work: the controller and its zones; the backflow preventer and main shutoff; the water meter; the valve boxes; water pressure at a hose bib.
- Never suggest something the architect has already covered, even briefly or under another name. Leave out from the lists above whatever has come up.
- A suggested section has photos and ask like any other, specific to this job.
- While the job type is still "Site walk", suggest nothing.

Keeping the guide steady
- The architect is taking photos against the guide on screen. When a current guide is given, return every section in it with the same id and title, in the same order, and every photo in it with the same id. Copy the wording unchanged unless something said later changes the facts.
- You may add photos to a section that has fewer than 4, and update its ask list as questions get answered.
- Add new heard sections after the existing heard ones. For a new section or photo, id is a short lower-case slug with hyphens, such as "back-patio" or "cracked-concrete".
- A suggested section the architect has since talked about becomes "heard", keeps its id and title, and its why becomes null.

Honesty
- Only what was said, or what the job type implies. Never invent measurements, plants, materials or client wishes.
- The transcript comes from speech recognition, so expect misheard words. "[part of the recording is not transcribed yet]" marks a gap.`;

function describe(err: unknown): string {
  if (err instanceof HttpError && err.details !== undefined) {
    return `${err.message}: ${typeof err.details === 'string' ? err.details : JSON.stringify(err.details)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function slugify(text: string, fallback = ''): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ID_CHARS)
    .replace(/-+$/, '');
  return slug || fallback;
}

/** The slug itself, or the slug with the first free number after it. */
function unique(slug: string, taken: Set<string>): string {
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}-${n}`;
  taken.add(id);
  return id;
}

/** One line, cut at a word boundary when it is too long. */
function clip(text: string | null | undefined, max: number): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max / 2 ? cut.slice(0, space) : clean.slice(0, max)).replace(/[\s,;:(-]+$/, '');
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Back patio" → "back patio", for use inside a sentence; "AC unit" is left alone. */
function midSentence(text: string): string {
  const name = text.replace(/^the\s+/i, '');
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

const FILLER_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'for', 'to', 'area']);

/** The words of a title that carry its meaning, for telling whether two titles name the same thing. */
function topicWords(title: string): string[] {
  return slugify(title)
    .split('-')
    .filter((w) => w && !FILLER_WORDS.has(w));
}

function sameTopic(a: string, b: string): boolean {
  const wa = topicWords(a);
  const wb = new Set(topicWords(b));
  return wa.length > 0 && wa.length === wb.size && wa.every((w) => wb.has(w));
}

/** Whether a heard section already takes in what a suggested title names ("Side yard drainage" covers "Drainage"). */
function covers(heardTitle: string, suggestedTitle: string): boolean {
  const heard = new Set(topicWords(heardTitle));
  const suggested = topicWords(suggestedTitle);
  return suggested.length > 0 && suggested.every((w) => heard.has(w));
}

/** Prompts that would fit any property say nothing to the architect. */
const GENERIC_PROMPT = /^(take\s+)?(some\s+|a\s+few\s+)?(general\s+)?(photos?|pictures?|shots?)\s+of\s+(the\s+)?(whole\s+)?(area|site|yard|property|section)\.?$/i;

function cleanPhoto(photo: DraftPhoto): DraftPhoto | null {
  const prompt = sentenceCase(clip(photo.prompt.replace(/^take\s+(a\s+)?(photo|picture)s?\s+of\s+/i, ''), MAX_PROMPT_CHARS));
  if (!prompt || GENERIC_PROMPT.test(prompt)) return null;
  return { id: photo.id, prompt, reason: clip(photo.reason, MAX_REASON_CHARS) || null };
}

function cleanAsks(asks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ask of asks) {
    const text = sentenceCase(clip(ask, MAX_ASK_CHARS));
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length === MAX_ASKS) break;
  }
  return out;
}

/**
 * Photos already in the section keep their id and place; the draft may reword one it returns
 * under the same id, and its new photos follow until the section is full.
 */
function mergePhotos(previous: GuidePhoto[], drafts: DraftPhoto[]): GuidePhoto[] {
  const cleaned = drafts.map(cleanPhoto).filter((p) => p !== null);
  const matched = new Set<DraftPhoto>();
  const photos = previous.slice(0, MAX_PHOTOS).map((prev): GuidePhoto => {
    const draft = cleaned.find((d) => !matched.has(d) && slugify(d.id ?? '') === prev.id);
    if (!draft) return prev;
    matched.add(draft);
    return { id: prev.id, prompt: draft.prompt, reason: draft.reason ?? prev.reason };
  });

  const taken = new Set(photos.map((p) => p.id));
  const prompts = new Set(photos.map((p) => p.prompt.toLowerCase()));
  for (const draft of cleaned) {
    if (photos.length >= MAX_PHOTOS) break;
    if (matched.has(draft) || prompts.has(draft.prompt.toLowerCase())) continue;
    prompts.add(draft.prompt.toLowerCase());
    photos.push({ id: unique(slugify(draft.id || draft.prompt, 'photo'), taken), prompt: draft.prompt, reason: draft.reason });
  }
  return photos;
}

function mergeSection(prev: GuideSection, draft: DraftSection | undefined): GuideSection {
  if (!draft) return prev;
  // Once heard, always heard: the architect did talk about it.
  const source = prev.source === 'heard' || draft.source === 'heard' ? 'heard' : 'suggested';
  return {
    id: prev.id,
    title: prev.title,
    source,
    why: source === 'suggested' ? clip(draft.why, MAX_WHY_CHARS) || prev.why : null,
    photos: mergePhotos(prev.photos, draft.photos),
    ask: cleanAsks(draft.ask),
  };
}

/**
 * Turn a draft into the guide, holding it to the rules whether or not the draft obeyed them:
 * everything in the previous guide keeps its id, title and order; new heard sections follow
 * the heard ones and new suggestions go last; the limits apply.
 * `photographed` holds the ids of sections that already have photos, which are never dropped.
 */
function assemble(draft: Draft, previous: WalkGuide | null, basis: WalkGuide['basis'], photographed: ReadonlySet<string>): WalkGuide {
  const kept = previous?.sections ?? [];
  const drafts = draft.sections
    .map((s) => ({ ...s, title: sentenceCase(clip(s.title, MAX_TITLE_CHARS)) }))
    .filter((s) => s.title);

  // Pair each section already in the guide with the draft's version of it: by id, then by title.
  const pairs = new Map<string, DraftSection>();
  const paired = new Set<DraftSection>();
  const pair = (matches: (d: DraftSection, prev: GuideSection) => boolean) => {
    for (const prev of kept) {
      if (pairs.has(prev.id)) continue;
      const found = drafts.find((d) => !paired.has(d) && matches(d, prev));
      if (!found) continue;
      pairs.set(prev.id, found);
      paired.add(found);
    }
  };
  pair((d, prev) => slugify(d.id ?? '') === prev.id);
  pair((d, prev) => sameTopic(d.title, prev.title));

  const sections = kept.map((prev) => mergeSection(prev, pairs.get(prev.id)));
  const ids = new Set(sections.map((s) => s.id));
  const added = new Set<string>();

  const fresh = drafts
    .filter((d) => !paired.has(d))
    .map((d): GuideSection => ({
      id: '',
      title: d.title,
      source: d.source,
      why: d.source === 'suggested' ? clip(d.why, MAX_WHY_CHARS) || null : null,
      photos: mergePhotos([], d.photos),
      ask: cleanAsks(d.ask),
    }))
    .filter((s) => s.photos.length > 0);

  const issue = (section: GuideSection): GuideSection => {
    section.id = unique(slugify(section.title, 'section'), ids);
    added.add(section.id);
    return section;
  };

  const heard = fresh.filter((s) => s.source === 'heard' && !sections.some((x) => sameTopic(x.title, s.title))).map(issue);
  let lastHeard = -1;
  sections.forEach((s, i) => {
    if (s.source === 'heard') lastHeard = i;
  });
  sections.splice(lastHeard + 1, 0, ...heard);

  let suggested = sections.filter((s) => s.source === 'suggested').length;
  for (const section of fresh) {
    if (section.source !== 'suggested' || suggested >= MAX_SUGGESTED) continue;
    // A suggestion needs its reason, and must not repeat what is already in the guide.
    if (!section.why) continue;
    if (sections.some((x) => sameTopic(x.title, section.title) || (x.source === 'heard' && covers(x.title, section.title)))) continue;
    sections.push(issue(section));
    suggested++;
  }

  // Over the limit, what goes first is what the architect will miss least: new suggestions,
  // then older suggestions nobody has photographed, then the newest heard sections.
  const droppable: ((s: GuideSection) => boolean)[] = [
    (s) => s.source === 'suggested' && added.has(s.id),
    (s) => s.source === 'suggested' && !photographed.has(s.id),
    (s) => added.has(s.id),
  ];
  for (const canDrop of droppable) {
    for (let i = sections.length - 1; i >= 0 && sections.length > MAX_SECTIONS; i--) {
      if (canDrop(sections[i]!)) sections.splice(i, 1);
    }
  }

  const draftType = sentenceCase(clip(draft.projectType, MAX_TYPE_CHARS));
  // A job type already on screen is not taken back to "Site walk".
  const projectType = draftType && !(draftType === UNKNOWN_TYPE && previous) ? draftType : (previous?.projectType ?? UNKNOWN_TYPE);

  return {
    projectType,
    headline: clip(draft.headline, MAX_HEADLINE_CHARS) || previous?.headline || '',
    basis,
    updatedAt: Date.now(),
    current: true,
    sections: sections.slice(0, MAX_SECTIONS),
  };
}

export interface GuideInput {
  /** Everything said on the walk so far. */
  transcript: string;
  siteModel: SiteModel | null;
  /** The guide on the architect's screen now, if there is one. */
  previous?: WalkGuide | null;
  /** Ids of sections that already have photos taken against them. */
  photographed?: Iterable<string>;
}

/** Ask the language model for the guide. Throws when no provider answers; see guideFromSiteModel. */
export async function generateGuide(input: GuideInput): Promise<{ guide: WalkGuide; meta: Omit<ChatResult, 'content'> }> {
  const previous = input.previous ?? null;
  const onScreen = previous
    ? JSON.stringify({
        projectType: previous.projectType,
        sections: previous.sections.map(({ id, title, source, why, photos, ask }) => ({ id, title, source, why, photos, ask })),
      })
    : 'None yet. This is the first guide for this walk.';
  const { data, meta } = await chatJson({
    schema: draftSchema,
    schemaName: 'walk_guide',
    prefer: GUIDE_PROVIDER,
    temperature: 0.2,
    maxTokens: 4000,
    timeoutMs: GUIDE_TIMEOUT_MS,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          `Site model so far:\n${input.siteModel ? JSON.stringify(input.siteModel) : 'Not available.'}`,
          `Current guide on the architect's screen:\n${onScreen}`,
          `Transcript so far:\n"""\n${input.transcript}\n"""`,
        ].join('\n\n'),
      },
    ],
  });
  return { guide: assemble(data, previous, 'model', new Set(input.photographed ?? [])), meta };
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The guide derived by rule from the site model, for when the language model cannot be reached.
 * One section per area: a wide view, a close-up of each feature whose condition was noted, a
 * photo of each removal, and the area's questions to confirm.
 */
export function guideFromSiteModel(siteModel: SiteModel, previous: WalkGuide | null = null, photographed: Iterable<string> = []): WalkGuide {
  const sameArea = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const areas = siteModel.areas.filter((area) => area.name.trim());

  const draft: Draft = {
    // The rules cannot tell what kind of job it is; assemble keeps a type the model gave earlier.
    projectType: UNKNOWN_TYPE,
    headline: previous?.headline || (areas.length > 0 ? `Walk of the ${listNames(areas.map((a) => midSentence(a.name.trim())))}` : ''),
    sections: areas.map((area) => ({
      id: slugify(area.name),
      title: area.name,
      source: 'heard' as const,
      why: null,
      photos: [
        { id: 'wide-view', prompt: `Wide view of the ${midSentence(area.name.trim())}`, reason: 'A before shot to set beside the finished work' },
        ...area.existingFeatures
          .filter((f) => f.condition?.trim())
          .map((f) => ({ id: slugify(f.feature), prompt: `${f.feature}, close up`, reason: sentenceCase(f.condition ?? '') })),
        ...area.removals.map((r) => ({
          id: slugify(`${r.item} removal`),
          prompt: `${r.item} to be removed`,
          reason: r.reason?.trim() ? sentenceCase(r.reason) : 'Shows the estimator what has to come out',
        })),
      ],
      ask: siteModel.missing.filter((m) => m.area !== null && sameArea(m.area, area.name)).map((m) => m.question),
    })),
  };
  return assemble(draft, previous, 'rules', new Set(photographed));
}

/** Whether the guide was written from exactly these recordings (as returned by stitchTranscript). */
export function guideCovers(walk: Walk, chunkKeys: string[]): boolean {
  const covered = walk.guideChunkKeys ?? [];
  return Boolean(walk.guide) && chunkKeys.length === covered.length && chunkKeys.every((k, i) => k === covered[i]);
}

// One guide run per walk at a time. Recordings that finish while one is running mark the walk
// dirty, and a single follow-up run then covers all of them.
const guiding = new Map<string, { dirty: boolean }>();

export function isGuiding(walkId: string): boolean {
  return guiding.has(walkId);
}

/** The guide as the walk endpoints return it: null until there is one. */
export function guideView(walk: Walk, chunkKeys: string[]): WalkGuide | null {
  if (!walk.guide) return null;
  return { ...walk.guide, current: !isGuiding(walk.id) && guideCovers(walk, chunkKeys) };
}

/** Bring the walk's guide up to date with its transcript, in the background. Never throws. */
export function scheduleGuide(walk: Walk): void {
  const running = guiding.get(walk.id);
  if (running) {
    running.dirty = true;
    return;
  }
  const state = { dirty: false };
  guiding.set(walk.id, state);

  void (async () => {
    try {
      do {
        state.dirty = false;
        const { transcript, chunkKeys } = stitchTranscript(walk);
        if (transcript.length < MIN_TRANSCRIPT_CHARS) continue;
        if (guideCovers(walk, chunkKeys)) continue;
        // Marks the walk as one with a guide on the way, so a restart knows to pick it up.
        walk.guideChunkKeys ??= [];
        save();

        const previous = walk.guide ?? null;
        const photographed = (walk.photos ?? []).flatMap((p) => (p.sectionId ? [p.sectionId] : []));
        let guide: WalkGuide | null = null;
        try {
          const result = await generateGuide({ transcript, siteModel: walk.siteModel, previous, photographed });
          guide = result.guide;
          logger.info(
            { walkId: walk.id, provider: result.meta.provider, recordings: chunkKeys.length, sections: guide.sections.length, projectType: guide.projectType, ms: result.meta.latencyMs },
            'Walk guide updated',
          );
        } catch (err) {
          const reason = describe(err);
          if (walk.siteModel) {
            guide = guideFromSiteModel(walk.siteModel, previous, photographed);
            logger.warn({ walkId: walk.id, err: reason, sections: guide.sections.length }, 'Walk guide written by rule; the language model call failed');
          } else {
            logger.error({ walkId: walk.id, err: reason }, 'Walk guide failed and there is no site model to fall back on');
          }
        }
        // An empty first guide is no better than none, and leaving it unset lets the next run try again.
        if (guide && (guide.sections.length > 0 || previous)) {
          walk.guide = guide;
          walk.guideChunkKeys = chunkKeys;
        }
        save();
      } while (state.dirty);
    } catch (err) {
      logger.error({ walkId: walk.id, err: describe(err) }, 'Walk guide run failed');
    } finally {
      guiding.delete(walk.id);
    }
  })();
}
