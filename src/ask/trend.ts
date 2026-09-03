/**
 * Studies over time, and storage over time.
 *
 * The bucket is a substring of the date column — the one operation `YYYYMMDD`
 * as a string is genuinely good at, since the first four characters are the
 * year and the first six are the month, with no parsing and no time zone.
 *
 * The guard from `dates.js` is what keeps a bucket called `2024-0` off the
 * chart. Without it, `SUBSTR('2024-03-05', 1, 6)` is `'2024-0'` and a bar
 * appears between February and March, four pixels tall, that nobody queries and
 * everybody eventually asks about.
 *
 * Empty buckets are filled in here rather than left out. A month with no
 * studies is a fact worth drawing; a line chart that skips it draws a straight
 * segment across the gap and reports a quiet August as a busy one.
 */

import type { Bind, Dialect, Filters, Run, Schema } from './shapes.ts';

import { parameters } from '../db/sqlite.ts';
import { GRANULARITY, bucket, readBucket, within } from './dates.ts';

export function trend(run: Run, d: Dialect, schema: Schema, filters: Filters = {}) {
  const granularity = filters.granularity ?? 'month';
  if (!GRANULARITY[granularity as keyof typeof GRANULARITY]) {
    throw new Error(`granularity must be one of ${Object.keys(GRANULARITY).join(', ')}`);
  }

  const bind = parameters(d);
  const key = bucket(schema, d, granularity, 's');

  const rows = run(
    `SELECT ${key} AS bucket,
            ${d.count()} AS studies,
            SUM(${d.toFloat(`s.${d.quote(schema.size)}`)}) AS storagekb
       FROM ${d.quote(schema.table)} s
      WHERE ${within(schema, d, bind, filters, 's')}
      GROUP BY ${key}
      ORDER BY ${key}`,
    bind.values
  ).map((row) => ({
    bucket: String(row.bucket),
    label: readBucket(String(row.bucket)),
    studies: Number(row.studies ?? 0),
    storageKB: Number(row.storagekb ?? 0),
  }));

  return { granularity, rows: fillGaps(rows, granularity) };
}

/**
 * Put back the buckets with nothing in them.
 *
 * Only between the first and last bucket that has data: extending to the edges
 * of the requested period would draw months of zeroes on either side of an
 * archive that simply did not exist yet, which is a different lie.
 */
function fillGaps(rows: Array<Record<string, unknown>>, granularity: string) {
  if (rows.length < 2 || granularity === 'day') return rows;

  const have = new Map(rows.map((row) => [String(row.bucket), row]));
  const out: Array<Record<string, unknown>> = [];

  const step = granularity === 'year' ? nextYear : nextMonth;
  let key = String(rows[0]!.bucket);
  const last = String(rows[rows.length - 1]!.bucket);

  // A bound, because a malformed bucket that never reaches `last` would spin
  // here forever rather than fail. Two hundred years of months is enough.
  for (let guard = 0; guard < 2400; guard += 1) {
    out.push(have.get(key) ?? { bucket: key, label: readBucket(key), studies: 0, storageKB: 0 });
    if (key === last) return out;
    key = step(key);
  }

  return rows;
}

function nextMonth(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  return month === 12 ? `${year + 1}01` : `${year}${String(month + 1).padStart(2, '0')}`;
}

function nextYear(key: string): string {
  return String(Number(key) + 1);
}
