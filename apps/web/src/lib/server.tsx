"use client";

// One place that knows whether the Groundwork server can be reached. Every screen reads it, so
// an outage shows as a single banner instead of the same error in each section, and everything
// reloads by itself when the server comes back.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { api, type Health } from "@/lib/api";

export type ServerState = "checking" | "online" | "offline";

interface Server {
  state: ServerState;
  /** The last answer from the server's health check; kept while offline. */
  health: Health | null;
  /** Goes up by one each time the server comes back. Put it in an effect's dependencies to reload. */
  recoveries: number;
}

const ServerContext = createContext<Server>({ state: "checking", health: null, recoveries: 0 });

const ONLINE_INTERVAL_MS = 30_000;
const OFFLINE_INTERVAL_MS = 4_000;

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [server, setServer] = useState<Server>({ state: "checking", health: null, recoveries: 0 });
  const wasOffline = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const controller = new AbortController();

    async function check() {
      let next: ServerState;
      let health: Health | null = null;
      try {
        health = await api.health(controller.signal);
        next = "online";
      } catch {
        next = "offline";
      }
      if (stopped) return;
      const recovered = next === "online" && wasOffline.current;
      wasOffline.current = next === "offline";
      setServer((previous) => ({
        state: next,
        health: health ?? previous.health,
        recoveries: previous.recoveries + (recovered ? 1 : 0),
      }));
      timer = setTimeout(check, next === "online" ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS);
    }
    check();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <ServerContext.Provider value={server}>{children}</ServerContext.Provider>;
}

export function useServer(): Server {
  return useContext(ServerContext);
}

/** Shown once, above the page, while the server cannot be reached. */
export function ServerBanner() {
  const { state } = useServer();
  if (state !== "offline") return null;
  return (
    <div role="alert" className="border-b border-danger-line bg-danger-soft">
      <p className="mx-auto w-full max-w-5xl px-4 py-3 text-sm text-danger sm:px-6">
        <span className="font-semibold">Groundwork can&rsquo;t reach its server.</span> Trying again every few
        seconds; this page will reload what it was showing when the server is back.
      </p>
    </div>
  );
}
