"use client";

import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";

function Dot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-stone-300"}`} />
      <span className={ok ? "text-stone-700" : "text-stone-400"}>{label}</span>
    </span>
  );
}

/** What the API is connected to, read from GET /health. */
export function StatusBar() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="text-sm text-red-700">{error}</p>;
  if (!health) return <p className="text-sm text-stone-400">Checking connections…</p>;

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <Dot ok={health.neo4j === "ok"} label="Neo4j" title={`Neo4j: ${health.neo4j}`} />
      <Dot ok={health.llm.openrouter === "configured"} label="OpenRouter" title={`OpenRouter: ${health.llm.openrouter}`} />
      <Dot ok={health.llm.crusoe === "configured"} label="Crusoe" title={`Crusoe: ${health.llm.crusoe}`} />
      <Dot ok={health.plaud === "configured"} label="Plaud" title={`Plaud: ${health.plaud}`} />
    </div>
  );
}
