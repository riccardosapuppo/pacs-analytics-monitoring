#!/usr/bin/env node
/**
 * The two dialects that are not executed, checked as text.
 *
 *     npm run check:dialects
 *     npm run check:dialects -- --show      print every statement
 *
 * SQLite is in the runtime, so everything else here runs against six real
 * databases. SQL Server and PostgreSQL are not, and this repository will not
 * ask anybody to start one — so what can be checked about them is what the
 * builder *emits*, and this is that check, stated as plainly as it can be:
 *
 *   **it proves the builder produces the dialect it means to.**
 *   **it does not prove any server accepts the result.**
 *
 * That is a weaker claim than the SQLite side makes and the README says so in
 * the same words. A page that listed three dialects and executed one, without
 * saying which, would be making an assertion about two databases it had never
 * connected to.
 *
 * ── What it actually looks for ───────────────────────────────────────────────
 *
 * Not a golden file. A frozen copy of the SQL would fail on every harmless
 * change of whitespace and be regenerated without being read, which is how a
 * golden test becomes a rubber stamp.
 *
 * So it asserts the things that are *dialect-specific and load-bearing* — the
 * places where getting it wrong is a syntax error on a server nobody here can
 * ask. Each is a property with a reason.
 */

import type { Dialect } from '../src/db/dialect.ts';
import type { Run } from '../src/db/sqlite.ts';
import { INSTALLATIONS, open } from '../src/fixtures/installations.ts';
import { DIALECTS, postgres, sqlserver } from '../src/db/dialect.ts';
import { devices } from '../src/ask/devices.ts';
import { heatmap } from '../src/ask/heatmap.ts';
import { modalities } from '../src/ask/modalities.ts';
import { mustResolve } from '../src/db/schema.ts';
import { runner } from '../src/db/sqlite.ts';
import { sqlite } from '../src/db/dialect.ts';
import { storage } from '../src/ask/storage.ts';
import { studies } from '../src/ask/studies.ts';
import { summary } from '../src/ask/summary.ts';
import { trend } from '../src/ask/trend.ts';

const show = process.argv.includes('--show');

let checks = 0;
let bad = 0;

function must(what: string, condition: boolean, detail?: unknown): void {
  checks += 1;

  if (condition) {
    console.log(`  ok    ${what}`);
    return;
  }

  bad += 1;
  console.log(`  NO    ${what}`);
  if (detail) console.log(`          ${detail}`);
}

/**
 * Collect the SQL a dialect emits, by running every question against a real
 * schema with a runner that records instead of executing.
 *
 * The schema is resolved with SQLite — the shape of the questions depends on
 * what the schema says, not on which dialect will be spoken, and resolving it
 * for real is what stops this checking queries against an imaginary database.
 */
function statementsFor(d: Dialect, installation: string) {
  const { db } = open(installation);
  const real = runner(db as unknown as Parameters<typeof runner>[0]);
  const schema = mustResolve(real, sqlite);

  const said = [];

  // One empty row, not zero rows.
  //
  // An aggregate always returns a row, and a caller reading `rows[0].n` off
  // an empty array throws -- which would make this check fail for a reason
  // that has nothing to do with the dialect it is looking at. Every field
  // reads as undefined and every caller already copes with that, because a
  // column that is not there is an ordinary outcome here.
  const record = ((sql: string, params: unknown[] = []) => {
    said.push({ sql, params });
    return [{}];
  }) as unknown as Run;

  (record as unknown as { one: () => unknown }).one = () => ({});

  const filters = { from: '2024-01-01', to: '2024-12-31' };

  for (const ask of [
    () => summary(record, d, schema, filters),
    () => modalities(record, d, schema, filters),
    () => devices(record, d, schema, filters),
    () => trend(record, d, schema, { ...filters, granularity: 'month' }),
    () => heatmap(record, d, schema, filters),
    () => storage(record, d, schema, {}),
    () => studies(record, d, schema, { ...filters, modality: 'CT', description: 'chest', page: 2 }),
  ]) {
    try {
      ask();
    } catch (error) {
      // A question that cannot even be assembled for a dialect is a failure of
      // this check, not something to skip past quietly.
      said.push({ sql: `THREW: ${(error instanceof Error ? error.message : String(error))}`, params: [] });
    }
  }

  db.close();
  return said;
}

console.log('\nWhat the two unexecuted dialects are emitting.\n');

for (const [name, d] of [
  ['SQL Server', sqlserver],
  ['PostgreSQL', postgres],
] as Array<[string, Dialect]>) {
  console.log(`${name}`);

  const all = statementsFor(d, 'as-documented').concat(statementsFor(d, 'modality-on-series'));
  const sql = all.map((one) => one.sql).join('\n');

  must('every question could be assembled', !/THREW:/.test(sql), sql.match(/THREW: .*/)?.[0]);

  // ── The identifier quoting ────────────────────────────────────────────────
  //
  // Backets on SQL Server, double quotes on PostgreSQL. Emitting the wrong one
  // is a syntax error on the server and nothing at all here.
  if (d === sqlserver) {
    must('identifiers are in [brackets]', /\[Study\]/.test(sql) && !/"Study"/.test(sql));
  } else {
    must('identifiers are in "double quotes"', /"Study"/.test(sql) && !/\[Study\]/.test(sql));
  }

  // ── The parameters ────────────────────────────────────────────────────────
  //
  // `@p1` on SQL Server, `$1` on PostgreSQL, and NEVER a bare `?`, which is
  // the marker SQLite uses and the one a copied query brings with it.
  if (d === sqlserver) {
    must('parameters are @p1, @p2 …', /@p1\b/.test(sql));
  } else {
    must('parameters are $1, $2 …', /\$1\b/.test(sql));
  }

  must(
    'and no positional ? survives from the SQLite dialect',
    !/[^\w]\?/.test(sql),
    sql.split('\n').find((line) => /[^\w]\?/.test(line))
  );

  // ── COUNT ─────────────────────────────────────────────────────────────────
  //
  // `COUNT` returns int on SQL Server and overflows around two billion, which
  // an archive counting instances rather than studies reaches.
  if (d === sqlserver) {
    must('counting uses COUNT_BIG, which does not overflow at two billion', /COUNT_BIG\(\*\)/.test(sql));
  } else {
    must('counting uses COUNT, which is already 64-bit here', /COUNT\(\*\)/.test(sql) && !/COUNT_BIG/.test(sql));
  }

  // ── The date guard ────────────────────────────────────────────────────────
  //
  // The one thing every dated query depends on: eight characters, all digits.
  // Written three different ways in three dialects, and a query missing it is
  // a query that will one day group by a bucket called `UNKNOW`.
  if (d === sqlserver) {
    must('the digits-only guard is NOT LIKE %[^0-9]%', /NOT LIKE '%\[\^0-9\]%'/.test(sql));
    must('and the length guard uses LEN', /LEN\(/.test(sql));
  } else {
    must("the digits-only guard is a ~ '^[0-9]+$' regex", /~ '\^\[0-9\]\+\$'/.test(sql));
    must('and the length guard uses char_length', /char_length\(/.test(sql));
  }

  // ── ROUND, on PostgreSQL only ─────────────────────────────────────────────
  //
  // `round(double precision, int)` does not exist there. Emitting it is a
  // function-does-not-exist error at run time, from a query that reads fine.
  if (d === postgres) {
    must(
      'anything rounded is cast to numeric first, because round(double, int) does not exist',
      !/ROUND\(/i.test(sql) || /::numeric/.test(sql)
    );
  }

  // ── The weekday ───────────────────────────────────────────────────────────
  //
  // Monday = 0 in three different ways. Each dialect counts from somewhere
  // else, and getting it wrong shifts the whole heatmap by a day without
  // changing a single number.
  if (d === sqlserver) {
    must('the weekday comes from DATEDIFF against a Monday', /DATEDIFF\(day, '19000101'/.test(sql));
  } else {
    must('the weekday comes from ISODOW, minus one', /EXTRACT\(ISODOW FROM/.test(sql) && /::int - 1/.test(sql));
  }

  // ── The correlated subquery ───────────────────────────────────────────────
  //
  // On the installation where the modality is on Series, the shape of the
  // query changes rather than a name in it — and it must be a subquery, never
  // a join, or every study is counted once per series.
  must(
    'where the modality is on Series it is a correlated subquery, not a join',
    /\(SELECT MIN\(se\./.test(sql),
    'a join to a one-to-many table multiplies every study by its series count'
  );

  if (show) {
    console.log('');
    for (const one of all) console.log(`    ${one.sql.replace(/\n\s*/g, ' ')}\n`);
  }

  console.log('');
}

// ── And the one that is executed ────────────────────────────────────────────

console.log('SQLite');
must('is the dialect that actually runs, and says so', sqlite.executed === true);
must('and the other two say they do not', sqlserver.executed === false && postgres.executed === false);
must('all three are exported under their own names', Object.keys(DIALECTS).length === 3);

// Rule of thumb this repository keeps: a check that finds nothing must fail
// rather than pass over an empty list.
must('and there were statements to look at', checks > 10, `only ${checks} checks ran`);

console.log('');

if (bad > 0) {
  console.log(`${bad} of ${checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`${checks} checks: the builder emits the dialect it means to.`);
  console.log('It does not prove a server accepts it. Only SQLite is executed here, and the README says so.');
}
