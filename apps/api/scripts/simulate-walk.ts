// Stand-in for the recorder: cuts an audio file into chunks the way the mobile app cuts the
// device's recording, posts them to /api/walks, and reports how far behind the pipeline runs.
//
//   npm run walk:simulate -- <audio file> [--cut 90] [--realtime] [--api http://localhost:4000] [--user demo-architect]
//
// Without --realtime every chunk is posted at once; with it they arrive one cut apart, as on a walk.
// Needs ffmpeg on PATH.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { env } from '@groundwork/graph/env';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cut: { type: 'string', default: '90' },
    realtime: { type: 'boolean', default: false },
    api: { type: 'string', default: `http://localhost:${env.API_PORT}` },
    user: { type: 'string', default: 'demo-architect' },
  },
});

const input = positionals[0];
const cutSeconds = Number(values.cut);
if (!input || !Number.isInteger(cutSeconds) || cutSeconds < 15) {
  console.error('Usage: npm run walk:simulate -- <audio file> [--cut 90] [--realtime] [--api URL] [--user ID]');
  process.exit(1);
}

const api = `${values.api.replace(/\/$/, '')}/api`;
const auth: Record<string, string> = env.WALK_API_TOKEN ? { Authorization: `Bearer ${env.WALK_API_TOKEN}` } : {};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);

interface ChunkView {
  key: string;
  status: string;
  error: string | null;
  bytes: number;
  transcript: string | null;
  durationSec: number | null;
  latencyMs: number | null;
}
interface WalkView {
  id: string;
  settled: boolean;
  transcript: string;
  siteModel: { areas: { name: string }[]; missing: unknown[] } | null;
  siteModelError: string | null;
  siteModelCurrent: boolean;
  siteModelMeta: { model: string; latencyMs: number } | null;
  chunks: ChunkView[];
}

async function call<T>(method: string, url: string, init: { json?: unknown; body?: Buffer } = {}): Promise<T> {
  const res = await fetch(`${api}${url}`, {
    method,
    headers: { ...auth, ...(init.json ? { 'Content-Type': 'application/json' } : {}), ...(init.body ? { 'Content-Type': 'audio/mpeg' } : {}) },
    body: init.json ? JSON.stringify(init.json) : init.body ? new Uint8Array(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

function cut(file: string): string[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'walk-'));
  // Mono 32 kbps MP3 is what the Plaud SDK exports from the device.
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '32k',
      '-f', 'segment', '-segment_time', String(cutSeconds), '-reset_timestamps', '1', path.join(dir, 'chunk-%03d.mp3')],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.error?.message ?? result.stderr}`);
  }
  return readdirSync(dir).sort().map((name) => path.join(dir, name));
}

const files = cut(path.resolve(input));
console.log(`Cut ${path.basename(input)} into ${files.length} chunk(s) of up to ${cutSeconds}s`);

const walk = await call<WalkView>('POST', '/walks', { json: { userId: values.user, cutSeconds } });
console.log(`Walk ${walk.id}\n`);
const started = Date.now();
const clock = () => `[${seconds(Date.now() - started).padStart(7)}]`;

const seen = new Map<string, string>();
let modelSeen: string | null = null;

function report(view: WalkView): void {
  for (const chunk of view.chunks) {
    if (seen.get(chunk.key) === chunk.status) continue;
    seen.set(chunk.key, chunk.status);
    const detail =
      chunk.status === 'done'
        ? `ready ${seconds(chunk.latencyMs)} after arriving — "${(chunk.transcript ?? '').slice(0, 70)}…"`
        : chunk.status === 'failed'
          ? `FAILED: ${chunk.error}`
          : chunk.status;
    console.log(`${clock()} chunk ${chunk.key}: ${detail}`);
  }
  const stamp = view.siteModel && view.siteModelCurrent ? JSON.stringify(view.siteModel) : null;
  if (stamp && stamp !== modelSeen) {
    modelSeen = stamp;
    const names = view.siteModel?.areas.map((a) => a.name).join(', ') || 'none';
    console.log(`${clock()} site model: ${view.siteModel?.areas.length} area(s) [${names}], ${view.siteModel?.missing.length} open question(s)`);
  }
  if (view.siteModelError) console.log(`${clock()} site model error: ${view.siteModelError}`);
}

const base = Math.floor(Date.now() / 1000);
for (const [i, file] of files.entries()) {
  if (values.realtime) {
    // A chunk can only be sent once the device has finished recording it.
    const due = started + (i + 1) * cutSeconds * 1000;
    while (Date.now() < due) {
      report(await call<WalkView>('GET', `/walks/${walk.id}`));
      await sleep(Math.min(3000, Math.max(0, due - Date.now())));
    }
  }
  const startedAt = base + i * cutSeconds;
  await call('POST', `/walks/${walk.id}/chunks?key=${startedAt}&startedAt=${startedAt}&filetype=mp3`, { body: readFileSync(file) });
  console.log(`${clock()} chunk ${startedAt}: sent (${i + 1}/${files.length})`);
}
rmSync(path.dirname(files[0] ?? ''), { recursive: true, force: true });

let view = await call<WalkView>('POST', `/walks/${walk.id}/finish`);
while (!view.settled) {
  report(view);
  await sleep(3000);
  view = await call<WalkView>('GET', `/walks/${walk.id}`);
}
report(view);

const done = view.chunks.filter((c) => c.status === 'done');
const failed = view.chunks.filter((c) => c.status === 'failed');
const latencies = done.map((c) => c.latencyMs ?? 0);
console.log(`\n${done.length} of ${view.chunks.length} chunks transcribed, ${failed.length} failed`);
if (latencies.length > 0) {
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`Transcript ready after arriving: average ${seconds(avg)}, slowest ${seconds(Math.max(...latencies))}`);
}
if (view.siteModelMeta) console.log(`Last site model extraction: ${seconds(view.siteModelMeta.latencyMs)} on ${view.siteModelMeta.model}`);
console.log(`Transcript: ${view.transcript.length} characters`);
console.log(`Full result: GET ${api}/walks/${walk.id}`);
process.exit(failed.length > 0 ? 1 : 0);
