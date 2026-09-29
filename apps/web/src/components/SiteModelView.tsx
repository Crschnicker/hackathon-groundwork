"use client";

// The site model: what Groundwork understood from a walk, area by area, with what it still
// needs to know kept beside the area it belongs to. Used for a pasted walkthrough and for a
// walk recorded on the phone.
import { useState } from "react";
import type { OpenQuestion, SiteArea, SiteModel } from "@/lib/api";
import { plural } from "@/components/ui";

const SUN: Record<string, string> = {
  full_sun: "Full sun",
  part_sun: "Part sun",
  part_shade: "Part shade",
  full_shade: "Full shade",
};

const CATEGORY: Record<string, string> = {
  removal: "Removal",
  hardscape: "Hardscape",
  plants: "Planting",
  irrigation: "Irrigation",
  drainage: "Drainage",
  lighting: "Lighting",
  other: "Other",
};

const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const same = (a: string | null, b: string) => (a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

/** "20 × 15 ft · 300 sq ft", "40 ft", "1,200 sq ft", or null when no number was given. */
export function formatMeasurement(m: SiteArea["measurements"][number]): string | null {
  const parts: string[] = [];
  if (m.lengthFt !== null && m.widthFt !== null) parts.push(`${number(m.lengthFt)} × ${number(m.widthFt)} ft`);
  else if (m.lengthFt !== null) parts.push(`${number(m.lengthFt)} ft`);
  else if (m.widthFt !== null) parts.push(`${number(m.widthFt)} ft wide`);
  if (m.areaSqFt !== null) parts.push(`${number(m.areaSqFt)} sq ft`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function countSiteModel(model: SiteModel) {
  return {
    areas: model.areas.length,
    measurements: model.areas.reduce((n, a) => n + a.measurements.filter((m) => formatMeasurement(m)).length, 0),
    removals: model.areas.reduce((n, a) => n + a.removals.length, 0),
    changes: model.areas.reduce((n, a) => n + proposedFor(a).length, 0),
    questions: model.missing.length,
  };
}

/** One line saying what was understood, before anything that is still unknown. */
export function summarizeSiteModel(model: SiteModel): string {
  const c = countSiteModel(model);
  const understood = [
    plural(c.areas, "area"),
    c.measurements > 0 && plural(c.measurements, "measurement"),
    c.removals > 0 && plural(c.removals, "removal"),
    c.changes > 0 && plural(c.changes, "proposed change"),
  ].filter(Boolean);
  return `${understood.join(", ")}. ${c.questions === 0 ? "Nothing left to confirm." : `${c.questions} to confirm.`}`;
}

/** A removal is listed under Remove; the matching "removal" change would say it twice. */
function proposedFor(area: SiteArea) {
  return area.removals.length > 0 ? area.proposedChanges.filter((c) => c.category !== "removal") : area.proposedChanges;
}

function Question({
  question,
  onAnswer,
}: {
  question: OpenQuestion;
  onAnswer?: (question: OpenQuestion, answer: string) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [open, setOpen] = useState(false);
  const id = `q-${question.area ?? "site"}-${question.question}`.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return (
    <li className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-confirm">{question.question}</p>
        {onAnswer && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-my-2 min-h-11 shrink-0 text-sm font-medium text-confirm underline underline-offset-4"
          >
            Answer
          </button>
        )}
      </div>
      {onAnswer && open && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!answer.trim()) return;
            onAnswer(question, answer.trim());
            setAnswer("");
            setOpen(false);
          }}
        >
          <label htmlFor={id} className="sr-only">
            Answer: {question.question}
          </label>
          <input
            id={id}
            autoFocus
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Say it the way you would on site"
            className="control flex-1"
          />
          <button
            type="submit"
            disabled={!answer.trim()}
            className="min-h-11 rounded-lg bg-confirm px-4 text-sm font-medium text-white disabled:bg-sunken disabled:text-ink-3"
          >
            Add to the walkthrough
          </button>
        </form>
      )}
    </li>
  );
}

function Row({ label, tone = "ink", children }: { label: string; tone?: "ink" | "danger" | "brand"; children: React.ReactNode }) {
  const tones = { ink: "text-ink-3", danger: "text-danger", brand: "text-brand" };
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-x-4 py-2">
      <dt className={`text-xs font-medium ${tones[tone]}`}>{label}</dt>
      <dd className="min-w-0 space-y-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Area({
  area,
  questions,
  onAnswer,
}: {
  area: SiteArea;
  questions: OpenQuestion[];
  onAnswer?: (question: OpenQuestion, answer: string) => void;
}) {
  const conditions = [
    area.conditions.sun && (SUN[area.conditions.sun] ?? sentence(area.conditions.sun.replaceAll("_", " "))),
    area.conditions.slope && (area.conditions.slope === "none" ? "Level" : `${sentence(area.conditions.slope)} slope`),
    area.conditions.drainage && `${sentence(area.conditions.drainage)} drainage`,
  ].filter(Boolean);
  const proposed = proposedFor(area);
  const measured = area.measurements.map((m) => ({ m, text: formatMeasurement(m) }));
  const lead = measured.find((x) => x.text);
  const nothing =
    area.measurements.length + area.existingFeatures.length + area.removals.length + proposed.length + conditions.length ===
      0 && !area.conditions.notes;

  return (
    <li className="settle grid gap-x-8 gap-y-3 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,15rem)_1fr]">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold tracking-tight text-ink">{sentence(area.name)}</h3>
        {lead ? (
          <p className="text-xl font-medium tabular-nums tracking-tight text-ink">{lead.text}</p>
        ) : (
          <p className="text-sm text-confirm">No size given yet</p>
        )}
        {lead?.m.asSpoken && <p className="text-sm text-ink-3">Said: &ldquo;{lead.m.asSpoken}&rdquo;</p>}
        {conditions.length > 0 && <p className="text-sm text-ink-2">{conditions.join(" · ")}</p>}
      </div>

      <div className="min-w-0">
        {nothing ? (
          <p className="py-2 text-sm text-ink-3">Named on the walk, with no details yet.</p>
        ) : (
          <dl className="divide-y divide-line">
            {measured.filter((x) => x !== lead).length > 0 && (
              <Row label="Also measured">
                {measured
                  .filter((x) => x !== lead)
                  .map(({ m, text }, i) => (
                    <p key={i}>
                      {sentence(m.subject)}: <span className="tabular-nums">{text ?? "no size given"}</span>
                      {m.asSpoken && <span className="text-ink-3"> · said &ldquo;{m.asSpoken}&rdquo;</span>}
                    </p>
                  ))}
              </Row>
            )}
            {area.existingFeatures.length > 0 && (
              <Row label="There now">
                {area.existingFeatures.map((f, i) => (
                  <p key={i}>
                    {sentence(f.feature)}
                    {f.condition && <span className="text-ink-2">, {f.condition.toLowerCase()}</span>}
                  </p>
                ))}
              </Row>
            )}
            {area.conditions.notes && (
              <Row label="Site notes">
                <p>{sentence(area.conditions.notes)}</p>
              </Row>
            )}
            {area.removals.length > 0 && (
              <Row label="Remove" tone="danger">
                {area.removals.map((r, i) => (
                  <p key={i}>
                    {r.quantity !== null && <span className="tabular-nums">{number(r.quantity)} × </span>}
                    {sentence(r.item)}
                    {r.reason && <span className="text-ink-2">, {r.reason.toLowerCase()}</span>}
                  </p>
                ))}
              </Row>
            )}
            {proposed.length > 0 && (
              <Row label="Proposed" tone="brand">
                {proposed.map((c, i) => (
                  <p key={i}>
                    <span className="text-ink-2">{CATEGORY[c.category] ?? sentence(c.category)}: </span>
                    {sentence(c.change)}
                    {c.material && !c.change.toLowerCase().includes(c.material.toLowerCase()) && (
                      <span className="text-ink-2"> · {c.material}</span>
                    )}
                  </p>
                ))}
              </Row>
            )}
          </dl>
        )}

        {questions.length > 0 && (
          <div className="mt-3 rounded-lg border border-confirm-line bg-confirm-soft px-4 py-3">
            <h4 className="text-xs font-semibold text-confirm">To confirm</h4>
            <ul className="mt-2 space-y-3 text-sm">
              {questions.map((q, i) => (
                <Question key={`${i}-${q.question}`} question={q} onAnswer={onAnswer} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

export function SiteModelView({
  model,
  stale = false,
  onAnswer,
}: {
  model: SiteModel;
  /** A newer version is on its way; this one is shown dimmed until it lands. */
  stale?: boolean;
  /** When given, every open question can be answered in place. */
  onAnswer?: (question: OpenQuestion, answer: string) => void;
}) {
  const forArea = (area: SiteArea) => model.missing.filter((q) => same(q.area, area.name));
  const general = model.missing.filter((q) => !model.areas.some((a) => same(q.area, a.name)));

  return (
    <div aria-busy={stale} className={`space-y-4 transition-opacity duration-200 ${stale ? "opacity-60" : ""}`}>
      {model.areas.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          No areas yet. An area appears once the walkthrough names a part of the property, such as &ldquo;back
          patio&rdquo; or &ldquo;east fence line&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {model.areas.map((area, i) => (
            <Area key={`${i}-${area.name}`} area={area} questions={forArea(area)} onAnswer={onAnswer} />
          ))}
        </ul>
      )}

      {general.length > 0 && (
        <div className="rounded-lg border border-confirm-line bg-confirm-soft px-4 py-3 sm:px-6">
          <h3 className="text-xs font-semibold text-confirm">To confirm about the whole site</h3>
          <ul className="mt-2 space-y-3 text-sm">
            {general.map((q, i) => (
              <Question key={`${i}-${q.question}`} question={q} onAnswer={onAnswer} />
            ))}
          </ul>
        </div>
      )}

      {model.clientPreferences.length > 0 && (
        <div className="px-1">
          <h3 className="text-xs font-medium text-ink-3">What the client asked for</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink">
            {model.clientPreferences.map((p, i) => (
              <li key={i}>{sentence(p.replace(/[.;]+$/, ""))}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What the site model view looks like while the first version is being worked out. */
export function SiteModelSkeleton({ areas = 3 }: { areas?: number }) {
  return (
    <ul aria-hidden className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {Array.from({ length: areas }, (_, i) => (
        <li key={i} className="grid gap-x-8 gap-y-3 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,15rem)_1fr]">
          <div className="space-y-2">
            <div className="skeleton h-5 w-32" />
            <div className="skeleton h-6 w-40" />
          </div>
          <div className="space-y-3 py-1">
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-4 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}
