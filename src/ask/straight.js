/**
 * The same questions, with the SQL written straight.
 *
 * This is the baseline the measurement compares against, and it matters that it
 * is not a straw man. Every query here is what the documentation implies —
 * `Study.StudySizeInKB`, `Study.ModalitiesInStudy`, `Study.SourceDevice` — which
 * is what anybody writes first, correctly, having read the schema they were
 * given.
 *
 * ── The patches, and why they are here ───────────────────────────────────────
 *
 * On a site where those names are wrong, the straight query does not run. What
 * happens next in real life is not that somebody rewrites the product: it is
 * that somebody makes the smallest change that gets it running again, for that
 * customer, that afternoon.
 *
 * So the baseline has two forms, and the measurement reports both:
 *
 *   `straight`   the documented query, unchanged
 *   `patched`    the same, plus the minimal edit that makes it execute here
 *
 * The patches are written to be **the obvious repair**, not a bad one. When the
 * modality turns out to live on `Series`, the obvious repair is a join — and
 * the join is correct-looking, runs, and returns numbers.
 *
 * ── Three outcomes, not two ──────────────────────────────────────────────────
 *
 * A query against the wrong schema fails in one of two ways, and the difference
 * is the whole subject:
 *
 *   `loud`     it errors. Somebody sees it, and fixes it.
 *   `silent`   it runs and answers wrongly. Nobody sees anything.
 *
 * A number on a dashboard is believed. That is why the measurement counts them
 * separately, and why the silent column is the one to read.
 */

import { parameters } from '../db/sqlite.js';

/** The names the documentation gives. Written out, as anybody would. */
const AS_DOCUMENTED = {
  study: 'Study',
  guid: 'GUID',
  size: 'StudySizeInKB',
  modality: 'ModalitiesInStudy',
  device: 'SourceDevice',
  date: 'StudyDate',
  patient: 'PatientGUID',
  series: 'NumberOfStudyRelatedSeries',
};

/**
 * The straight version of each question.
 *
 * Deliberately without the guards: no length check on the date, no digits-only
 * test, no candidate names. Not because the person writing it was careless —
 * because nothing in the documentation says the column can contain a word.
 */
export const STRAIGHT = {
  'how many studies': (run) =>
    Number(run(`SELECT COUNT(*) AS n FROM Study`)[0].n),

  'how much storage, in GB': (run) =>
    Number(run(`SELECT SUM(StudySizeInKB) AS kb FROM Study`)[0].kb) / 1024 / 1024,

  'how many patients': (run) =>
    Number(run(`SELECT COUNT(DISTINCT PatientGUID) AS n FROM Study`)[0].n),

  'studies per modality': (run) =>
    asCounts(run(`SELECT ModalitiesInStudy AS k, COUNT(*) AS n FROM Study GROUP BY ModalitiesInStudy`)),

  'studies per device': (run) =>
    asCounts(run(`SELECT SourceDevice AS k, COUNT(*) AS n FROM Study GROUP BY SourceDevice`)),

  'studies per month': (run) =>
    asCounts(run(`SELECT SUBSTR(StudyDate, 1, 6) AS k, COUNT(*) AS n FROM Study GROUP BY 1 ORDER BY 1`)),

  'studies in one month': (run) => {
    const bind = parameters({ placeholder: () => '?' });
    return Number(
      run(`SELECT COUNT(*) AS n FROM Study WHERE StudyDate >= ${bind.add('20240301')} AND StudyDate <= ${bind.add('20240331')}`, bind.values)[0].n
    );
  },

  'the busiest hour of the week': (run) => {
    const rows = run(
      `SELECT ((CAST(strftime('%w', SUBSTR(StudyDate, 1, 4) || '-' || SUBSTR(StudyDate, 5, 2) || '-' || SUBSTR(StudyDate, 7, 2)) AS INTEGER) + 6) % 7) AS weekday,
              CAST(SUBSTR(StudyTime, 1, 2) AS INTEGER) AS hour,
              COUNT(*) AS n
         FROM Study
        GROUP BY weekday, hour
        ORDER BY n DESC
        LIMIT 1`
    );

    const best = rows[0];
    return best ? `${best.weekday}:${best.hour}` : null;
  },
};

/**
 * The minimal edit that makes each question run on each installation, where the
 * straight one cannot.
 *
 * Only where it is needed: an installation missing from a question's map means
 * the straight query runs there, whether or not it is right.
 */
export const PATCHED = {
  'older-column-names': {
    // Four names, renamed. Every one of these is a search and replace.
    'how much storage, in GB': (run) =>
      Number(run(`SELECT SUM(StudySizeKB) AS kb FROM Study`)[0].kb) / 1024 / 1024,
    'how many patients': (run) => Number(run(`SELECT COUNT(DISTINCT PatientID) AS n FROM Study`)[0].n),
    'studies per modality': (run) =>
      asCounts(run(`SELECT Modality AS k, COUNT(*) AS n FROM Study GROUP BY Modality`)),
    'studies per device': (run) =>
      asCounts(run(`SELECT SourceAeTitle AS k, COUNT(*) AS n FROM Study GROUP BY SourceAeTitle`)),
  },

  'modality-on-series': {
    /**
     * The one that matters.
     *
     * There is no modality on `Study`, so the query errors, and the obvious
     * repair is to join `Series` — which is where the modality is, and the join
     * is written correctly.
     *
     * It is also a join to a one-to-many table. Every study is counted once per
     * series it contains. Nothing errors, the shape of the chart is preserved,
     * and the numbers are about four and a half times too large — unevenly,
     * because CT and MR have the most series, so the *proportions* change too.
     *
     * This is the cell the whole project is about.
     */
    'studies per modality': (run) =>
      asCounts(
        run(
          `SELECT se.Modality AS k, COUNT(*) AS n
             FROM Study s
             JOIN Series se ON se.StudyGUID = s.GUID
            GROUP BY se.Modality`
        )
      ),
  },

  'no-device-column': {
    // There is no repair. The column does not exist and no name stands in for
    // it, so this question has no answer here — which is a fact about the site
    // and the honest thing to report.
    'studies per device': () => {
      const nothing = new Error('there is no source device column here');
      nothing.unanswerable = true;
      throw nothing;
    },
  },
};

/**
 * Ask one question of one installation, both ways, and say what happened.
 *
 * @returns {{how: 'straight'|'patched'|'unanswerable', value: unknown, error: string|null}}
 */
export function askStraight(run, question, installation) {
  try {
    return { how: 'straight', value: STRAIGHT[question](run), error: null };
  } catch (straightError) {
    const patch = PATCHED[installation]?.[question];

    if (!patch) {
      return { how: 'unanswerable', value: null, error: straightError.message };
    }

    try {
      return { how: 'patched', value: patch(run), error: null };
    } catch (patchedError) {
      return {
        how: 'unanswerable',
        value: null,
        error: patchedError.unanswerable ? patchedError.message : `${straightError.message}; then ${patchedError.message}`,
      };
    }
  }
}

/** `[{k, n}]` → `{k: n}`, with nulls dropped the way a GROUP BY leaves them. */
function asCounts(rows) {
  const out = {};

  for (const row of rows) {
    if (row.k === null || row.k === undefined || row.k === '') continue;
    out[String(row.k)] = Number(row.n);
  }

  return out;
}
