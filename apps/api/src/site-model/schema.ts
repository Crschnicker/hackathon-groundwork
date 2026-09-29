// The structured site model the LLM extracts from a walkthrough transcript (user journey step 4).
// Every field is required-but-nullable so the same schema works with strict structured output.
import { z } from 'zod';

const sun = z.enum(['full_sun', 'part_sun', 'part_shade', 'full_shade']);
const slope = z.enum(['none', 'slight', 'moderate', 'steep']);
const drainage = z.enum(['good', 'fair', 'poor']);

export const measurementSchema = z.object({
  /** what was measured, e.g. "patio", "east fence line" */
  subject: z.string(),
  lengthFt: z.number().nullable(),
  widthFt: z.number().nullable(),
  areaSqFt: z.number().nullable(),
  /** the words the architect used, e.g. "about 20 by 15" */
  asSpoken: z.string().nullable(),
});

export const areaSchema = z.object({
  name: z.string(),
  existingFeatures: z.array(z.object({ feature: z.string(), condition: z.string().nullable() })),
  measurements: z.array(measurementSchema),
  conditions: z.object({
    sun: sun.nullable(),
    slope: slope.nullable(),
    drainage: drainage.nullable(),
    notes: z.string().nullable(),
  }),
  removals: z.array(z.object({ item: z.string(), quantity: z.number().nullable(), reason: z.string().nullable() })),
  proposedChanges: z.array(
    z.object({
      change: z.string(),
      category: z.enum(['removal', 'hardscape', 'plants', 'irrigation', 'drainage', 'lighting', 'other']),
      material: z.string().nullable(),
    }),
  ),
});

export const siteModelSchema = z.object({
  areas: z.array(areaSchema),
  clientPreferences: z.array(z.string()),
  /** gaps the architect must fill in during review, e.g. "no size given for the side yard" */
  missing: z.array(z.object({ area: z.string().nullable(), question: z.string() })),
});

export type SiteModel = z.infer<typeof siteModelSchema>;
