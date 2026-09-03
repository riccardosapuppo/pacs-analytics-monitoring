/**
 * The eight questions, asked of the resolved schema.
 *
 * The same eight `src/ask/straight.js` asks with the SQL written out. Keeping
 * the list in one place and the two ways of answering in two is what makes the
 * comparison a comparison: neither side can quietly answer a different
 * question.
 */

import type { Dialect, Run, Schema } from '../ask/shapes.ts';

import { devices } from '../ask/devices.ts';
import { heatmap } from '../ask/heatmap.ts';
import { modalities } from '../ask/modalities.ts';
import { summary } from '../ask/summary.ts';
import { trend } from '../ask/trend.ts';

export const QUESTIONS = [
  'how many studies',
  'how much storage, in GB',
  'how many patients',
  'studies per modality',
  'studies per device',
  'studies per month',
  'studies in one month',
  'the busiest hour of the week',
];

/**
 * What each question is about, for the report. Not decoration: the measurement
 * is read per question, and a reader needs to know which ones are the ones the
 * project is arguing over.
 */
export const ABOUT = {
  'how many studies': 'a count over rows that can be placed in time',
  'how much storage, in GB': 'a sum over a column whose name moves',
  'how many patients': 'distinct over a column whose name moves',
  'studies per modality': 'the chart everyone looks at, and the one with two ways of being wrong',
  'studies per device': 'a column that is sometimes not there at all',
  'studies per month': 'a substring of a date that is a string',
  'studies in one month': 'a range over strings, which is why YYYYMMDD was chosen',
  'the busiest hour of the week': 'two string columns turned into a weekday and an hour',
};

/** Ask one question of the resolved schema. Throws only on a real fault. */
export function askResolved(run: Run, d: Dialect, schema: Schema, question: string) {
  if (question === 'how many studies') {
    return summary(run, d, schema, {}).studies;
  }

  if (question === 'how much storage, in GB') {
    return summary(run, d, schema, {}).storageKB / 1024 / 1024;
  }

  if (question === 'how many patients') {
    return summary(run, d, schema, {}).patients;
  }

  if (question === 'studies per modality') {
    const said = modalities(run, d, schema, {});
    if (!said.available) return { unanswerable: true, why: said.why };
    return Object.fromEntries(said.rows.map((one) => [one.modality, Number(one.studies)]));
  }

  if (question === 'studies per device') {
    const said = devices(run, d, schema, {});
    if (!said.available) return { unanswerable: true, why: said.why };
    return Object.fromEntries(said.rows.map((one) => [one.device, Number(one.studies)]));
  }

  if (question === 'studies per month') {
    // Only the buckets that have something in them: the truth is a tally of
    // what exists, and a filled-in zero is a fact about the chart rather than
    // about the archive.
    return Object.fromEntries(
      trend(run, d, schema, { granularity: 'month' })
        .rows.filter((one) => Number(one.studies) > 0)
        .map((one) => [one.bucket, Number(one.studies)])
    );
  }

  if (question === 'studies in one month') {
    return summary(run, d, schema, { from: '2024-03-01', to: '2024-03-31' }).studies;
  }

  if (question === 'the busiest hour of the week') {
    const said = heatmap(run, d, schema, {});
    if (!said.available) return { unanswerable: true, why: said.why };
    return `${said.busiest!.weekday}:${said.busiest!.hour}`;
  }

  throw new Error(`nothing asks "${question}"`);
}
