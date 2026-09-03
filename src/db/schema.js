/**
 * What this installation calls the things we need.
 *
 * The candidate lists below are the whole of what this project knows about how
 * the schema drifts between sites, and they are ordered: newest name first,
 * because an upgrade adds a column beside the one it replaces rather than
 * dropping it, and the old one stops being written to.
 *
 * The result is not just a set of names. It also records **where** a thing was
 * found, because for one field — the modality — the answer changes the *shape*
 * of the query rather than an identifier in it, and that is the difference
 * between a right answer and a wrong one that does not look wrong.
 */

import { columnsOf, pickColumn, tablesIn } from './introspect.js';

/**
 * Logical field → the names it goes by, in order of preference.
 *
 * Every entry here is a thing that was actually different somewhere. This is
 * not a list of everything DICOM has; it is a list of what has bitten.
 */
export const CANDIDATES = {
  guid: ['GUID', 'StudyGUID'],
  uid: ['StudyInstanceUid', 'StudyInstanceUID'],
  accession: ['AccessionNumber'],
  patient: ['PatientGUID', 'PatientId', 'PatientID'],
  date: ['StudyDate'],
  time: ['StudyTime'],
  description: ['StudyDescription'],
  modality: ['ModalitiesInStudy', 'Modality', 'PrimaryModality'],
  device: ['SourceDevice', 'SourceAeTitle', 'SourceApplicationEntityTitle'],
  series: ['NumberOfStudyRelatedSeries', 'NumberOfRelatedSeries', 'SeriesCount'],
  instances: ['NumberOfStudyRelatedInstances', 'NumberOfRelatedInstances', 'InstanceCount'],
  size: ['StudySizeInKB', 'StudySizeKB', 'StudySize'],
  partition: ['ServerPartitionGUID'],
};

/** Fields without which nothing can be answered at all. */
const ESSENTIAL = ['guid', 'uid', 'date', 'size'];

/**
 * Read the schema.
 *
 * `run(sql)` executes a statement and returns rows; `d` is the dialect. Both are
 * passed in rather than reached for, so this is testable against six databases
 * without any of them being a global.
 */
export function resolve(run, d) {
  const tables = tablesIn(run, d);

  const studyTable = tables.get('study');
  if (!studyTable) {
    return {
      ok: false,
      why: 'there is no Study table in this database',
      tables: [...tables.values()],
    };
  }

  const study = columnsOf(run, d, studyTable);
  const seriesTable = tables.get('series');
  const series = seriesTable ? columnsOf(run, d, seriesTable) : null;
  const partitionTable = tables.get('serverpartition');
  const partition = partitionTable ? columnsOf(run, d, partitionTable) : null;

  const found = {};
  for (const [field, candidates] of Object.entries(CANDIDATES)) {
    found[field] = pickColumn(study, candidates);
  }

  const schema = {
    ok: true,
    table: studyTable,
    columns: study,
    ...found,

    // ── Where the modality lives, which is a question about query shape ──────
    //
    // On Study it is a column reference. On Series it is a correlated
    // subquery — and it has to be a subquery rather than a join, because
    // Series is one-to-many: joining multiplies every study by the number of
    // series it contains, and takes its storage with it. Nothing errors. The
    // dashboard just reads about four times too high.
    //
    // This is the single most valuable line in the file. `npm run measure`
    // exists mostly to keep it honest.
    seriesTable: seriesTable ?? null,
    seriesModality: series ? pickColumn(series, ['Modality']) : null,
    seriesStudyGuid: series ? pickColumn(series, ['StudyGUID', 'StudyGuid']) : null,

    partitionTable: partitionTable ?? null,
    partitionGuid: partition ? pickColumn(partition, ['GUID']) : null,
    partitionAe: partition ? pickColumn(partition, ['AeTitle']) : null,
    partitionDescription: partition ? pickColumn(partition, ['Description']) : null,
  };

  schema.modalityFrom = whereModalityIs(schema);
  schema.missing = ESSENTIAL.filter((field) => !schema[field]);
  schema.ok = schema.missing.length === 0;
  schema.notes = describe(schema);

  return schema;
}

function whereModalityIs(schema) {
  if (schema.modality) return 'study';
  if (schema.seriesTable && schema.seriesModality && schema.seriesStudyGuid && schema.guid) {
    return 'series';
  }
  return null;
}

/**
 * The modality of a study, as a SQL expression — or `null` when there is none
 * to be had, which is a fact and not an error.
 */
export function modalityExpression(schema, d, alias = 's') {
  const prefix = alias ? `${alias}.` : '';

  if (schema.modalityFrom === 'study') {
    return `${prefix}${d.quote(schema.modality)}`;
  }

  if (schema.modalityFrom === 'series') {
    // MIN, not any-old-value: an aggregate makes the subquery return exactly one
    // row per study whatever Series contains, which is the property that keeps
    // the study count a study count. Which modality it picks for a mixed study
    // is a separate question, answered in `src/ask/modalities.js`.
    return (
      `(SELECT MIN(se.${d.quote(schema.seriesModality)}) FROM ${d.quote(schema.seriesTable)} se` +
      ` WHERE se.${d.quote(schema.seriesStudyGuid)} = ${prefix}${d.quote(schema.guid)})`
    );
  }

  return null;
}

/**
 * What was found, in words, for the screen.
 *
 * A dashboard that silently adapts is a dashboard whose numbers cannot be
 * argued with. Every one of these lines is a thing a reader can check against
 * their own database, and the one that says a view is unavailable is the most
 * useful line on the page.
 */
function describe(schema) {
  const notes = [];

  notes.push(`studies are in ${schema.table}`);

  if (schema.modalityFrom === 'study') {
    notes.push(`the modality is on ${schema.table}.${schema.modality}`);
  } else if (schema.modalityFrom === 'series') {
    notes.push(
      `${schema.table} has no modality column — it is on ${schema.seriesTable}.${schema.seriesModality}, ` +
        `reached by a subquery rather than a join so studies are not counted once per series`
    );
  } else {
    notes.push('there is no modality anywhere: the modality view is unavailable here');
  }

  notes.push(
    schema.device
      ? `the source device is ${schema.device}`
      : 'there is no source device column: the device view is unavailable here'
  );

  notes.push(`study size is ${schema.size}`);

  if (!schema.partitionTable) notes.push('there is no ServerPartition table: partitions are unavailable');

  return notes;
}

/**
 * The names this installation is using, for the diagnostic panel: logical field,
 * what it resolved to, and which candidate that was.
 */
export function resolution(schema) {
  return Object.entries(CANDIDATES).map(([field, candidates]) => ({
    field,
    resolved: schema[field] ?? null,
    candidates,
    // Which of the candidates won, so "we took the second choice" is visible.
    position: schema[field] ? candidates.findIndex((c) => c.toLowerCase() === schema[field].toLowerCase()) : -1,
  }));
}
