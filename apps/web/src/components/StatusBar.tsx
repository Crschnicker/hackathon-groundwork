"use client";

import { useServer } from "@/lib/server";

type State = "ok" | "set" | "off";

const dot: Record<State, string> = {
  ok: "bg-brand",
  set: "bg-surface ring-2 ring-inset ring-ink-3",
  off: "bg-danger",
};

function Service({ name, state, detail }: { name: string; state: State; detail: string }) {
  return (
    <li className="inline-flex items-center gap-2">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot[state]}`} />
      <span>
        <span className="text-ink">{name}</span> <span className={state === "off" ? "text-danger" : "text-ink-2"}>{detail}</span>
      </span>
    </li>
  );
}

/**
 * What the server is connected to, read from GET /health. Only the catalog database is
 * actually tested; for the other services the server can only tell whether a key is present,
 * so they say "key set" and never claim to be working.
 */
export function StatusBar() {
  const { state, health } = useServer();

  if (state === "checking" && !health) return <p className="text-sm text-ink-2">Checking connections…</p>;
  if (!health) return <p className="text-sm text-danger">Server not reachable, so connections are unknown.</p>;

  const key = (value: string): { state: State; detail: string } =>
    value === "configured" ? { state: "set", detail: "key set" } : { state: "off", detail: value };

  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <Service
        name="Catalog database"
        state={health.neo4j === "ok" ? "ok" : "off"}
        detail={health.neo4j === "ok" ? "connected" : health.neo4j}
      />
      <Service name="OpenRouter" {...key(health.llm.openrouter)} />
      <Service name="Crusoe" {...key(health.llm.crusoe)} />
      <Service name="Plaud" {...key(health.plaud)} />
    </ul>
  );
}
