"use client";

// The walk photos shown with one section, in the order the client sees them. Photos matched to
// the area arrive already chosen; any other photo from the walk can be added, and each can be
// moved or taken out again. Taking one out leaves it on the walk.
import { useState } from "react";
import type { WalkPhoto } from "@/lib/api";
import { PhotoThumb, photoLabel } from "@/components/photos/PhotoThumb";
import { Button, plural } from "@/components/ui";

/** The most photos one section can hold (the API's limit). */
const MOST = 24;

const iconButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink " +
  "disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent";

function Arrow({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === "left" ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"} />
    </svg>
  );
}

export function SectionPhotos({
  walkId,
  area,
  photos,
  photoIds,
  onChange,
}: {
  walkId: string;
  area: string;
  /** Every photo of the walk. */
  photos: WalkPhoto[];
  photoIds: string[];
  onChange: (photoIds: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const byId = new Map(photos.map((p) => [p.id, p]));
  // A photo deleted from the walk since is simply not shown; the server drops it on the next save.
  const included = photoIds.map((id) => byId.get(id)).filter((p): p is WalkPhoto => p !== undefined);
  const others = photos.filter((p) => !photoIds.includes(p.id));
  const full = included.length >= MOST;

  function move(index: number, by: -1 | 1) {
    const ids = included.map((p) => p.id);
    const [taken] = ids.splice(index, 1);
    ids.splice(index + by, 0, taken);
    onChange(ids);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h4 className="text-sm font-semibold text-ink">Photos</h4>
        <p className="text-xs text-ink-3">
          {included.length === 0 ? "None chosen. The client sees this area without a photo." : `${plural(included.length, "photo")} shown to the client.`}
        </p>
      </div>

      {included.length > 0 && (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {included.map((photo, index) => {
            const name = photoLabel(photo);
            return (
              <li key={photo.id} className="space-y-1">
                <PhotoThumb walkId={walkId} photo={photo} className="aspect-[4/3] w-full" />
                <p className="line-clamp-2 min-h-8 text-xs text-ink-2">{photo.caption ?? <span className="text-ink-3">No caption</span>}</p>
                <div className="flex items-center justify-between">
                  <div className="flex">
                    <button type="button" className={iconButton} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move earlier: ${name}`}>
                      <Arrow direction="left" />
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      disabled={index === included.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move later: ${name}`}
                    >
                      <Arrow direction="right" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onChange(included.filter((p) => p.id !== photo.id).map((p) => p.id))}
                    aria-label={`Take out of this section: ${name}`}
                    className="min-h-11 rounded-lg px-2 text-xs font-medium text-ink-2 underline underline-offset-4 hover:text-danger"
                  >
                    Take out
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {others.length > 0 &&
        (adding ? (
          <div className="space-y-3 rounded-lg border border-line bg-sunken p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-2">
                {full ? `A section holds at most ${MOST} photos. Take one out to add another.` : `Choose a photo from the walk to show with ${area}.`}
              </p>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Done
              </Button>
            </div>
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {others.map((photo) => (
                <li key={photo.id}>
                  <button
                    type="button"
                    disabled={full}
                    onClick={() => onChange([...included.map((p) => p.id), photo.id])}
                    className="block w-full space-y-1 rounded-md p-1 text-left hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PhotoThumb walkId={walkId} photo={photo} alt={`Add: ${photoLabel(photo)}`} />
                    <span className="block truncate text-2xs text-ink-3">{photo.area ?? "No area"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add a photo
          </Button>
        ))}
    </div>
  );
}
