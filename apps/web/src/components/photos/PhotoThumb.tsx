"use client";

// One walk photo as a picture, for any screen that shows them: the walk's photos and the
// proposal review. The image is fetched with the walk token (see usePhotoUrl), so until it is in
// the thumbnail holds its place with a skeleton, and a photo that cannot be loaded says so.
import type { WalkPhoto } from "@/lib/api";
import { usePhotoUrl } from "./usePhotoUrl";

/** Words for a photo that has no caption yet. */
export function photoLabel(photo: Pick<WalkPhoto, "caption" | "area">): string {
  if (photo.caption) return photo.caption;
  return photo.area ? `Site photo, ${photo.area}` : "Site photo";
}

export function PhotoThumb({
  walkId,
  photo,
  className = "",
  alt,
}: {
  walkId: string;
  photo: Pick<WalkPhoto, "id" | "caption" | "area">;
  /** Size and shape; defaults to filling the parent with a square crop. */
  className?: string;
  alt?: string;
}) {
  const { url, failed } = usePhotoUrl(walkId, photo.id);
  const box = `overflow-hidden rounded-md bg-sunken ${className || "aspect-square w-full"}`;

  if (failed) {
    return (
      <div className={`${box} flex items-center justify-center p-2 text-center text-2xs text-ink-3`}>
        Could not load the photo.
      </div>
    );
  }
  if (!url) return <div aria-hidden className={`${box} skeleton`} />;
  return (
    // An object URL for a fetched image: next/image cannot optimise it, so a plain <img> it is.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt ?? photoLabel(photo)} decoding="async" className={`${box} object-cover`} />
  );
}
