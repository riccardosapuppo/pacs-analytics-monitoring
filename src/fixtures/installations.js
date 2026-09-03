/**
 * Six installations, one archive.
 *
 * Every one of them holds the same studies from `facts.js`. They disagree only
 * about how to write them down — and that is the whole subject of this project,
 * because a product deployed at more than one site is a product whose database
 * has drifted. Columns get renamed between versions and the old name survives
 * wherever nobody upgraded. A field the documentation puts on one table turns
 * out to live on another. An optional column was never created. A modality was
 * configured by somebody in a hurry and has been writing rubbish into a date
 * column for two years.
 *
 * None of that is hypothetical and none of it is fixable from where the
 * analytics code stands: you do not own this schema, you cannot migrate it, and
 * you will not be told when it differs. You get to run `SELECT`.
 *
 * They are named for how they differ rather than after customers, which is both
 * safer and more useful: `older-column-names` says what the case is, and
 * `Northgate Clinic` says nothing.
 *
 * Each installation changes exactly ONE thing about the documented schema. A
 * fixture that changed three at once would prove that something went wrong
 * without saying what.
 */

import { DatabaseSync } from 'node:sqlite';

import { PARTITIONS, STUDIES, withCombinedModalities, withRubbishDates } from './facts.js';

/**
 * The schema as the (invented) vendor documentation describes it. Every other
 * installation is described as a difference from this one, and the baseline in
 * `src/ask/straight.js` is written against exactly these names.
 */
const DOCUMENTED = {
  study: 'Study',
  guid: 'GUID',
  uid: 'StudyInstanceUid',
  accession: 'AccessionNumber',
  patient: 'PatientGUID',
  date: 'StudyDate',
  time: 'StudyTime',
  description: 'StudyDescription',
  modality: 'ModalitiesInStudy',
  device: 'SourceDevice',
  series: 'NumberOfStudyRelatedSeries',
  instances: 'NumberOfStudyRelatedInstances',
  size: 'StudySizeInKB',
  partition: 'ServerPartitionGUID',
};

function guidFor(n) {
  const hex = (n + 0x51a2c000).toString(16).padStart(8, '0');
  return `${hex}-1000-4000-8000-000000000000`;
}

/**
 * Build a `Study` table from a column plan.
 *
 * Types are written the way the original schema writes them — `VARCHAR(8)` for
 * a DICOM date, not a date type — because that is the constraint the whole of
 * `src/ask/` is built around. SQLite would happily accept anything here; using
 * the real declared types keeps the fixture honest about what it is standing in
 * for, and keeps the generated SQL comparable across dialects.
 */
function studyTable(db, plan, { withModality = true, withDevice = true } = {}) {
  const columns = [
    `${plan.guid} TEXT PRIMARY KEY`,
    `${plan.uid} VARCHAR(64) NOT NULL`,
    `${plan.accession} NVARCHAR(64)`,
    `${plan.patient} NVARCHAR(64)`,
    `${plan.date} VARCHAR(8)`,
    `${plan.time} VARCHAR(16)`,
    `${plan.description} NVARCHAR(256)`,
    withModality ? `${plan.modality} NVARCHAR(128)` : null,
    withDevice ? `${plan.device} NVARCHAR(128)` : null,
    `${plan.series} INT`,
    `${plan.instances} INT`,
    `${plan.size} DECIMAL(18,0)`,
    `${plan.partition} TEXT`,
  ].filter(Boolean);

  db.exec(`CREATE TABLE ${plan.study} (\n  ${columns.join(',\n  ')}\n)`);
}

function partitionTable(db) {
  db.exec(`CREATE TABLE ServerPartition (
  GUID TEXT PRIMARY KEY,
  AeTitle NVARCHAR(64),
  Description NVARCHAR(128)
)`);

  const put = db.prepare('INSERT INTO ServerPartition (GUID, AeTitle, Description) VALUES (?, ?, ?)');
  for (const one of PARTITIONS) put.run(one.id, one.ae, one.description);
}

function fillStudies(db, plan, studies, { withModality = true, withDevice = true } = {}) {
  // Column name paired with how to get its value, so a column that is not
  // created cannot leave the values shifted by one — which is the bug this
  // shape exists to make impossible rather than to catch.
  const put_ = [
    [plan.guid, (one, n) => guidFor(n)],
    [plan.uid, (one) => one.uid],
    [plan.accession, (one) => one.accession],
    [plan.patient, (one) => one.patient],
    [plan.date, (one) => one.date],
    [plan.time, (one) => one.time],
    [plan.description, (one) => one.description],
    withModality ? [plan.modality, (one) => one.modality] : null,
    withDevice ? [plan.device, (one) => one.device] : null,
    [plan.series, (one) => one.series],
    [plan.instances, (one) => one.instances],
    [plan.size, (one) => one.sizeKB],
    [plan.partition, (one) => one.partition],
  ].filter(Boolean);

  const names = put_.map(([name]) => name);
  const statement = db.prepare(
    `INSERT INTO ${plan.study} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
  );

  studies.forEach((one, n) => {
    statement.run(...put_.map(([, get]) => get(one, n)));
  });
}

/**
 * One row per series, which is what makes this installation the interesting one.
 *
 * When the modality is not on `Study`, the obvious repair is to join `Series` —
 * and a join to a one-to-many table multiplies the left side. Every study is
 * then counted once per series it contains, and so is its storage. Nothing
 * errors. The dashboard shows numbers roughly four times too large and shaped
 * exactly like the right ones.
 */
function seriesTable(db, studies) {
  db.exec(`CREATE TABLE Series (
  GUID TEXT PRIMARY KEY,
  StudyGUID TEXT NOT NULL,
  SeriesInstanceUid VARCHAR(64),
  Modality VARCHAR(16),
  SeriesNumber INT,
  NumberOfSeriesRelatedInstances INT
)`);

  const put = db.prepare(
    `INSERT INTO Series (GUID, StudyGUID, SeriesInstanceUid, Modality, SeriesNumber, NumberOfSeriesRelatedInstances)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  let n = 0;

  studies.forEach((one, s) => {
    const per = Math.max(1, Math.round(one.instances / one.series));

    for (let i = 0; i < one.series; i += 1) {
      n += 1;
      put.run(guidFor(1_000_000 + n), guidFor(s), `${one.uid}.${i + 1}`, one.modality, i + 1, per);
    }
  });

  db.exec('CREATE INDEX IX_Series_StudyGUID ON Series (StudyGUID)');
}

/** The installations, in the order the measurement reports them. */
export const INSTALLATIONS = [
  {
    name: 'as-documented',
    differs: 'nothing — the schema the vendor documentation describes',
    why: 'The control. If an answer is wrong here it is the query that is wrong, not the schema.',
    build(db) {
      studyTable(db, DOCUMENTED);
      fillStudies(db, DOCUMENTED, STUDIES);
      partitionTable(db);
    },
  },

  {
    name: 'older-column-names',
    differs: 'six columns kept the names they had two major versions ago',
    why:
      'Nobody ran the rename script here, and nobody was going to: the archive holds eleven years of ' +
      'studies and the maintenance window to rewrite it does not exist.',
    plan: {
      ...DOCUMENTED,
      modality: 'Modality',
      device: 'SourceAeTitle',
      series: 'SeriesCount',
      instances: 'InstanceCount',
      size: 'StudySizeKB',
      patient: 'PatientID',
    },
    build(db) {
      studyTable(db, this.plan);
      fillStudies(db, this.plan, STUDIES);
      partitionTable(db);
    },
  },

  {
    name: 'modality-on-series',
    differs: 'there is no modality column on Study at all — it is on Series, through a foreign key',
    why:
      'The documentation puts the modality on the study. The data model puts it on the series, which ' +
      'is where it belongs: a study can contain series of more than one modality. This is not a ' +
      'defect, it is the schema being more correct than the document about it.',
    build(db) {
      studyTable(db, DOCUMENTED, { withModality: false });
      fillStudies(db, DOCUMENTED, STUDIES, { withModality: false });
      seriesTable(db, STUDIES);
      partitionTable(db);
    },
  },

  {
    name: 'no-device-column',
    differs: 'the source device column was never created',
    why:
      'It is optional, it was added in a later version, and this site upgraded the application without ' +
      'the schema step. One view cannot be answered here. Saying so is a correct answer; a chart of ' +
      'nothing labelled as data is not.',
    build(db) {
      studyTable(db, DOCUMENTED, { withDevice: false });
      fillStudies(db, DOCUMENTED, STUDIES, { withDevice: false });
      partitionTable(db);
    },
  },

  {
    name: 'undatable-rows',
    differs: 'four studies have a StudyDate that is not a date',
    why:
      'StudyDate is a VARCHAR(8) holding whatever the sending modality put in it: nothing, an empty ' +
      'string, a human-readable date, a word. Over two years an archive collects a few. They are the ' +
      'reason a total and a chart on the same page can disagree.',
    build(db) {
      studyTable(db, DOCUMENTED);
      fillStudies(db, DOCUMENTED, withRubbishDates());
      partitionTable(db);
    },
  },

  {
    name: 'combined-modalities',
    differs: 'some studies hold two modalities in the modality column, as the standard allows',
    why:
      'ModalitiesInStudy is multi-valued — value multiplicity 1-n, backslash delimited — so CT\\MR is ' +
      'a correct value for a study containing both. It is also a value that a GROUP BY turns into a ' +
      'category which is neither, while quietly taking the count away from both.',
    build(db) {
      studyTable(db, DOCUMENTED);
      fillStudies(db, DOCUMENTED, withCombinedModalities());
      partitionTable(db);
    },
  },
];

/**
 * Open one installation, in memory.
 *
 * In memory because there is nothing to persist: the fixture is derived from
 * `facts.js` every time and a file on disk would only be a way for a stale one
 * to survive a change to the facts and quietly measure the wrong archive.
 */
export function open(name) {
  const installation = INSTALLATIONS.find((one) => one.name === name);
  if (!installation) throw new Error(`no installation called ${name}`);

  const db = new DatabaseSync(':memory:');
  installation.build(db);

  return { db, installation };
}

/** The studies each installation holds, which is not always `STUDIES`. */
export function studiesIn(name) {
  if (name === 'undatable-rows') return withRubbishDates();
  if (name === 'combined-modalities') return withCombinedModalities();
  return STUDIES;
}
