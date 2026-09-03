/**
 * The service, and the console it serves.
 *
 * `node:http` and nothing else. There is no framework here and that is not
 * austerity for its own sake: this project's whole subject is a database it
 * does not own, and a dependency list of one — the runtime — is the shortest
 * possible answer to "what else would I be installing on the machine that talks
 * to the archive".
 *
 * ── The one route that matters ───────────────────────────────────────────────
 *
 * Every answer carries `?installation=`, and switching it swaps the database
 * under the dashboard. The point of that is not variety: **the numbers on the
 * side that reads the schema do not move, and the numbers on the side that
 * writes its SQL straight do.** That is the argument of the project, made
 * something you can operate rather than something you have to be told.
 */

import type { Dialect, Filters, Run, Schema } from '../ask/shapes.ts';

import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { INSTALLATIONS, open } from '../fixtures/installations.ts';
import { asCsv, studies } from '../ask/studies.ts';
import { askStraight } from '../ask/straight.ts';
import { devices } from '../ask/devices.ts';
import { heatmap } from '../ask/heatmap.ts';
import { modalities } from '../ask/modalities.ts';
import { resolve, resolution } from '../db/schema.ts';
import { runner } from '../db/sqlite.ts';
import { sqlite } from '../db/dialect.ts';
import { storage, whenItRunsOut } from '../ask/storage.ts';
import { summary } from '../ask/summary.ts';
import { trend } from '../ask/trend.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', '..', 'public');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Every installation, opened once and kept.
 *
 * They are in memory and derived from `facts.js`, so opening one costs a few
 * milliseconds — but opening it per request would mean the study list paged
 * through a database that had just been rebuilt, which is a different database
 * with the same contents and no reason to behave identically under a LIMIT.
 */
function everything() {
  const held = new Map();

  for (const one of INSTALLATIONS) {
    const { db } = open(one.name);
    const run = runner(db as unknown as Parameters<typeof runner>[0]);

    held.set(one.name, {
      ...one,
      db,
      run,
      schema: resolve(run, sqlite),
    });
  }

  return held;
}

export type Log = (level: string, message: string, detail?: Record<string, unknown>) => void;

export function service({ log = () => {} }: { log?: Log } = {}) {
  const held = everything();
  const capacityGB = Number(process.env.PACS_CAPACITY_GB) || null;

  const server = http.createServer((request, response) => {
    const at = new URL(request.url ?? '/', 'http://127.0.0.1');

    try {
      if (at.pathname.startsWith('/api/')) return api(at, request, response);
      return serve(at, response);
    } catch (error) {
      log('error', 'the request could not be handled', { where: at.pathname, why: error instanceof Error ? error.message : String(error) });
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  return { server, close: () => held.forEach((one) => one.db.close()) };

  // -------------------------------------------------------------------------

  function api(at: URL, request: IncomingMessage, response: ServerResponse): unknown {
    const which = at.searchParams.get('installation') ?? INSTALLATIONS[0].name;
    const site = held.get(which);

    if (!site) {
      return json(response, 404, {
        error: `no installation called ${which}`,
        there_are: [...held.keys()],
      });
    }

    const filters = {
      from: at.searchParams.get('from') || undefined,
      to: at.searchParams.get('to') || undefined,
      modality: at.searchParams.get('modality') || undefined,
      description: at.searchParams.get('description') || undefined,
      accession: at.searchParams.get('accession') || undefined,
      page: at.searchParams.get('page') || undefined,
      pageSize: at.searchParams.get('pageSize') || undefined,
    };

    const { run, schema } = site;
    // Every question in `src/ask/` takes the same four things, which is what
    // lets this be one line instead of eight.
    const ask = <T>(what: (r: Run, d: Dialect, s: Schema, f: Filters) => T): T =>
      what(run, sqlite, schema, filters);

    if (at.pathname === '/api/health') {
      return json(response, 200, {
        ok: true,
        installations: [...held.keys()],
        dialect: sqlite.name,
        executed: sqlite.executed,
        reads: 'nothing but SELECT — there is no INSERT, UPDATE or DELETE in src/',
      });
    }

    /** What this installation calls things, and how that was worked out. */
    if (at.pathname === '/api/schema') {
      return json(response, 200, {
        installation: which,
        differs: site.differs,
        why: site.why,
        table: schema.table,
        modalityFrom: schema.modalityFrom,
        notes: schema.notes,
        resolved: resolution(schema),
      });
    }

    /**
     * The dashboard, both ways.
     *
     * The straight side is asked the same questions, and what comes back is
     * how it went rather than only what it said: `right`, `patched` or the
     * value it produced. A page that showed only the numbers would be showing
     * two numbers and asking somebody to notice.
     */
    if (at.pathname === '/api/dashboard') {
      const said = ask(summary);
      const room = ask(storage);

      return json(response, 200, {
        installation: which,
        summary: said,
        modalities: ask(modalities),
        devices: ask(devices),
        trend: ask(trend),
        heatmap: ask(heatmap),
        storage: {
          ...room,
          runsOut: whenItRunsOut(room.total.kb / 1024 / 1024, room.forecast, capacityGB),
        },
        notes: schema.notes,
        straight: straightSide(run, which),
      });
    }

    if (at.pathname === '/api/studies') {
      return json(response, 200, { installation: which, ...ask(studies) });
    }

    if (at.pathname === '/api/studies.csv') {
      // Everything the filters select, not the page. An export that gave you
      // the fifty rows you were looking at would be an export of a scrollbar.
      const all = studies(run, sqlite, schema, { ...filters, page: 1, pageSize: 200 });
      const csv = asCsv(all.rows);

      response.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="studies-${which}.csv"`,
        'Cache-Control': 'no-store',
      });

      return response.end(csv);
    }

    return json(response, 404, { error: 'no such endpoint', it_starts_at: '/api/health' });
  }

  /** The same eight questions, with the SQL written straight. */
  function straightSide(run: Run, which: string) {
    const out: Record<string, { how: string; value: unknown; error: string | null }> = {};

    for (const question of [
      'how many studies',
      'how much storage, in GB',
      'how many patients',
      'studies per modality',
      'studies per device',
    ]) {
      try {
        const said = askStraight(run, question, which);
        out[question as string] = { how: said.how, value: said.value, error: said.error };
      } catch (error) {
        out[question as string] = { how: 'threw', value: null, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return out;
  }
}

/**
 * The page and its files.
 *
 * `no-store` on everything, and it is not laziness. These files carry no hash
 * in their names, so a cached copy is a copy that never updates — and a browser
 * remembers per origin, so somebody who ran a different project on this port
 * has that project's answers in the same drawer.
 */
function serve(at: URL, response: ServerResponse): void {
  const name = at.pathname === '/' ? 'index.html' : at.pathname.slice(1);
  const file = path.join(PUBLIC, name);

  // Refuse anything that climbs out, before touching the disk. `path.join`
  // resolves `..` quite happily, and a static server that did not check is a
  // static server that serves whatever is above it.
  if (!file.startsWith(PUBLIC + path.sep) && file !== path.join(PUBLIC, 'index.html')) {
    return json(response, 403, { error: 'no' });
  }

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return json(response, 404, { error: 'no such file', you_asked_for: at.pathname });
  }

  response.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  });

  response.end(fs.readFileSync(file));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);

  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });

  response.end(text);
}
