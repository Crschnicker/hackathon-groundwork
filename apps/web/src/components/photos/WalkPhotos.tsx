"use client";

// The photos taken on a walk, grouped by the area each one shows. Groundwork matches a photo to
// an area from what was being said when it was taken; the architect can change the area, write a
// caption, delete a photo, or add more from this browser. Each area's photos go into that area's
// part of the proposal.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { ApiError, api, type Walk, type WalkPhoto } from "@/lib/api";
import { SAMPLE_WALK_ID } from "@/lib/sampleWalk";
import { Button, Notice, SectionHeading, StatusLine, buttonClass, formatDuration, formatWhen, plural } from "@/components/ui";
import { PhotoThumb, photoLabel } from "./PhotoThumb";
import { UnsupportedPhotoError, downscalePhoto } from "./downscale";
import { forgetPhoto, usePhotoUrl } from "./usePhotoUrl";

const UNMATCHED = "Not matched to an area yet";
const norm = (s: string) => s.trim().toLowerCase();

function reason(err: unknown): string {
  if (err instanceof UnsupportedPhotoError || err instanceof ApiError) return err.message;
  return "Something went wrong on the way.";
}

/** A fresh idempotency key. crypto.randomUUID needs a secure page; plain http on a LAN is not one. */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "4 min 12 s into the walk", or when it was taken if that was not during the walk. */
function whenTaken(walk: Walk, takenAt: number): string {
  const into = takenAt - walk.createdAt;
  if (into >= 0 && takenAt <= (walk.finishedAt ?? Infinity) + 60_000) return `${formatDuration(into / 1000)} into the walk`;
  return `Taken ${formatWhen(takenAt).replace(/^Today, /, "today ")}`;
}

function sourceNote(photo: WalkPhoto): string {
  if (photo.areaSource === "architect") return "Set by you";
  if (photo.areaSource === "auto" && photo.area) return "Matched from what was said";
  return "";
}

// Changes made here show at once and stay on screen until the polled walk agrees with them, so a
// refresh that set off before a change landed cannot undo it for a moment.
type Local = { kind: "added" | "edited"; photo: WalkPhoto } | { kind: "deleted" };

const agrees = (a: WalkPhoto, b: WalkPhoto) =>
  a.area === b.area && a.caption === b.caption && a.areaSource === b.areaSource;

function settle(local: Record<string, Local>, server: WalkPhoto[]): Record<string, Local> {
  const byId = new Map(server.map((p) => [p.id, p]));
  const kept: Record<string, Local> = {};
  let dropped = false;
  for (const [id, entry] of Object.entries(local)) {
    const known = byId.get(id);
    const done =
      entry.kind === "deleted" ? !known : entry.kind === "added" ? Boolean(known) : Boolean(known && agrees(known, entry.photo));
    if (done) dropped = true;
    else kept[id] = entry;
  }
  return dropped ? kept : local;
}

function useLocalPhotos(walk: Walk) {
  const [local, setLocal] = useState<Record<string, Local>>({});
  const [seen, setSeen] = useState(walk.photos);
  if (seen !== walk.photos) {
    setSeen(walk.photos);
    setLocal((prev) => settle(prev, walk.photos ?? []));
  }

  const photos = useMemo(() => {
    const byId = new Map((walk.photos ?? []).map((p) => [p.id, p]));
    for (const [id, entry] of Object.entries(local)) {
      if (entry.kind === "deleted") byId.delete(id);
      else byId.set(id, entry.photo);
    }
    return [...byId.values()].sort((a, b) => a.takenAt - b.takenAt || a.receivedAt - b.receivedAt);
  }, [walk.photos, local]);

  return {
    photos,
    added: (photo: WalkPhoto) => setLocal((prev) => ({ ...prev, [photo.id]: { kind: "added", photo } })),
    edited: (photo: WalkPhoto) => setLocal((prev) => ({ ...prev, [photo.id]: { kind: "edited", photo } })),
    deleted: (id: string) => setLocal((prev) => ({ ...prev, [id]: { kind: "deleted" } })),
  };
}

interface PhotoActions {
  walk: Walk;
  areas: string[];
  onEdited: (photo: WalkPhoto) => void;
  say: (message: string) => void;
}

/** The area a photo shows, changed on the spot. */
function AreaSelect({ photo, walk, areas, onEdited, say }: PhotoActions & { photo: WalkPhoto }) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const current = photo.area ? (areas.find((a) => norm(a) === norm(photo.area!)) ?? photo.area) : "";
  // An area the site model no longer has stays selectable, so the select shows what is stored.
  const gone = current && !areas.includes(current);

  async function change(area: string) {
    setSaving(true);
    try {
      onEdited(await api.updatePhoto(walk.id, photo.id, { area: area || null }));
      say(area ? `Photo moved to ${area}.` : "Photo marked as not matched to an area.");
    } catch (err) {
      say(`Could not change the area. ${reason(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-2xs font-medium text-ink-2">
        Area
      </label>
      <select
        id={id}
        value={current}
        disabled={saving}
        onChange={(e) => void change(e.target.value)}
        className="control"
      >
        <option value="">Not matched</option>
        {areas.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
        {gone && <option value={current}>{current} (no longer in the site model)</option>}
      </select>
    </div>
  );
}

function DeletePhoto({ photo, walk, onDeleted, say }: Pick<PhotoActions, "walk" | "say"> & { photo: WalkPhoto; onDeleted: (id: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api.deletePhoto(walk.id, photo.id);
      forgetPhoto(walk.id, photo.id);
      onDeleted(photo.id);
      say("Photo deleted.");
    } catch (err) {
      say(`Could not delete the photo. ${reason(err)}`);
      setBusy(false);
      setAsking(false);
    }
  }

  if (!asking) {
    return (
      <Button variant="quiet" className="-ml-1 px-1" onClick={() => setAsking(true)}>
        Delete
      </Button>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-2xs text-ink-2">Delete this photo? It is also taken out of any proposal.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" busy={busy} className="text-danger" onClick={remove}>
          Delete
        </Button>
        <Button variant="quiet" className="px-1" onClick={() => setAsking(false)}>
          Keep
        </Button>
      </div>
    </div>
  );
}

function PhotoCard({
  photo,
  onOpen,
  onDeleted,
  ...actions
}: PhotoActions & { photo: WalkPhoto; onOpen: () => void; onDeleted: (id: string) => void }) {
  const note = sourceNote(photo);
  return (
    <li className="settle flex gap-3 rounded-lg border border-line bg-surface p-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open larger: ${photoLabel(photo)}`}
        className="h-24 w-24 shrink-0 rounded-md sm:h-28 sm:w-28"
      >
        <PhotoThumb walkId={actions.walk.id} photo={photo} className="h-full w-full" alt="" />
      </button>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="space-y-0.5">
          <p className="line-clamp-2 text-sm text-ink">
            {photo.caption ?? <span className="text-ink-3">No caption yet.</span>}
          </p>
          <p className="text-2xs text-ink-3">
            {whenTaken(actions.walk, photo.takenAt)}
            {note && ` · ${note}`}
          </p>
        </div>
        {actions.areas.length > 0 && <AreaSelect photo={photo} {...actions} />}
        <DeletePhoto photo={photo} walk={actions.walk} say={actions.say} onDeleted={onDeleted} />
      </div>
    </li>
  );
}

/** One photo at a readable size, with its caption and what was being said when it was taken. */
function PhotoDialog({ photo, onClose, ...actions }: PhotoActions & { photo: WalkPhoto; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const captionId = useId();
  const { url, failed } = usePhotoUrl(actions.walk.id, photo.id);
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const next = caption.trim() || null;
    if (next === photo.caption) return;
    setSaving(true);
    try {
      actions.onEdited(await api.updatePhoto(actions.walk.id, photo.id, { caption: next }));
      actions.say(next ? "Caption saved." : "Caption removed.");
    } catch (err) {
      actions.say(`Could not save the caption. ${reason(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const note = sourceNote(photo);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed backdrop lands on the dialog itself, outside its content.
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
      className="m-auto w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-lg bg-surface p-0 text-ink backdrop:bg-ink/60"
    >
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-ink">
              {photo.area ?? "Site photo"}
            </h2>
            <p className="text-2xs text-ink-3">
              {whenTaken(actions.walk, photo.takenAt)}
              {note && ` · ${note}`}
            </p>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => ref.current?.close()}>
            Close
          </Button>
        </div>

        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={photoLabel(photo)} className="max-h-[60dvh] w-full rounded-md bg-sunken object-contain" />
        ) : (
          <div
            aria-hidden={!failed}
            className={`flex h-64 items-center justify-center rounded-md bg-sunken text-sm text-ink-3 ${failed ? "" : "skeleton"}`}
          >
            {failed && "Could not load the photo."}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <form onSubmit={save} className="space-y-1">
            <label htmlFor={captionId} className="block text-2xs font-medium text-ink-2">
              Caption
            </label>
            <div className="flex gap-2">
              <input
                id={captionId}
                value={caption}
                maxLength={300}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="What the photo shows"
                className="control min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" busy={saving} className="shrink-0">
                Save
              </Button>
            </div>
          </form>
          {actions.areas.length > 0 && <AreaSelect photo={photo} {...actions} />}
        </div>

        {photo.spokenContext && (
          <div className="space-y-1">
            <p className="text-2xs font-medium text-ink-2">What was said when it was taken</p>
            <blockquote className="border-l-2 border-line-strong pl-3 text-sm text-ink-2">{photo.spokenContext}</blockquote>
          </div>
        )}
      </div>
    </dialog>
  );
}

interface Pending {
  key: string;
  file: File;
}

/** "Add photos": each file is made smaller here, then sent one at a time. */
function AddPhotos({
  walk,
  onAdded,
  say,
}: {
  walk: Walk;
  onAdded: (photo: WalkPhoto) => void;
  say: (message: string) => void;
}) {
  const inputId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState<(Pending & { reason: string })[]>([]);

  async function send(items: Pending[]) {
    if (items.length === 0 || progress) return;
    setFailed([]);
    const stillFailed: (Pending & { reason: string })[] = [];
    let added = 0;
    for (const [i, item] of items.entries()) {
      setProgress({ done: i, total: items.length });
      say(items.length === 1 ? "Adding the photo." : `Adding photo ${i + 1} of ${items.length}.`);
      try {
        const image = await downscalePhoto(item.file);
        // The same key again is harmless: the server answers with the photo it already has.
        const photo = await api.uploadPhoto(walk.id, image, { key: item.key, takenAt: item.file.lastModified || Date.now() });
        onAdded(photo);
        added++;
      } catch (err) {
        stillFailed.push({ ...item, reason: reason(err) });
      }
    }
    setProgress(null);
    setFailed(stillFailed);
    if (added > 0) say(`Added ${plural(added, "photo")}. Groundwork matches ${added === 1 ? "it" : "them"} to an area.`);
    else say("");
  }

  const busy = progress !== null;
  return (
    <div className="space-y-3">
      {/* The file input hides behind a label that looks like a button; it keeps the keyboard focus. */}
      <label
        htmlFor={inputId}
        className={buttonClass(
          "primary",
          `has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-brand ${
            busy ? "cursor-progress" : "cursor-pointer"
          }`,
        )}
      >
        {busy && <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-current" />}
        {progress
          ? progress.total === 1
            ? "Adding the photo"
            : `Adding ${progress.done + 1} of ${progress.total}`
          : "Add photos"}
        <input
          id={inputId}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          disabled={busy}
          className="sr-only"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            // Cleared so the same photo can be chosen again after a failure.
            e.target.value = "";
            void send(files.map((file) => ({ key: newKey(), file })));
          }}
        />
      </label>

      {failed.length > 0 && (
        <Notice
          title={`${plural(failed.length, "photo")} could not be added.`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void send(failed)}>
                Try again
              </Button>
              <Button variant="quiet" onClick={() => setFailed([])}>
                Dismiss
              </Button>
            </div>
          }
        >
          {[...new Set(failed.map((f) => f.reason))].join(" ")}
        </Notice>
      )}
    </div>
  );
}

export function WalkPhotos({ walk, onChanged }: { walk: Walk; onChanged?: () => void }) {
  const headingId = useId();
  const { photos, added, edited, deleted } = useLocalPhotos(walk);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  // Areas in the order the site model lists them, each name once.
  const areas = useMemo(() => {
    const seen = new Set<string>();
    return (walk.siteModel?.areas ?? [])
      .map((a) => a.name.trim())
      .filter((name) => name && !seen.has(norm(name)) && seen.add(norm(name)));
  }, [walk.siteModel]);

  const groups = useMemo(() => {
    const byArea = new Map(areas.map((a) => [norm(a), [] as WalkPhoto[]]));
    const unmatched: WalkPhoto[] = [];
    for (const photo of photos) {
      const list = photo.area ? byArea.get(norm(photo.area)) : undefined;
      (list ?? unmatched).push(photo);
    }
    return {
      areas: areas.map((name) => ({ name, photos: byArea.get(norm(name)) ?? [] })),
      unmatched,
    };
  }, [areas, photos]);

  if (walk.id === SAMPLE_WALK_ID) return null;

  const actions: PhotoActions = {
    walk,
    areas,
    onEdited: (photo) => {
      edited(photo);
      onChanged?.();
    },
    say: setMessage,
  };
  const onDeleted = (id: string) => {
    deleted(id);
    onChanged?.();
  };
  const open = photos.find((p) => p.id === openId) ?? null;
  const withPhotos = groups.areas.filter((g) => g.photos.length > 0);
  const without = groups.areas.filter((g) => g.photos.length === 0);

  const list = (items: WalkPhoto[]) => (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((photo) => (
        <PhotoCard key={photo.id} photo={photo} onOpen={() => setOpenId(photo.id)} onDeleted={onDeleted} {...actions} />
      ))}
    </ul>
  );

  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <SectionHeading id={headingId} title="Site photos">
        Each photo is matched to the area being talked about when it was taken, and shows in that area&apos;s part of
        the proposal.
      </SectionHeading>

      <div className="space-y-1">
        <AddPhotos
          walk={walk}
          onAdded={(photo) => {
            added(photo);
            onChanged?.();
          }}
          say={setMessage}
        />
        <StatusLine>{message}</StatusLine>
      </div>

      {photos.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-sm text-ink-2 sm:px-6">
          No photos yet. Photos taken in the Walk tab on the phone appear here as they arrive, each matched to the area
          being talked about. You can also add photos from this browser.
        </p>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-ink-2">
            {plural(photos.length, "photo")}
            {groups.unmatched.length > 0 && `, ${groups.unmatched.length} not matched to an area yet`}.
          </p>

          {withPhotos.map((group) => (
            <div key={group.name} className="space-y-2">
              <h3 className="text-base font-semibold text-ink">
                {group.name} <span className="font-normal text-ink-3">{group.photos.length}</span>
              </h3>
              {list(group.photos)}
            </div>
          ))}

          {groups.unmatched.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-base font-semibold text-ink">
                {UNMATCHED} <span className="font-normal text-ink-3">{groups.unmatched.length}</span>
              </h3>
              <p className="text-sm text-ink-2">
                {areas.length > 0
                  ? "Groundwork could not tell which area these show from what was said. Pick one, or leave them out of the proposal."
                  : "Areas appear once Groundwork has read the walk; the photos are matched to them then."}
              </p>
              {list(groups.unmatched)}
            </div>
          )}

          {without.length > 0 && (
            <p className="text-sm text-ink-3">No photos yet of {without.map((g) => g.name).join(", ")}.</p>
          )}
        </div>
      )}

      {open && <PhotoDialog key={open.id} photo={open} onClose={() => setOpenId(null)} {...actions} />}
    </section>
  );
}
