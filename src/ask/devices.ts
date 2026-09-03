/**
 * Which machine produced what.
 *
 * This is the view that is sometimes impossible, and that is the point of it
 * being here. The source device column is optional: it arrived in a later
 * version of the schema, and a site that upgraded the application without the
 * schema step does not have it.
 *
 * **"This cannot be answered here, and here is why" is a correct answer.** The
 * alternatives are worse in both directions: crashing the page because one
 * panel of six is unavailable, or drawing an empty chart, which a reader
 * reasonably interprets as "no studies" rather than "no column".
 */

import type { Bind, Dialect, Filters, Run, Schema } from './shapes.ts';

import { parameters } from '../db/sqlite.ts';
import { within } from './dates.ts';

export function devices(run: Run, d: Dialect, schema: Schema, filters: Filters = {}) {
  if (!schema.device) {
    return {
      available: false,
      why:
        'this database has no source device column — it is optional, and was added in a later ' +
        'version of the schema than the one installed here',
      looked: ['SourceDevice', 'SourceAeTitle', 'SourceApplicationEntityTitle'],
      rows: [],
    };
  }

  const bind = parameters(d);
  const column = `s.${d.quote(schema.device)}`;

  const rows = run(
    `SELECT ${column} AS device,
            ${d.count()} AS studies,
            SUM(${d.toFloat(`s.${d.quote(schema.size)}`)}) AS storagekb,
            SUM(${d.toFloat(`s.${d.quote(schema.instances)}`)}) AS instances
       FROM ${d.quote(schema.table)} s
      WHERE ${within(schema, d, bind, filters, 's')} AND ${column} IS NOT NULL
      GROUP BY ${column}
      ORDER BY ${d.count()} DESC`,
    bind.values
  );

  return {
    available: true,
    column: schema.device,
    rows: rows.map((row) => ({
      device: row.device,
      studies: Number(row.studies ?? 0),
      storageKB: Number(row.storagekb ?? 0),
      instances: Number(row.instances ?? 0),
    })),
  };
}
