"use client";

// A walk photo as something an <img> can show. The image needs the walk token, which an <img>
// cannot send, so it is fetched once and kept as an object URL for as long as the page is open.
// The cache is per page load: the walk is polled every few seconds and must not refetch photos.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const cache = new Map<string, Promise<string>>();

function load(walkId: string, photoId: string): Promise<string> {
  const key = `${walkId}/${photoId}`;
  let url = cache.get(key);
  if (!url) {
    url = api.photoBlob(walkId, photoId).then((blob) => URL.createObjectURL(blob));
    // A failed load is forgotten, so the next render tries again.
    url.catch(() => cache.delete(key));
    cache.set(key, url);
  }
  return url;
}

/** Forget a deleted photo and free its memory. */
export function forgetPhoto(walkId: string, photoId: string): void {
  const key = `${walkId}/${photoId}`;
  cache
    .get(key)
    ?.then((url) => URL.revokeObjectURL(url))
    .catch(() => {});
  cache.delete(key);
}

export function usePhotoUrl(walkId: string, photoId: string): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({
    key: "",
    url: null,
    failed: false,
  });
  const key = `${walkId}/${photoId}`;

  useEffect(() => {
    let current = true;
    load(walkId, photoId).then(
      (url) => current && setState({ key, url, failed: false }),
      () => current && setState({ key, url: null, failed: true }),
    );
    return () => {
      current = false;
    };
  }, [walkId, photoId, key]);

  // Until this photo's answer is in, say nothing about the previous one's.
  return state.key === key ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}
