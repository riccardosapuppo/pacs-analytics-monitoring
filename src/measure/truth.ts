/**
 * The right answers, worked out from the facts rather than from a query.
 *
 * This is the load-bearing rule of the whole measurement. An expectation
 * computed the same way as the thing it checks agrees with a bug: run the same
 * SQL to produce the answer and to produce the answer it is compared against,
 * and a wrong `GROUP BY` is wrong identically on both sides and passes.
 *
 * So there is no SQL in this file, no database, and no import from `src/ask/`.
 * It counts an array.
 *
 * ── What "right" means where the data is not clean ───────────────────────────
 *
 * On the installation with four undatable rows, "how many studies" has two
 * defensible answers: 900 rows are in the table, and 896 of them can be placed
 * in time. The truth here is 896 — a study nothing can date is a study that is
 * in no chart on the page, so counting it in the headline is what makes a
 * dashboard contradict itself.
 *
 * That the resolved side ALSO reports how many it could not date is a property
 * of the answer rather than the answer, and is a test rather than a scored
 * question. Scoring it would mark the straight version wrong on five
 * installations where COUNT(*) is exactly right, which would be building a
 * baseline in order to beat it.
 */

import { COMBINED, STUDIES, withCombinedModalities, withRubbishDates } from '../fixtures/facts.ts';
import { splitModalities } from '../ask/modalities.ts';

/** The studies each installation actually holds. */
export function studiesIn(name: string) {
  if (name === 'undatable-rows') return withRubbishDates();
  if (name === 'combined-modalities') return withCombinedModalities();
  return STUDIES;
}

/** Eight digits, all of them digits. The same rule the queries apply, stated once. */
export function datable(study: Record<string, unknown>): boolean {
  return typeof study.date === 'string' && /^\d{8}$/.test(study.date);
}

/**
 * Every right answer for one installation.
 *
 * Note what is NOT here: any dependence on which installation it is, beyond
 * which studies it holds and whether it records a device. Two installations
 * holding the same studies must have the same answers, and the only way to be
 * sure of that is for the truth not to know their names.
 */
export function truthFor(name: string) {
  const held = studiesIn(name);
  const dated = held.filter(datable);
  const undated = held.length - dated.length;
  const hasDevice = name !== 'no-device-column';

  return {
    // The count of studies that can be placed in time.
    //
    // Not a pair with the undatable ones beside it, and that is a decision
    // about fairness: on five of the six installations COUNT(*) is exactly
    // right, and marking it wrong there would be building a baseline to
    // lose. On the sixth it is wrong by four, silently, which is the whole
    // point and needs no help.
    //
    // That the resolved side also REPORTS how many it could not date is a
    // property of the answer rather than the answer, so it is a test rather
    // than a scored question.
    'how many studies': dated.length,

    'how much storage, in GB': sum(dated.map((one) => one.sizeKB)) / 1024 / 1024,

    'how many patients': new Set(dated.map((one) => one.patient)).size,

    /**
     * A study whose modality field holds two modalities counts under both.
     *
     * That is what the field means — value multiplicity 1-n in the standard —
     * so the column adds to more than the archive holds, on purpose. The
     * alternative, a category called `CT\MR`, is a category no radiologist has
     * ever ordered.
     */
    'studies per modality': tally(dated.flatMap((one) => splitModalities(one.modality))),

    'studies per device': hasDevice ? tally(dated.map((one) => one.device)) : { unanswerable: true },

    'studies per month': tally(dated.map((one) => String(one.date).slice(0, 6))),

    'studies in one month': dated.filter((one) => String(one.date) >= '20240301' && String(one.date) <= '20240331').length,

    'the busiest hour of the week': busiest(dated),
  };
}

/** Monday = 0, from a `YYYYMMDD` string, without a date library. */
export function weekdayOf(date: string): number {
  const at = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)));
  return (new Date(at).getUTCDay() + 6) % 7;
}

function busiest(studies: Array<Record<string, unknown>>) {
  const counts = new Map();

  for (const one of studies) {
    const key = `${weekdayOf(String(one.date))}:${Number(String(one.time).slice(0, 2))}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best = null;
  let most = -1;

  // Ties broken by the key, so the answer is the same on every run. A truth
  // that depends on iteration order is a truth that disagrees with itself.
  for (const key of [...counts.keys()].sort()) {
    if (counts.get(key) > most) {
      most = counts.get(key);
      best = key;
    }
  }

  return best;
}

function tally(values: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};

  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    out[String(value)] = (out[String(value)] ?? 0) + 1;
  }

  return out;
}

function sum(values: unknown[]): number {
  return values.reduce((total: number, one) => total + Number(one), 0);
}

/**
 * Is an answer right?
 *
 * Numbers are compared with a tolerance because storage is a division; counts
 * and maps are compared exactly, because "about the right number of CT studies"
 * is not a thing anybody wants.
 *
 * @returns {{right: boolean, why: string}}
 */
type Answer = { unanswerable?: boolean } & Record<string, unknown>;

export function judge(wantedIn: unknown, gotIn: unknown) {
  const wanted = wantedIn as Answer;
  const got = gotIn as Answer;
  if (got === null || got === undefined) return { right: false, why: 'no answer' };

  if (wanted && wanted.unanswerable) {
    return got && got.unanswerable
      ? { right: true, why: 'correctly says it cannot be answered here' }
      : { right: false, why: 'answered a question this installation cannot answer' };
  }

  if (typeof wanted === 'number') {
    const near = Math.abs(Number(got) - wanted) <= Math.max(1e-6, Math.abs(wanted) * 1e-9);
    return near ? { right: true, why: '' } : { right: false, why: `wanted ${round(wanted)}, got ${round(got)}` };
  }

  if (typeof wanted === 'string') {
    return String(got) === wanted ? { right: true, why: '' } : { right: false, why: `wanted ${wanted}, got ${got}` };
  }

  // An object: either the studies/undatable pair, or a tally.
  if (typeof got !== 'object') return { right: false, why: `wanted a breakdown, got ${got}` };

  const keys = new Set([...Object.keys(wanted), ...Object.keys(got)]);
  const wrong = [];

  for (const key of [...keys].sort()) {
    const a = wanted[key] ?? 0;
    const b = got[key] ?? 0;
    if (a !== b) wrong.push(`${key}: wanted ${a}, got ${b}`);
  }

  return wrong.length === 0
    ? { right: true, why: '' }
    : { right: false, why: wrong.slice(0, 3).join('; ') + (wrong.length > 3 ? ` (+${wrong.length - 3} more)` : '') };
}

function round(value: unknown): unknown {
  return typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(3) : value;
}

export { COMBINED };
