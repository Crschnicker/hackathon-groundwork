// `npm run tunnel` — puts the running web app (:3000) on a temporary public https URL through a
// Cloudflare quick tunnel, so you can open it on a phone. Start `npm run dev` first.
//
// The URL is random and lasts until you stop this script (Ctrl+C). Anyone who has the URL can
// use the app, including the endpoints that spend LLM credits — share it deliberately.
//
// Needs cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = process.env.WEB_PORT ?? '3000';

const candidates = [
  process.env.CLOUDFLARED,
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
].filter((p) => p && fs.existsSync(p));
const bin = candidates[0] ?? 'cloudflared';

try {
  await fetch(`http://localhost:${port}`, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`Nothing is answering on http://localhost:${port}. Run \`npm run dev\` in another terminal first.`);
  process.exit(1);
}

const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
child.on('error', (err) => {
  console.error(`Could not start cloudflared (${err.message}). Install it, or set CLOUDFLARED to its path.`);
  process.exit(1);
});

let announced = false;
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk) => {
    const text = String(chunk);
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0];
    if (url && !announced) {
      announced = true;
      console.log(`\n  Groundwork is live at:  ${url}\n\n  Open it on your phone. Ctrl+C here closes the tunnel.\n`);
    } else if (/\bERR\b|error/i.test(text)) {
      process.stderr.write(text);
    }
  });
}

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
