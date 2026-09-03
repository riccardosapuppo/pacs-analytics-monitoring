/**
 * How many studies of each kind — the chart everyone looks at first, and the
 * one with two different ways of being quietly wrong.
 *
 * ── One: the modality is not where the documentation says ────────────────────
 *
 * On some installations `Study` has no modality column and the value is on
 * `Series`, one row per series. The obvious repair is a join, and a join to a
 * one-to-many table multiplies: a CT with six series becomes six CT studies
 * carrying six times its storage. Across this archive that is a factor of about
 * 4.4, applied unevenly — CT and MR inflate hardest because they have the most
 * series — so the chart keeps its shape and changes its meaning.
 *
 * The fix here is not "avoid the join". It is that **the right query depends on
 * what is being counted**:
 *
 *   - counting *studies per modality*, a join is right, as long as it counts
 *     `DISTINCT` studies rather than rows. A study containing CT and MR series
 *     genuinely is a CT study and an MR study;
 *   - summing *anything belonging to the study* — storage, instances — across
 *     that join is wrong however it is counted, because the study's size lands
 *     once per series. So the sum is taken separately, per study, and joined
 *     back on.
 *
 * ── Two: the column holds more than one modality ─────────────────────────────
 *
 * `ModalitiesInStudy` is multi-valued in the standard, backslash delimited, so
 * `CT\MR` is a correct value. A `GROUP BY` on it produces a category that is
 * neither CT nor MR, and takes that study away from both. In this archive that
 * is 53 studies: CT drops from 214 to 161 and a slice appears that no
 * radiologist has ever ordered.
 *
 * Splitting is done here, after the group, rather than in SQL — splitting a
 * delimited string is a different function in each of the three dialects and
 * none of them are worth it for a handful of distinct values.
 *
 * The consequence is stated rather than hidden: a study with two modalities is
 * counted under both, so **the column adds to more than the archive holds**.
 * `overlapping` says how many studies are in more than one row, and the storage
 * figure carries the same caveat — bytes cannot be divided between modalities
 * without inventing a division, so they are not divided.
 */

import type { Bind, Dialect, Filters, Run, Schema } from './shapes.ts';

import { parameters } from '../db/sqlite.ts';
import { modalityExpression } from '../db/schema.ts';
import { within } from './dates.ts';

/** DICOM value multiplicity: one field, several values, backslash between. */
export const DELIMITER = String.fromCharCode(92);

export function splitModalities(value: unknown): string[] {
  return String(value ?? '')
    .split(DELIMITER)
    .map((one) => one.trim().toUpperCase())
    .filter(Boolean);
}

export function modalities(run: Run, d: Dialect, schema: Schema, filters: Filters = {}) {
  if (!schema.modalityFrom) {
    return {
      available: false,
      why: 'no column in this database records the modality of a study',
      rows: [],
    };
  }

  const raw = schema.modalityFrom === 'series' ? fromSeries(run, d, schema, filters) : fromStudy(run, d, schema, filters);

  // Fold the multi-valued keys into the single-valued ones.
  const folded = new Map();
  let overlapping = 0;

  for (const row of raw) {
    const parts = splitModalities(row.modality);
    if (!parts.length) continue;
    if (parts.length > 1) overlapping += row.studies;

    for (const part of parts) {
      const already = folded.get(part) ?? { modality: part, studies: 0, storageKB: 0 };
      already.studies += row.studies;
      already.storageKB += row.storageKB;
      folded.set(part, already);
    }
  }

  const rows = [...folded.values()].sort((a, b) => b.studies - a.studies);
  const total = rows.reduce((n, one) => n + one.studies, 0);

  return {
    available: true,
    from: schema.modalityFrom,
    rows: rows.map((one) => ({ ...one, share: total ? one.studies / total : 0 })),

    /**
     * Studies appearing in more than one row. When this is not zero the column
     * sums to more than the archive contains, and saying so is the difference
     * between a chart and a chart with a footnote that makes it usable.
     */
    overlapping,
    storageOverlaps: overlapping > 0,
  };
}

/** The modality is a column on Study: an ordinary grouped count. */
function fromStudy(run: Run, d: Dialect, schema: Schema, filters: Filters) {
  const bind = parameters(d);
  const expression = modalityExpression(schema, d, 's');

  return run(
    `SELECT ${expression} AS modality,
            ${d.count()} AS studies,
            SUM(${d.toFloat(`s.${d.quote(schema.size)}`)}) AS storagekb
       FROM ${d.quote(schema.table)} s
      WHERE ${within(schema, d, bind, filters, 's')}
      GROUP BY ${expression}`,
    bind.values
  ).map((row) => ({
    modality: row.modality,
    studies: Number(row.studies ?? 0),
    storageKB: Number(row.storagekb ?? 0),
  }));
}

/**
 * The modality is on Series. Two queries, on purpose.
 *
 * The first counts DISTINCT studies per modality through the join — which is
 * the correct count, and a study with CT and MR series correctly appears in
 * both. The second sums each study's storage **once**, per study, and the two
 * are put together here.
 *
 * Doing it in one statement would mean summing across the join, which is the
 * multiplication this whole file exists to avoid.
 */
function fromSeries(run: Run, d: Dialect, schema: Schema, filters: Filters) {
  const bind = parameters(d);
  const where = within(schema, d, bind, filters, 's');

  const counted = run(
    `SELECT se.${d.quote(schema.seriesModality)} AS modality,
            COUNT(DISTINCT s.${d.quote(schema.guid)}) AS studies
       FROM ${d.quote(schema.table)} s
       JOIN ${d.quote(schema.seriesTable)} se
         ON se.${d.quote(schema.seriesStudyGuid)} = s.${d.quote(schema.guid)}
      WHERE ${where}
      GROUP BY se.${d.quote(schema.seriesModality)}`,
    bind.values
  );

  // Storage per modality, from a per-study subquery so each study's size is
  // added once no matter how many series it has.
  const sized = parameters(d);
  const stored = run(
    `SELECT m.modality AS modality, SUM(m.size) AS storagekb
       FROM (SELECT s.${d.quote(schema.guid)} AS guid,
                    MIN(${d.toFloat(`s.${d.quote(schema.size)}`)}) AS size,
                    se.${d.quote(schema.seriesModality)} AS modality
               FROM ${d.quote(schema.table)} s
               JOIN ${d.quote(schema.seriesTable)} se
                 ON se.${d.quote(schema.seriesStudyGuid)} = s.${d.quote(schema.guid)}
              WHERE ${within(schema, d, sized, filters, 's')}
              GROUP BY s.${d.quote(schema.guid)}, se.${d.quote(schema.seriesModality)}) m
      GROUP BY m.modality`,
    sized.values
  );

  const storage = new Map(stored.map((row) => [row.modality, Number(row.storagekb ?? 0)]));

  return counted.map((row) => ({
    modality: row.modality,
    studies: Number(row.studies ?? 0),
    storageKB: storage.get(row.modality) ?? 0,
  }));
}
