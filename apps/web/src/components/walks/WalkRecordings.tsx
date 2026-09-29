// Every recording of a walk in the order it was made, with how far each one has got. Closed
// until asked for: this is the detail behind "4 of 5 recordings transcribed".
import type { RecordingStatus, WalkRecording } from "@/lib/api";
import { formatDuration } from "@/components/ui";

const STATE: Record<RecordingStatus, string> = {
  received: "Received",
  uploading: "Uploading",
  transcribing: "Transcribing",
  done: "Transcribed",
  failed: "Failed",
};

function details(recording: WalkRecording): string {
  const parts: string[] = [];
  if (recording.durationSec !== null) parts.push(`${formatDuration(recording.durationSec)} long.`);
  if (recording.latencyMs !== null) parts.push(`Transcript took ${formatDuration(recording.latencyMs / 1000)}.`);
  if (parts.length === 0 && recording.status !== "failed") parts.push("Length is known once it is transcribed.");
  return parts.join(" ");
}

export function WalkRecordings({ recordings }: { recordings: WalkRecording[] }) {
  return (
    <details className="group rounded-lg border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg px-4 text-sm font-medium text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <span>
          Recordings <span className="font-normal tabular-nums text-ink-2">({recordings.length})</span>
        </span>
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="h-4 w-4 text-ink-2 transition-transform duration-200 ease-[var(--ease-out-expo)] group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 6 5 5 5-5" />
        </svg>
      </summary>
      {recordings.length === 0 ? (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-2">
          No recordings have arrived. The phone sends one about every minute and a half.
        </p>
      ) : (
        <ol className="divide-y divide-line border-t border-line">
          {recordings.map((recording, i) => (
            <li key={recording.key} className="space-y-0.5 px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium tabular-nums text-ink">Recording {i + 1}</span>
                <span className={recording.status === "failed" ? "font-medium text-danger" : "text-ink-2"}>
                  {STATE[recording.status]}
                </span>
              </div>
              {details(recording) && <p className="tabular-nums text-ink-2">{details(recording)}</p>}
              {recording.status === "failed" && recording.error && (
                <p className="break-words text-ink-2">The server said: {recording.error}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
