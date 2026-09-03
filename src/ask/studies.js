/**
 * Finding one study, out of an archive of them.
 *
 * The list behind every other number on the page: somebody sees a bar that
 * looks wrong and wants the rows under it. A dashboard whose figures cannot be
 * opened is a dashboard nobody can argue with, which sounds like a strength
 * until the first time one of them is wrong.
 *
 * ── Nothing here is escaped, and that is the point ───────────────────────────
 *
 * Every value a caller supplies goes through `bind.add(…)` and comes back as a
 * placeholder. There is **no escaping function in this directory**, which is a
 * stronger guarantee than any amount of careful quoting: there is nothing to
 * get wrong, and nothing to forget on the one branch nobody tested.
 *
 * Column and table names are a different matter — they cannot be parameters in
 * any dialect — and they never come from a request. They come from
 * introspection, which means they came from the database itself, and they are
 * checked against `[A-Za-z_][A-Za-z0-9_]*` on the way out (`quote` in
 * `src/db/dialect.js`) before they are quoted.
 */

import { parameters } from '../db/sqlite.js';
import { fromDicomDate, within } from './dates.js';
import { modalityExpression } from '../db/schema.js';

/** The most any one page may ask for. Above this it is an export, not a page. */
export const MOST_PER_PAGE = 200;

export function studies(run, d, schema, filters = {}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const size = Math.min(MOST_PER_PAGE, Math.max(1, Number(filters.pageSize) || 50));

  const bind = parameters(d);
  const where = whereFor(schema, d, bind, filters);

  const total = Number(
    run(`SELECT ${d.count()} AS n FROM ${d.quote(schema.table)} s WHERE ${where}`, bind.values)[0].n ?? 0
  );

  const rows = parameters(d);
  const clause = whereFor(schema, d, rows, filters);

  // Paged in the database, not in the application. Fetching the lot and
  // slicing it is the version that works on the demonstration and takes the
  // service down on the first real archive.
  const found = run(
    `SELECT ${selectList(schema, d)}
       FROM ${d.quote(schema.table)} s
      WHERE ${clause}
      ORDER BY s.${d.quote(schema.date)} DESC, s.${d.quote(schema.uid)}
      LIMIT ${rows.add(size)} OFFSET ${rows.add((page - 1) * size)}`,
    rows.values
  );

  return {
    total,
    page,
    pageSize: size,
    pages: Math.max(1, Math.ceil(total / size)),
    rows: found.map((row) => asStudy(row, schema)),
  };
}

/**
 * The filters, all of them parameterised.
 *
 * `LIKE` needs its own care: the pattern is built here and bound as a value, so
 * a `%` a caller types is a literal per cent in their search rather than a
 * wildcard they did not know they had asked for.
 */
function whereFor(schema, d, bind, filters) {
  const clauses = [within(schema, d, bind, filters, 's')];

  const like = (column, value) => {
    if (!value || !column) return;
    clauses.push(`${d.quote(column)} LIKE ${bind.add(`%${String(value).replace(/[%_]/g, ' ')}%`)}`);
  };

  like(schema.accession, filters.accession);
  like(schema.description, filters.description);
  like(schema.device, filters.device);

  if (filters.uid && schema.uid) {
    clauses.push(`s.${d.quote(schema.uid)} = ${bind.add(String(filters.uid))}`);
  }

  if (filters.modality) {
    const expression = modalityExpression(schema, d, 's');

    if (expression) {
      // `LIKE` rather than `=`, because ModalitiesInStudy may hold more than
      // one: a study that is `CT\MR` is a CT study, and an equality test says
      // it is not.
      clauses.push(`${expression} LIKE ${bind.add(`%${String(filters.modality).replace(/[%_]/g, ' ')}%`)}`);
    }
  }

  return clauses.join(' AND ');
}

function selectList(schema, d) {
  const modality = modalityExpression(schema, d, 's');

  const columns = [
    [schema.uid, 'uid'],
    [schema.accession, 'accession'],
    [schema.date, 'studydate'],
    [schema.time, 'studytime'],
    [schema.description, 'description'],
    [schema.device, 'device'],
    [schema.series, 'series'],
    [schema.instances, 'instances'],
    [schema.size, 'sizekb'],
  ]
    .filter(([column]) => column)
    .map(([column, as]) => `s.${d.quote(column)} AS ${as}`);

  // A column that is not there becomes a null of the right name rather than a
  // missing key: every row that leaves here has the same shape, and a caller
  // that had to check would be a caller that forgets to.
  const missing = ['uid', 'accession', 'studydate', 'studytime', 'description', 'device', 'series', 'instances', 'sizekb'].filter(
    (name) => !columns.some((one) => one.endsWith(` AS ${name}`))
  );

  return [
    ...columns,
    ...missing.map((name) => `NULL AS ${name}`),
    `${modality ?? 'NULL'} AS modality`,
  ].join(',\n            ');
}

function asStudy(row, schema) {
  return {
    uid: row.uid ?? null,
    accession: row.accession ?? null,
    date: row.studydate ? fromDicomDate(row.studydate) : null,
    time: readTime(row.studytime),
    description: row.description ?? null,
    device: row.device ?? null,
    modality: row.modality ?? null,
    series: row.series === null || row.series === undefined ? null : Number(row.series),
    instances: row.instances === null || row.instances === undefined ? null : Number(row.instances),
    sizeKB: row.sizekb === null || row.sizekb === undefined ? null : Number(row.sizekb),
    /** Which column the size came from, so a number can be traced to a column. */
    sizeFrom: schema.size,
  };
}

/** `'093015'` → `'09:30'`. Anything that is not six digits comes back as null. */
function readTime(value) {
  const text = String(value ?? '');
  return /^\d{4,6}$/.test(text) ? `${text.slice(0, 2)}:${text.slice(2, 4)}` : null;
}

/**
 * The same rows, as a CSV somebody will open in a spreadsheet.
 *
 * Three decisions, all of them about the spreadsheet rather than the standard:
 *
 * **A semicolon**, because a comma is a decimal separator across most of
 * Europe and a comma-separated file opens there as one column.
 *
 * **A byte-order mark**, because without one Excel reads the file as the
 * system's ANSI codepage and every accented character in a patient's name
 * arrives broken. Three bytes, and the difference between a file that works and
 * a support ticket.
 *
 * **A leading apostrophe on anything that starts with `=`, `+`, `-` or `@`.**
 * A spreadsheet treats those as formulas, so a study description beginning with
 * a minus sign becomes an error cell — and, on a machine that allows it, a cell
 * beginning `=` is a way to make a spreadsheet do something on somebody else's
 * behalf.
 */
export function asCsv(rows, { separator = ';', bom = true } = {}) {
  const columns = ['uid', 'accession', 'date', 'time', 'modality', 'description', 'device', 'series', 'instances', 'sizeKB'];

  const cell = (value) => {
    if (value === null || value === undefined) return '';

    let text = String(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;

    return /["\n\r]|[;,\t]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.join(separator), ...rows.map((row) => columns.map((name) => cell(row[name])).join(separator))];

  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}
