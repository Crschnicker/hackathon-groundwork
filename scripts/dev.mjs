// `npm run dev` — runs the API (:4000) and the web app (:3000) together, prefixing their output.
// Ctrl+C stops both; if one exits, the other is stopped too.
import { spawn } from 'node:child_process';

const apps = [
  { name: 'api', color: '\x1b[34m', workspace: 'apps/api' },
  { name: 'web', color: '\x1b[35m', workspace: 'apps/web' },
];

let stopping = false;
const children = apps.map(({ name, color, workspace }) => {
  // shell: true resolves npm(.cmd) through ComSpec on Windows and /bin/sh elsewhere
  const child = spawn(`npm run dev -w ${workspace}`, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = `${color}[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) console.log(prefix + line);
    });
  }
  child.on('exit', (code) => {
    if (stopping) return;
    console.log(`${prefix}exited with code ${code}`);
    stop(code ?? 1);
  });
  return child;
});

function stop(code) {
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // On Windows the child is a shell; kill the whole tree.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
