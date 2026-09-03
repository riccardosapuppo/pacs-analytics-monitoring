/**
 * Start the service a check needs, and stop it again.
 *
 * A check that fetched a fixed address and hoped somebody had started something
 * has two failure modes, and the second is much worse: on a clean machine it
 * fails, so the publication gate cannot run it — and on a machine where
 * anything *is* listening there it passes, against whatever that is. A copy
 * left running from an hour ago, on an older commit, answers exactly like a
 * fresh one.
 *
 * So a check starts its own, on a port nothing else uses, and takes it away.
 * `--against <url>` points one at a running instance: a deliberate act, with a
 * flag on it, which is the whole difference.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** A port for checks and nothing else. Not 3800: that is where a person runs it. */
export const CHECK_PORT = 3899;

export function against(argv = process.argv) {
  const at = argv.indexOf('--against');
  return at !== -1 && argv[at + 1] ? argv[at + 1] : null;
}

export async function startTheService({ quiet = true } = {}) {
  const already = against();

  if (already) {
    console.log(`Against ${already}, which somebody else started.\n`);
    return { base: already, mine: false, stop: async () => {} };
  }

  const child = spawn(process.execPath, [path.join(root, 'src', 'index.js'), '--port', String(CHECK_PORT), '--no-open'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  let said = '';
  const watch = (chunk) => {
    said += chunk;
    if (!quiet) process.stderr.write(chunk);
  };

  child.stdout.on('data', watch);
  child.stderr.on('data', watch);

  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await new Promise((done) => setTimeout(done, 300));
  };

  const base = `http://127.0.0.1:${CHECK_PORT}`;

  try {
    const until = Date.now() + 30_000;

    for (;;) {
      // Watching for the exit, not only for the port. Without it a service that
      // cannot start makes this wait the full thirty seconds and then report a
      // timeout — when what happened was an error in the first fifty
      // milliseconds, and it said so.
      if (child.exitCode !== null) {
        throw new Error(`the service exited with ${child.exitCode}. It said:\n${said}`);
      }

      try {
        const response = await fetch(`${base}/api/health`);
        if (response.ok) break;
      } catch {
        /* not up yet */
      }

      if (Date.now() > until) throw new Error(`${base} never answered. It said:\n${said}`);
      await new Promise((done) => setTimeout(done, 200));
    }

    return { base, mine: true, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function withTheService(body, options = {}) {
  const service = await startTheService(options);

  try {
    return await body(service.base);
  } finally {
    await service.stop();
  }
}
