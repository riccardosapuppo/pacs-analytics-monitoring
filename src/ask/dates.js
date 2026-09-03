/**
 * Dates that are not dates.
 *
 * `StudyDate` is a `VARCHAR(8)` holding a DICOM `YYYYMMDD`, which is to say it
 * is a string column holding whatever the sending modality decided to put in
 * it. There is no constraint on it and there never was: the archive's job is to
 * accept the study, not to argue with the scanner about formatting.
 *
 * So over a couple of years the column collects `NULL`, `''`, `'2024-03-05'`
 * from a modality configured for humans, and the occasional word. Four of those
 * live in the `undatable-rows` installation, and they are enough to make a
 * dashboard contradict itself.
 *
 * ── Why a range filter is not enough ─────────────────────────────────────────
 *
 * The tempting answer is that rubbish falls outside the range anyway. It mostly
 * does, by accident: `'UNKNOWN' >= '20240101'` is true but `<= '20241231'` is
 * false, because `'U'` sorts after `'2'`. That is not a guard, it is a
 * coincidence of ASCII, and it does not help the queries that have no range —
 * "how many studies are in the archive" — or the ones that GROUP BY a substring
 * of the column, which will happily produce a bucket called `2024-0`.
 *
 * ── The actual problem it causes ─────────────────────────────────────────────
 *
 * Two numbers on one page stop agreeing. The headline count includes the
 * undatable rows because it does not filter by date; the chart beside it
 * excludes them because it does. The difference is four, nobody can see four in
 * a bar chart, and the page is quietly wrong in a way that surfaces months
 * later as "the totals don't match" with no way to work out which one to trust.
 *
 * So: **every dated query carries the same guard, and every answer says how
 * many rows the guard removed.** A number that is missing four studies and says
 * so is a usable number. The same number in silence is not.
 */

/** `2024-03-05`, `2024/03/05`, `20240305`, a `Date` → `'20240305'`, or null. */
export function toDicomDate(input) {
  if (!input) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  const match = String(input)
    .trim()
    .match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/);

  return match ? `${match[1]}${match[2]}${match[3]}` : null;
}

/** `'20240305'` → `'2024-03-05'`, for reading. Anything else comes back as-is. */
export function fromDicomDate(value) {
  const text = String(value ?? '');
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
}

/**
 * The guard: eight characters, all of them digits, and present.
 *
 * Length before digits is deliberate. `'2024-03-05'` is ten characters and
 * fails on the first test, so the second never runs on it — which matters on
 * SQL Server, where `NOT LIKE '%[^0-9]%'` on a long string is the more
 * expensive of the two.
 */
export function datable(schema, d, alias = '') {
  const column = `${alias ? `${alias}.` : ''}${d.quote(schema.date)}`;

  return [`${column} IS NOT NULL`, `${d.length(column)} = 8`, d.digitsOnly(column)].join(' AND ');
}

/**
 * The `WHERE` for a dated question: the guard, then the period, then the
 * partition — all of it parameterised.
 *
 * `bind` is the parameter collector from `src/db/sqlite.js`. Values go through
 * it and come back as placeholders, so there is no path by which a filter
 * reaches the SQL text. That is worth more than any amount of escaping: there
 * is no escaping function in this directory to get wrong.
 */
export function within(schema, d, bind, filters = {}, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const column = `${prefix}${d.quote(schema.date)}`;
  const clauses = [datable(schema, d, alias)];

  const from = toDicomDate(filters.from);
  const to = toDicomDate(filters.to);

  // String comparison, and correct: `YYYYMMDD` is the one date format where
  // lexicographic order and chronological order are the same thing. That is why
  // DICOM chose it, and it is the one thing about this column that is a gift.
  if (from) clauses.push(`${column} >= ${bind.add(from)}`);
  if (to) clauses.push(`${column} <= ${bind.add(to)}`);

  if (filters.partition && schema.partition) {
    // Compared as text so the same expression works whether the column is a
    // `uniqueidentifier`, a `uuid` or, here, a `TEXT`.
    clauses.push(`CAST(${prefix}${d.quote(schema.partition)} AS varchar(64)) = ${bind.add(String(filters.partition))}`);
  }

  return clauses.join(' AND ');
}

/**
 * Everything except the date guard — for counting what the guard removes.
 *
 * The count of undatable rows has to be taken under the *same* partition filter
 * as the answer it accompanies, or it reports rubbish from a site the reader is
 * not looking at.
 */
export function withoutDateGuard(schema, d, bind, filters = {}, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  const clauses = [];

  if (filters.partition && schema.partition) {
    clauses.push(`CAST(${prefix}${d.quote(schema.partition)} AS varchar(64)) = ${bind.add(String(filters.partition))}`);
  }

  return clauses.length ? clauses.join(' AND ') : '1 = 1';
}

/** The month a `YYYYMMDD` falls in, as a SQL expression: `'202403'`. */
export function month(schema, d, alias = '') {
  return d.substring(`${alias ? `${alias}.` : ''}${d.quote(schema.date)}`, 1, 6);
}

/** The year, as a SQL expression: `'2024'`. */
export function year(schema, d, alias = '') {
  return d.substring(`${alias ? `${alias}.` : ''}${d.quote(schema.date)}`, 1, 4);
}

/** Buckets a trend can be asked for, and how wide each key is. */
export const GRANULARITY = {
  day: 8,
  month: 6,
  year: 4,
};

export function bucket(schema, d, granularity, alias = '') {
  const width = GRANULARITY[granularity];
  if (!width) throw new Error(`granularity must be one of ${Object.keys(GRANULARITY).join(', ')}`);

  return d.substring(`${alias ? `${alias}.` : ''}${d.quote(schema.date)}`, 1, width);
}

/** `'202403'` → `'2024-03'`; `'20240305'` → `'2024-03-05'`; `'2024'` → `'2024'`. */
export function readBucket(key) {
  const text = String(key ?? '');
  if (/^\d{8}$/.test(text)) return fromDicomDate(text);
  if (/^\d{6}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
  return text;
}
