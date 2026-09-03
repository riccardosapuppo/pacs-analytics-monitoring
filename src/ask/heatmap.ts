/**
 * When the archive is busy: day of the week against hour of the day.
 *
 * Two string columns, neither of them a date or a time. The weekday has to come
 * out of `YYYYMMDD` and the hour out of the first two characters of `HHMMSS`,
 * and both are done in SQL rather than by dragging every row into JavaScript —
 * at a million studies the difference between grouping in the database and
 * grouping in the application is the difference between a page and a timeout.
 *
 * Monday is 0 in all three dialects, and getting there costs a different
 * expression in each (see `weekday` in `src/db/dialect.js`). SQLite counts from
 * Sunday, SQL Server counts days since a Monday in 1900, PostgreSQL has ISODOW
 * and starts at 1. None of them agree, all of them are one line, and the line
 * belongs in the dialect rather than in this file.
 */

import type { Bind, Dialect, Filters, Run, Schema } from './shapes.ts';

import { parameters } from '../db/sqlite.ts';
import { within } from './dates.ts';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function heatmap(run: Run, d: Dialect, schema: Schema, filters: Filters = {}) {
  if (!schema.time) {
    return {
      available: false,
      why: 'this database has no study time column, so the hour of a study is not recorded',
      grid: [],
    };
  }

  const bind = parameters(d);
  const date = `s.${d.quote(schema.date)}`;
  const time = `s.${d.quote(schema.time)}`;

  const rows = run(
    `SELECT ${d.weekday(date)} AS weekday,
            ${d.hour(time)} AS hour,
            ${d.count()} AS studies
       FROM ${d.quote(schema.table)} s
      WHERE ${within(schema, d, bind, filters, 's')}
        AND ${time} IS NOT NULL
        AND ${d.length(time)} >= 2
        AND ${d.digitsOnly(d.substring(time, 1, 2))}
      GROUP BY ${d.weekday(date)}, ${d.hour(time)}`,
    bind.values
  );

  // A full grid, always. A sparse one makes every reader of it write the same
  // loop, and one of them will index it the other way round.
  const grid = DAYS.map(() => new Array(24).fill(0));
  let busiest = { weekday: 0, hour: 0, studies: 0 };

  for (const row of rows) {
    const weekday = Number(row.weekday);
    const hour = Number(row.hour);

    // A row whose weekday or hour landed outside the grid is a row this code
    // does not understand. Dropping it silently would be the same mistake as
    // the date guard exists to prevent, so it is counted instead.
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;

    const studies = Number(row.studies ?? 0);
    grid[weekday][hour] += studies;

    if (grid[weekday][hour] > busiest.studies) {
      busiest = { weekday, hour, studies: grid[weekday][hour] };
    }
  }

  const placed = grid.flat().reduce((n, one) => n + one, 0);
  const total = rows.reduce((n, row) => n + Number(row.studies ?? 0), 0);

  return {
    available: true,
    days: DAYS,
    grid,
    busiest: { ...busiest, day: DAYS[busiest.weekday] },
    /** Rows whose weekday or hour was out of range, and so are in no cell. */
    unplaced: total - placed,
  };
}
