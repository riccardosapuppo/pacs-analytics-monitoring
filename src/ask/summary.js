/**
 * The headline numbers: how much is in here, and how big is it.
 *
 * Everything on this page is one row, and it carries `undatable` with it —
 * the count of studies the date guard removed. Without that number the headline
 * count and every chart under it are computed over different sets of rows and
 * nobody can tell.
 */

import { parameters } from '../db/sqlite.js';
import { datable, within, withoutDateGuard } from './dates.js';

/**
 * `SUM` over a column that may not exist has to become a literal zero rather
 * than a missing clause, or the shape of the result changes with the schema and
 * every caller has to check.
 */
function sum(schema, d, field, alias = 's') {
  const column = schema[field];
  return column ? `SUM(${d.toFloat(`${alias}.${d.quote(column)}`)})` : '0';
}

export function summary(run, d, schema, filters = {}) {
  const bind = parameters(d);
  const where = within(schema, d, bind, filters, 's');

  const row = run(
    `SELECT ${d.count()} AS studies,
            ${sum(schema, d, 'size')} AS storagekb,
            ${sum(schema, d, 'series')} AS series,
            ${sum(schema, d, 'instances')} AS instances,
            ${schema.patient ? `COUNT(DISTINCT s.${d.quote(schema.patient)})` : '0'} AS patients
       FROM ${d.quote(schema.table)} s
      WHERE ${where}`,
    bind.values
  )[0];

  // The same question with the date guard removed, so the difference is exactly
  // the rows the guard took out — taken under the same partition filter, or it
  // would be counting a site the reader is not looking at, and NOT under the
  // period, because a row that cannot be dated cannot be put inside one. That
  // asymmetry is the honest answer to "how many are missing from this chart":
  // the number is a property of the archive, not of the period on screen.
  const loose = parameters(d);
  const total = run(
    `SELECT ${d.count()} AS n
       FROM ${d.quote(schema.table)} s
      WHERE ${withoutDateGuard(schema, d, loose, filters, 's')}`,
    loose.values
  )[0];

  const dated = parameters(d);
  const datedRows = run(
    `SELECT ${d.count()} AS n
       FROM ${d.quote(schema.table)} s
      WHERE ${datable(schema, d, 's')} AND ${withoutDateGuard(schema, d, dated, filters, 's')}`,
    dated.values
  )[0];

  return {
    studies: Number(row.studies ?? 0),
    storageKB: Number(row.storagekb ?? 0),
    series: Number(row.series ?? 0),
    instances: Number(row.instances ?? 0),
    patients: Number(row.patients ?? 0),

    /**
     * Studies whose `StudyDate` is not eight digits: they are in the archive
     * and they are in no chart on this page. Reported, always, even when zero —
     * a field that appears only when it is interesting teaches the reader to
     * assume its absence means nothing rather than means none.
     */
    undatable: Number(total.n ?? 0) - Number(datedRows.n ?? 0),
    inTheArchive: Number(total.n ?? 0),
  };
}
