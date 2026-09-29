// Plain-text helpers for the walkthrough box: the site model as text an architect can paste
// into an email, answers written back into the walkthrough, and what is kept across a reload.
import type { OpenQuestion, SiteModel, SiteModelResult } from "@/lib/api";
import { formatMeasurement } from "@/components/SiteModelView";

export const SAMPLE_WALKTHROUGH =
  "Back patio, about 20 by 15, cracked concrete. Client wants flagstone. East fence line, 40 feet, full afternoon sun, pollinator border. Pull the dying juniper. Side yard is mostly shade and stays wet after rain, they'd like a gravel path through it.";

/** The server refuses anything shorter. */
export const MIN_WALKTHROUGH_LENGTH = 20;

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

const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const count = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** The site model as readable text: each area, then the list to confirm. */
export function siteModelToText(model: SiteModel): string {
  const lines: string[] = ["Site model from the walkthrough", ""];

  if (model.areas.length === 0) lines.push("No areas were named.", "");

  for (const area of model.areas) {
    lines.push(sentence(area.name).toUpperCase());

    for (const m of area.measurements) {
      const size = formatMeasurement(m);
      const spoken = m.asSpoken ? ` (said "${m.asSpoken}")` : "";
      lines.push(`  Size, ${m.subject}: ${size ?? "not given"}${spoken}`);
    }

    const conditions = [
      area.conditions.sun && (SUN[area.conditions.sun] ?? sentence(area.conditions.sun.replaceAll("_", " "))),
      area.conditions.slope && (area.conditions.slope === "none" ? "Level" : `${sentence(area.conditions.slope)} slope`),
      area.conditions.drainage && `${sentence(area.conditions.drainage)} drainage`,
    ].filter(Boolean);
    if (conditions.length > 0) lines.push(`  Conditions: ${conditions.join(", ")}`);
    if (area.conditions.notes) lines.push(`  Site notes: ${sentence(area.conditions.notes)}`);

    if (area.existingFeatures.length > 0) {
      lines.push("  There now:");
      for (const f of area.existingFeatures) {
        lines.push(`    - ${sentence(f.feature)}${f.condition ? `, ${f.condition.toLowerCase()}` : ""}`);
      }
    }

    if (area.removals.length > 0) {
      lines.push("  Remove:");
      for (const r of area.removals) {
        const quantity = r.quantity !== null ? `${count(r.quantity)} x ` : "";
        lines.push(`    - ${quantity}${sentence(r.item)}${r.reason ? `, ${r.reason.toLowerCase()}` : ""}`);
      }
    }

    // A removal is already listed under Remove; the matching change would say it twice.
    const proposed =
      area.removals.length > 0 ? area.proposedChanges.filter((c) => c.category !== "removal") : area.proposedChanges;
    if (proposed.length > 0) {
      lines.push("  Proposed:");
      for (const c of proposed) {
        const material =
          c.material && !c.change.toLowerCase().includes(c.material.toLowerCase()) ? ` (${c.material})` : "";
        lines.push(`    - ${CATEGORY[c.category] ?? sentence(c.category)}: ${sentence(c.change)}${material}`);
      }
    }

    lines.push("");
  }

  if (model.clientPreferences.length > 0) {
    lines.push("WHAT THE CLIENT ASKED FOR");
    for (const p of model.clientPreferences) lines.push(`  - ${sentence(p.replace(/[.;]+$/, ""))}`);
    lines.push("");
  }

  lines.push("TO CONFIRM");
  if (model.missing.length === 0) lines.push("  Nothing left to confirm.");
  for (const q of model.missing) lines.push(`  - ${q.area ? `${sentence(q.area)}: ` : ""}${q.question}`);

  return lines.join("\n");
}

/** Adds an answer to the walkthrough as its own sentence: "Back patio: the old concrete comes out." */
export function appendAnswer(walkthrough: string, question: OpenQuestion, answer: string): string {
  const said = answer.trim();
  const closed = /[.!?]$/.test(said) ? said : `${said}.`;
  const added = question.area ? `${sentence(question.area.trim())}: ${closed}` : sentence(closed);

  const before = walkthrough.trimEnd();
  if (!before) return added;
  return `${before}${/[.!?]$/.test(before) ? "" : "."} ${added}`;
}

// What survives a reload, for as long as the tab is open.
const STORAGE_KEY = "groundwork.walkthrough";

export interface SavedWalkthrough {
  text: string;
  result: SiteModelResult | null;
  /** Answers added to the text since the result was read. */
  answers: number;
}

function isResult(value: unknown): value is SiteModelResult {
  const r = value as SiteModelResult | null;
  return (
    !!r &&
    typeof r === "object" &&
    !!r.siteModel &&
    Array.isArray(r.siteModel.areas) &&
    Array.isArray(r.siteModel.missing) &&
    Array.isArray(r.siteModel.clientPreferences) &&
    !!r.meta &&
    typeof r.meta.model === "string"
  );
}

export function loadSaved(): SavedWalkthrough | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<SavedWalkthrough> | null;
    if (!saved || typeof saved.text !== "string") return null;
    return {
      text: saved.text,
      result: isResult(saved.result) ? saved.result : null,
      answers: typeof saved.answers === "number" && saved.answers > 0 ? Math.floor(saved.answers) : 0,
    };
  } catch {
    // Storage is blocked or holds something unreadable: start from the sample.
    return null;
  }
}

export function save(saved: SavedWalkthrough): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage is blocked or full: the walkthrough lasts until the page is reloaded.
  }
}
