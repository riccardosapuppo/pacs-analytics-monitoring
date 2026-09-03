/**
 * How much room it is taking, and when it will need more.
 *
 * The forecast is a straight line fitted to what has happened, and saying so is
 * more important than the arithmetic. It is not a model, it does not know about
 * the new scanner arriving in March, and a page that presented it as a
 * prediction would be presenting a subtraction as insight.
 *
 * What it is good for is one question — *roughly when does this become
 * somebody's problem* — asked of a number nobody currently has.
 */

import { parameters } from '../db/sqlite.js';
import { within, year } from './dates.js';

export function storage(run, d, schema, filters = {}) {
  const bind = parameters(d);
  const key = year(schema, d, 's');

  const rows = run(
    `SELECT ${key} AS year,
            ${d.count()} AS studies,
            SUM(${d.toFloat(`s.${d.quote(schema.size)}`)}) AS kb
       FROM ${d.quote(schema.table)} s
      WHERE ${within(schema, d, bind, filters, 's')}
      GROUP BY ${key}
      ORDER BY ${key}`,
    bind.values
  ).map((row) => ({
    year: Number(row.year),
    studies: Number(row.studies ?? 0),
    kb: Number(row.kb ?? 0),
    gb: Number(row.kb ?? 0) / 1024 / 1024,
  }));

  return {
    years: rows,
    total: { kb: rows.reduce((n, one) => n + one.kb, 0), studies: rows.reduce((n, one) => n + one.studies, 0) },
    forecast: forecast(rows),
  };
}

/**
 * A straight line through the years, extended three more.
 *
 * ── Why it refuses more often than it answers ────────────────────────────────
 *
 * Two points define a line exactly, which is why a forecast from two years of
 * data looks so convincing and means so little. Below three it says so instead.
 *
 * And the **last year is dropped when it is not finished**, which is the
 * mistake that makes every one of these charts turn downwards at the right-hand
 * edge: a year with four months in it is not a year with a third of the usual
 * traffic, but a line fitted through it says the archive is shrinking.
 */
export function forecast(years, { ahead = 3, thisYear = null } = {}) {
  const current = thisYear ?? new Date().getUTCFullYear();
  const complete = years.filter((one) => one.year < current);

  if (complete.length < 3) {
    return {
      possible: false,
      why:
        `a line through ${complete.length} complete ${complete.length === 1 ? 'year' : 'years'} is not a forecast` +
        (years.length > complete.length ? ' — the current year is left out, because a part of a year fitted as a whole one points downwards' : ''),
      years: [],
    };
  }

  // Least squares, on the year number and the gigabytes. Nine lines, and every
  // one of them is visible — which is the point of not reaching for a library
  // to draw a line through five numbers.
  const n = complete.length;
  const meanX = complete.reduce((total, one) => total + one.year, 0) / n;
  const meanY = complete.reduce((total, one) => total + one.gb, 0) / n;

  let top = 0;
  let bottom = 0;

  for (const one of complete) {
    top += (one.year - meanX) * (one.gb - meanY);
    bottom += (one.year - meanX) ** 2;
  }

  const slope = bottom === 0 ? 0 : top / bottom;
  const at = (x) => meanY + slope * (x - meanX);

  return {
    possible: true,
    from: complete.length,
    perYearGB: slope,
    how: 'a straight line through the complete years, and nothing more',
    years: Array.from({ length: ahead }, (_, i) => {
      const which = complete.at(-1).year + i + 1;
      return { year: which, gb: Math.max(0, at(which)) };
    }),
  };
}

/**
 * When a volume of a given size runs out, at that rate.
 *
 * Separate from the forecast because it is a different kind of statement: the
 * forecast is about the archive, this is about a disk somebody bought — and if
 * nobody has said how big the disk is, the honest answer is that there is not
 * one, rather than a number derived from a default.
 */
export function whenItRunsOut(used, forecastResult, capacityGB) {
  if (!capacityGB) {
    return { known: false, why: 'nobody has said how large the volume is (PACS_CAPACITY_GB)' };
  }

  if (!forecastResult.possible || forecastResult.perYearGB <= 0) {
    return { known: false, why: 'not growing, or not enough complete years to say' };
  }

  const left = capacityGB - used;

  return {
    known: true,
    capacityGB,
    usedGB: used,
    percentUsed: (used / capacityGB) * 100,
    yearsLeft: Math.max(0, left / forecastResult.perYearGB),
  };
}
