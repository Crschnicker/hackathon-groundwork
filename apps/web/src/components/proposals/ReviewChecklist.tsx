"use client";

// "Before you send": the review step. It checks the proposal the way the client will read it and
// points at what is missing. Who it is for, a price on every line and the open questions must be
// settled before it can be sent; a photo for every area is advice only.
import type { ReactNode } from "react";
import type { OpenQuestion, ProposalEdit, WalkPhoto } from "@/lib/api";
import { plural } from "@/components/ui";
import { lineAnchor, lineFieldId } from "./LineRow";
import { sectionAnchor } from "./SectionEditor";

export const CLIENT_NAME_FIELD = "proposal-client-name";
export const CLIENT_EMAIL_FIELD = "proposal-client-email";

const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());

interface LineRef {
  id: string;
  area: string;
  description: string;
  missing: string;
}

export interface Review {
  name: boolean;
  email: boolean;
  lineCount: number;
  unpriced: LineRef[];
  toConfirm: LineRef[];
  withoutPhotos: { id: string; area: string }[];
  /** How many of the must-dos are not done; the proposal can be sent at 0. */
  blocking: number;
}

export function reviewOf(edit: ProposalEdit, photos: WalkPhoto[]): Review {
  const photoIds = new Set(photos.map((p) => p.id));
  const unpriced: LineRef[] = [];
  const toConfirm: LineRef[] = [];
  let lineCount = 0;
  for (const section of edit.sections) {
    for (const line of section.lines) {
      lineCount++;
      const description = line.description.trim() || "Line with no description";
      const missing = [line.quantity === null && "quantity", line.unitPrice === null && "price"].filter(Boolean).join(" or ");
      if (missing) unpriced.push({ id: line.id, area: section.area, description, missing: `no ${missing}` });
      if (line.toConfirm) toConfirm.push({ id: line.id, area: section.area, description, missing: line.toConfirm });
    }
  }
  const withoutPhotos = edit.sections
    .filter((s) => !s.photoIds.some((id) => photoIds.has(id)))
    .map((s) => ({ id: s.id, area: s.area }));
  const name = edit.client.name.trim() !== "";
  const email = looksLikeEmail(edit.client.email);
  const blocking =
    (name ? 0 : 1) + (email ? 0 : 1) + (lineCount === 0 ? 1 : 0) + (unpriced.length > 0 ? 1 : 0) + (edit.openQuestions.length > 0 ? 1 : 0);
  return { name, email, lineCount, unpriced, toConfirm, withoutPhotos, blocking };
}

/** Puts the cursor in a field further up the page, and brings it into view. */
function jump(fieldId: string, anchorId?: string) {
  const field = document.getElementById(fieldId);
  field?.focus({ preventScroll: true });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  (anchorId ? document.getElementById(anchorId) : field)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
}

function Mark({ state }: { state: "done" | "todo" | "advice" }) {
  if (state === "done") {
    return (
      <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6.5" />
        <path d="m5.5 8.2 1.7 1.7 3.3-3.6" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={`mt-0.5 h-4 w-4 shrink-0 ${state === "todo" ? "text-confirm" : "text-ink-3"}`} fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="8" cy="8" r="6.5" strokeDasharray={state === "advice" ? "2 2.2" : undefined} />
    </svg>
  );
}

function Check({ state, title, children }: { state: "done" | "todo" | "advice"; title: string; children?: ReactNode }) {
  const said = state === "done" ? "Done" : state === "todo" ? "To do" : "Suggested";
  return (
    <li className="flex gap-2.5">
      <Mark state={state} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={`text-sm ${state === "done" ? "text-ink-2" : "font-medium text-ink"}`}>
          <span className="sr-only">{said}: </span>
          {title}
        </p>
        {state !== "done" && children}
      </div>
    </li>
  );
}

const jumpClass = "min-h-11 w-full py-1 text-left text-xs text-brand underline underline-offset-4 hover:text-brand-strong sm:min-h-0 sm:py-1.5";

function LineLinks({ lines, field }: { lines: LineRef[]; field: (line: LineRef) => "quantity" | "price" | "description" }) {
  return (
    <ul className="space-y-0.5">
      {lines.map((line) => (
        <li key={line.id}>
          <button type="button" className={jumpClass} onClick={() => jump(lineFieldId(line.id, field(line)), lineAnchor(line.id))}>
            {line.area}: {line.description} <span className="text-ink-3 no-underline">({line.missing})</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReviewChecklist({
  review,
  openQuestions,
  onQuestionDealtWith,
}: {
  review: Review;
  openQuestions: OpenQuestion[];
  onQuestionDealtWith: (index: number) => void;
}) {
  const clientMissing = [!review.name && "name", !review.email && "email address"].filter(Boolean).join(" and ");

  return (
    <ul className="space-y-4">
      <Check state={review.name && review.email ? "done" : "todo"} title="Who it is for">
        <button type="button" className={jumpClass} onClick={() => jump(review.name ? CLIENT_EMAIL_FIELD : CLIENT_NAME_FIELD)}>
          Add the client&rsquo;s {clientMissing}.
        </button>
      </Check>

      <Check
        state={review.lineCount > 0 && review.unpriced.length === 0 ? "done" : "todo"}
        title={
          review.lineCount === 0
            ? "At least one line"
            : review.unpriced.length === 0
              ? "Every line has a quantity and a price"
              : `${plural(review.unpriced.length, "line")} without a quantity or a price`
        }
      >
        {review.lineCount === 0 ? (
          <p className="text-xs text-ink-2">Add a line to an area below.</p>
        ) : (
          <LineLinks lines={review.unpriced} field={(line) => (line.missing.includes("quantity") ? "quantity" : "price")} />
        )}
      </Check>

      <Check
        state={openQuestions.length === 0 ? "done" : "todo"}
        title={openQuestions.length === 0 ? "Open questions settled" : `${plural(openQuestions.length, "open question")} from the walk`}
      >
        <p className="text-xs text-ink-2">For you only. Settle each one in the proposal, then mark it dealt with.</p>
        <ul className="space-y-2 pt-1">
          {openQuestions.map((q, index) => (
            <li key={`${index}-${q.question}`} className="rounded-md border border-confirm-line bg-confirm-soft px-3 py-2 text-xs text-confirm">
              <p>
                {q.area && <span className="font-semibold">{q.area}: </span>}
                {q.question}
              </p>
              <button
                type="button"
                onClick={() => onQuestionDealtWith(index)}
                className="-mx-1 min-h-11 px-1 font-medium underline underline-offset-4 sm:min-h-8"
              >
                Dealt with
              </button>
            </li>
          ))}
        </ul>
      </Check>

      <Check
        state={review.withoutPhotos.length === 0 ? "done" : "advice"}
        title={
          review.withoutPhotos.length === 0
            ? "Every area has a photo"
            : `${plural(review.withoutPhotos.length, "area")} without a photo (optional)`
        }
      >
        <ul className="space-y-0.5">
          {review.withoutPhotos.map((s) => (
            <li key={s.id}>
              <button type="button" className={jumpClass} onClick={() => jump(`${sectionAnchor(s.id)}-heading`, sectionAnchor(s.id))}>
                {s.area}
              </button>
            </li>
          ))}
        </ul>
      </Check>

      {review.toConfirm.length > 0 && (
        <Check state="advice" title={`${plural(review.toConfirm.length, "note")} to confirm (optional)`}>
          <LineLinks lines={review.toConfirm} field={() => "description"} />
        </Check>
      )}
    </ul>
  );
}
