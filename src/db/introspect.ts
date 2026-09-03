/**
 * Finding out what the database actually looks like, instead of assuming.
 *
 * This is the step the whole project turns on. Analytics code that names its
 * columns in a string literal is code that works at the site it was written for
 * and nowhere else — and the way it fails at the second site is not always an
 * error. Sometimes it is a number.
 *
 * Two rules, both learned from the shape of the original:
 *
 *  1. **Keep the case the database gave you.** PostgreSQL treats a
 *     double-quoted identifier as case-sensitive, so `"studydate"` will not find
 *     a column called `StudyDate`. Lowercasing names on the way in is tidy and
 *     wrong; lowercasing them only to *look them up* is what is wanted.
 *
 *  2. **Ask for candidates in order, and let the answer be `null`.** A field
 *     that is not there is a fact about this installation, not a failure. What
 *     is done about it belongs to the query, not to the lookup.
 */

import type { Dialect } from './dialect.ts';
import type { Row, Run } from './sqlite.ts';

/**
 * Every table in the database, as a map from lowercase name to the real one.
 */
export function tablesIn(run: Run, d: Dialect): Map<string, string> {
  const rows = run<{ name: string }>(d.tables());
  return new Map(rows.map((row) => [String(row.name).toLowerCase(), String(row.name)]));
}

/**
 * Every column of one table, as a map from lowercase name to the real one, or
 * `null` if the table itself is not there.
 */
export function columnsOf(run: Run, d: Dialect, table: string): Map<string, string> | null {
  const rows = run<{ name: string }>(d.columns(table));
  if (!rows.length) return null;

  return new Map(rows.map((row) => [String(row.name).toLowerCase(), String(row.name)]));
}

/**
 * The first candidate that exists, in the case the database uses — or `null`.
 *
 * The order is the argument. `['StudySizeInKB', 'StudySizeKB', 'StudySize']`
 * says these are the same quantity under three names and the first is the one
 * to prefer where more than one is present, which does happen: a column added
 * by an upgrade sits beside the one it replaced, and the old one stops being
 * written to without being dropped. Preferring the newer name is the difference
 * between a storage chart that is current and one that stopped growing in 2021.
 */
export function pickColumn(columns: Map<string, string> | null, candidates: readonly string[]): string | null {
  if (!columns) return null;

  for (const candidate of candidates) {
    const real = columns.get(String(candidate).toLowerCase());
    if (real) return real;
  }

  return null;
}

/**
 * Rows come back with whatever case the driver felt like.
 *
 * SQL Server returns the column name as written in the SELECT, PostgreSQL folds
 * unquoted output names to lowercase, and code that reads `row.StudyDate` works
 * against one of them. Every row that leaves the database goes through here, so
 * the rest of the code can read a row by a name it chose itself.
 */
export function readable(row: Record<string, unknown>): Row {
  const out = Object.create(null);

  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
    out[key.toLowerCase()] = value;
  }

  return out;
}
