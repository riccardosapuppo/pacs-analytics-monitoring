#!/usr/bin/env node
/**
 * Starts the service and opens the console.
 *
 *     npm start
 *     npm start -- --port 3800 --no-open
 *
 * Localhost only, with no default that reaches further. This reads an archive
 * of somebody's studies; a tool that serves that on every interface the moment
 * it starts has made a decision on their behalf.
 *
 * 3800, and not 3000. That is the port every project on a machine uses in turn,
 * and a browser remembers service workers, storage and permissions per origin —
 * so two projects sharing a port share state neither knows about.
 */

import { openInABrowser } from './open-a-browser.js';
import { service } from './http/api.js';

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const PORT = Number(argument('port', process.env.PORT ?? 3800));
const HOST = argument('host', process.env.HOST ?? '127.0.0.1');

function log(level, message, detail = {}) {
  // One JSON object per line: a log a person greps and a log a machine parses
  // are the same log, and the moment they are not, one of them stops being kept.
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...detail })}\n`);
}

const { server, close } = service({ log });

server.listen(PORT, HOST, () => {
  log('info', 'listening', {
    console: `http://${HOST}:${PORT}`,
    installations: 6,
    dialect: 'sqlite, in memory, built from the invented facts on every start',
    writes: 'nothing — there is no INSERT, UPDATE or DELETE in src/',
  });

  const browser = openInABrowser(`http://${HOST}:${PORT}/`);
  log('info', browser.opened ? 'the console is open' : 'the console was not opened', { why: browser.why });
});

/**
 * A port that is already taken is a sentence, not a stack trace.
 *
 * Node's default is eleven lines ending in EADDRINUSE, which says what happened
 * to somebody who already knows and nothing to anybody else. It happens on
 * every second start during development, and what the reader needs is the flag
 * that fixes it.
 */
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    log('error', `something is already listening on ${HOST}:${PORT}`, {
      likely: 'another copy of this, or another project using the same port',
      try: `npm start -- --port ${PORT + 1}`,
    });
    process.exit(1);
  }

  throw error;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('info', 'stopping', { signal });
    server.close(() => {
      close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
