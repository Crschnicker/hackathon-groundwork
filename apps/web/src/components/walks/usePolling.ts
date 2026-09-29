"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `load` now and then again `everyMs` after each call has finished, for as long as
 * `active` is true. Stops while the tab is hidden and loads at once when it is shown again.
 * A change of `reloadKey` starts over with an immediate load.
 */
export function usePolling(
  load: (signal: AbortSignal) => Promise<void>,
  { everyMs, active, reloadKey }: { everyMs: number; active: boolean; reloadKey?: string | number },
): void {
  // The newest `load` is used without restarting the timer each time the caller re-renders.
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    // Asked again after each wait: the tab may have been hidden in the meantime.
    const hidden = () => document.visibilityState === "hidden";

    async function run() {
      clearTimeout(timer);
      if (loading || controller.signal.aborted || hidden()) return;
      loading = true;
      try {
        await latest.current(controller.signal);
      } catch {
        // `load` reports its own failures; one that slips through must not stop the refreshing.
      } finally {
        loading = false;
      }
      if (!controller.signal.aborted && !hidden()) timer = setTimeout(run, everyMs);
    }

    function onVisibility() {
      if (hidden()) clearTimeout(timer);
      else void run();
    }

    document.addEventListener("visibilitychange", onVisibility);
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, everyMs, reloadKey]);
}
