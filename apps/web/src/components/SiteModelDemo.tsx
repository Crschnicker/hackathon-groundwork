"use client";

import { useEffect, useState } from "react";
import { api, type Provider, type ProviderName, type SiteModelResult } from "@/lib/api";

const SAMPLE = `Back patio, about 20 by 15, cracked concrete. Client wants flagstone. East fence line, 40 feet, full afternoon sun, pollinator border. Pull the dying juniper. Side yard is mostly shade and stays wet after rain, they'd like a gravel path through it.`;

const label = (s: string | null) => (s ? s.replaceAll("_", " ") : null);

/** Journey step 4: walkthrough transcript → structured site model, via OpenRouter or Crusoe. */
export function SiteModelDemo() {
  const [transcript, setTranscript] = useState(SAMPLE);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<ProviderName | "">("");
  const [result, setResult] = useState<SiteModelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .providers()
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  const anyConfigured = providers.some((p) => p.configured);

  async function extract() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.extractSiteModel(transcript, provider || undefined));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={5}
        aria-label="Walkthrough transcript"
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as ProviderName | "")}
          aria-label="LLM provider"
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
        >
          <option value="">Default provider, with fallback</option>
          {providers.map((p) => (
            <option key={p.name} value={p.name} disabled={!p.configured}>
              {p.label} · {p.defaultModel}
              {p.configured ? "" : " (no API key)"}
            </option>
          ))}
        </select>
        <button
          onClick={extract}
          disabled={busy || !anyConfigured || transcript.trim().length < 20}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {busy ? "Extracting…" : "Extract site model"}
        </button>
        {providers.length > 0 && !anyConfigured && (
          <span className="text-sm text-stone-500">
            Add OPENROUTER_API_KEY or CRUSOE_API_KEY to .env and restart the API.
          </span>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {result && (
        <div className="space-y-4">
          <p className="text-xs text-stone-500">
            {result.meta.model} via {result.meta.provider} · {(result.meta.latencyMs / 1000).toFixed(1)}s
          </p>

          {result.siteModel.missing.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="text-sm font-semibold text-amber-900">To confirm during review</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {result.siteModel.missing.map((m, i) => (
                  <li key={i}>
                    {m.area && <span className="font-medium">{m.area}: </span>}
                    {m.question}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {result.siteModel.areas.map((a) => {
              const conditions = [label(a.conditions.sun), a.conditions.slope && `${a.conditions.slope} slope`, a.conditions.drainage && `${a.conditions.drainage} drainage`].filter(Boolean);
              return (
                <article key={a.name} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
                  <h3 className="font-semibold text-stone-900">{a.name}</h3>
                  {a.measurements.map((m, i) => (
                    <p key={i} className="text-stone-600">
                      {m.subject}: {m.lengthFt ?? "?"}
                      {m.widthFt !== null && ` × ${m.widthFt}`} ft
                      {m.areaSqFt !== null && ` (${m.areaSqFt} sq ft)`}
                    </p>
                  ))}
                  {conditions.length > 0 && <p className="text-stone-600">{conditions.join(" · ")}</p>}
                  {a.existingFeatures.map((f, i) => (
                    <p key={i} className="text-stone-600">
                      Existing: {f.feature}
                      {f.condition && ` (${f.condition})`}
                    </p>
                  ))}
                  {a.removals.map((r, i) => (
                    <p key={i} className="text-red-800">
                      Remove: {r.item}
                    </p>
                  ))}
                  {a.proposedChanges.map((c, i) => (
                    <p key={i} className="text-emerald-800">
                      {c.category}: {c.change}
                    </p>
                  ))}
                </article>
              );
            })}
          </div>

          {result.siteModel.clientPreferences.length > 0 && (
            <p className="text-sm text-stone-600">
              <span className="font-medium text-stone-900">Client preferences: </span>
              {result.siteModel.clientPreferences.join("; ")}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
