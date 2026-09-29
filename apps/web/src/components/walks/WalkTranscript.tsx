"use client";

// What was said on the walk so far, as text. While the walk is live the newest words stay in
// view, unless the reader has scrolled up to read something; then they are left where they are.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { TRANSCRIPT_GAP } from "@/lib/api";

export const GAP_LINE = "(this part is still being transcribed)";

const SENTENCES_PER_PARAGRAPH = 4;
/** Closer to the end than this counts as being at the end. */
const NEAR_BOTTOM_PX = 32;

type Line = { gap: true } | { gap: false; text: string };

/** The walkthrough with the server's marker replaced by the line shown on screen. */
export function readableTranscript(transcript: string): string {
  return transcript.replaceAll(TRANSCRIPT_GAP, GAP_LINE);
}

/**
 * The server sends the walkthrough as one run of text. It is shown a few sentences to a
 * paragraph so it can be read, with each part that is still missing on a line of its own.
 */
function toLines(transcript: string): Line[] {
  const lines: Line[] = [];
  transcript.split(TRANSCRIPT_GAP).forEach((part, i) => {
    if (i > 0) lines.push({ gap: true });
    // A sentence ends at a full stop followed by a space, so "1.5 inches" stays in one piece.
    const sentences = part.trim().split(/(?<=[.?!])\s+/);
    for (let s = 0; s < sentences.length; s += SENTENCES_PER_PARAGRAPH) {
      const text = sentences.slice(s, s + SENTENCES_PER_PARAGRAPH).join(" ").trim();
      if (text) lines.push({ gap: false, text });
    }
  });
  return lines;
}

export function WalkTranscript({
  transcript,
  follow,
  labelledBy,
  empty,
}: {
  transcript: string;
  /** Start at the newest words, not at the first. Read once, when the transcript first appears. */
  follow: boolean;
  labelledBy: string;
  /** What to say while there is no text. */
  empty: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(follow);
  const [away, setAway] = useState(false);
  const lines = useMemo(() => toLines(transcript), [transcript]);

  // Runs before the new text is painted, so a reader at the end never sees it jump.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [transcript]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    atBottom.current = near;
    setAway(!near);
  }

  function jump() {
    const el = box.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atBottom.current = true;
    setAway(false);
    // The button is about to go; focus moves to the text it brought into view.
    el.focus();
  }

  return (
    <div className="relative">
      {/* On a wide screen the box is kept short enough for its last words, and the buttons
          under it, to be in view before the page has been scrolled. */}
      <div
        ref={box}
        onScroll={onScroll}
        role="region"
        aria-labelledby={labelledBy}
        tabIndex={0}
        className="max-h-[26rem] min-h-24 overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface px-4 py-4 focus-visible:rounded-lg lg:max-h-[max(14rem,calc(100dvh-32rem))]"
      >
        {lines.length === 0 ? (
          <p className="text-sm text-ink-2">{empty}</p>
        ) : (
          <div className="max-w-[68ch] space-y-3 text-base leading-relaxed text-ink">
            {lines.map((line, i) =>
              line.gap ? (
                <p key={i} className="text-sm text-ink-3">
                  {GAP_LINE}
                </p>
              ) : (
                <p key={i} className="settle">
                  {line.text}
                </p>
              ),
            )}
          </div>
        )}
      </div>
      {away && lines.length > 0 && (
        <button
          type="button"
          onClick={jump}
          className="settle absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-4 text-sm font-medium text-ink shadow-md ring-1 ring-inset ring-line-strong hover:bg-sunken"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
          Jump to latest
        </button>
      )}
    </div>
  );
}
