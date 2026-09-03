/**
 * The facts. One list of studies, invented, and the only truth in this project.
 *
 * Everything else — six installations whose schemas disagree, a baseline that
 * writes its SQL straight, the measurement that compares them — is downstream of
 * this file. The installations are six different ways of *writing down* these
 * same studies, so any question about them has one right answer, and an answer
 * that changes with the schema is an answer that is wrong somewhere.
 *
 * The expected answers are worked out from this array in plain JavaScript, by
 * `src/measure/truth.js`, and never by running a query. An expectation computed
 * the same way as the thing it checks agrees with a bug.
 *
 * No real patient, study, hospital or device appears here. The names are made
 * up; the shapes are not — study UIDs look like study UIDs, dates are DICOM
 * `YYYYMMDD` strings, and a handful of rows carry the sort of rubbish that a
 * real archive accumulates from a badly configured modality (see `dirty`).
 */

/**
 * A small deterministic generator, so this file is a *fixture* and not a
 * lottery. Anything seeded from the clock makes a failing measurement
 * impossible to reproduce and a passing one impossible to trust.
 *
 * Mulberry32 — thirty-two bits of state, cheap, and adequate for spreading
 * invented studies across a calendar.
 */
/** One invented study, as every installation stores it before renaming. */
export type Study = {
  uid: string;
  accession: string;
  patient: string;
  date: string | null;
  time: string;
  description: string;
  modality: string;
  device: string;
  series: number;
  instances: number;
  sizeKB: number;
  partition: string | undefined;

  /**
   * What is wrong with this row on purpose, or null.
   *
   * The rubbish-date and combined-modality variants set it, and the measurement
   * reads it: a study that is deliberately broken should be counted as broken
   * rather than looked at twice.
   */
  dirty: string | null;

  /** Set only by `withCombinedModalities`, which is why it is optional. */
  combined?: string[];
};

function rolls(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Modalities, with the series count and study size that go with each.
 *
 * These are not decoration. The whole measurement turns on studies having
 * *several series*, because that is what turns a join into a multiplication:
 * a CT with 6 series counted once is a study, counted six times it is six
 * studies and six times the storage. A fixture where every study had one
 * series would make the baseline look correct.
 */
const KINDS = [
  { modality: 'CT', series: [4, 9], sizeMB: [180, 620], share: 24 },
  { modality: 'MR', series: [5, 14], sizeMB: [220, 900], share: 18 },
  { modality: 'CR', series: [1, 2], sizeMB: [8, 26], share: 22 },
  { modality: 'DX', series: [1, 3], sizeMB: [10, 34], share: 14 },
  { modality: 'US', series: [1, 4], sizeMB: [12, 70], share: 10 },
  { modality: 'MG', series: [2, 4], sizeMB: [40, 120], share: 7 },
  { modality: 'NM', series: [1, 3], sizeMB: [15, 55], share: 3 },
  { modality: 'PT', series: [3, 6], sizeMB: [140, 380], share: 2 },
];

/**
 * Rooms, and what stands in them. A device belongs to a modality: a CT scanner
 * does not produce mammograms, and a fixture that pretended otherwise would let
 * a wrong grouping look right.
 */
const ROOMS = [
  { device: 'CT_ROOM_1', modality: 'CT', site: 'RIVERSIDE' },
  { device: 'CT_ROOM_2', modality: 'CT', site: 'RIVERSIDE' },
  { device: 'MR_ROOM_1', modality: 'MR', site: 'RIVERSIDE' },
  { device: 'MR_MOBILE', modality: 'MR', site: 'NORTHGATE' },
  { device: 'XRAY_A', modality: 'CR', site: 'RIVERSIDE' },
  { device: 'XRAY_B', modality: 'CR', site: 'NORTHGATE' },
  { device: 'XRAY_DIGITAL', modality: 'DX', site: 'RIVERSIDE' },
  { device: 'ULTRASOUND_1', modality: 'US', site: 'NORTHGATE' },
  { device: 'MAMMO_1', modality: 'MG', site: 'RIVERSIDE' },
  { device: 'GAMMA_1', modality: 'NM', site: 'RIVERSIDE' },
  { device: 'PETCT_1', modality: 'PT', site: 'RIVERSIDE' },
];

const DESCRIPTIONS = {
  CT: ['CT CHEST WITH CONTRAST', 'CT ABDOMEN PELVIS', 'CT HEAD WITHOUT CONTRAST', 'CT ANGIOGRAM'],
  MR: ['MR BRAIN', 'MR LUMBAR SPINE', 'MR KNEE RIGHT', 'MR CARDIAC'],
  CR: ['CHEST PA AND LATERAL', 'ABDOMEN SUPINE', 'WRIST LEFT', 'ANKLE RIGHT'],
  DX: ['CHEST PA', 'HAND RIGHT', 'PELVIS AP'],
  US: ['US ABDOMEN COMPLETE', 'US THYROID', 'US RENAL'],
  MG: ['MAMMOGRAM BILATERAL SCREENING', 'MAMMOGRAM DIAGNOSTIC LEFT'],
  NM: ['BONE SCAN WHOLE BODY', 'THYROID UPTAKE'],
  PT: ['PET CT WHOLE BODY', 'PET CT BRAIN'],
};

/** Two partitions, because a real archive is rarely one. */
export const PARTITIONS = [
  { id: 'a1f0c3d2-0000-4000-8000-000000000001', ae: 'RIVERSIDE', description: 'Riverside General' },
  { id: 'a1f0c3d2-0000-4000-8000-000000000002', ae: 'NORTHGATE', description: 'Northgate Clinic' },
];

const SITE_PARTITION = new Map(PARTITIONS.map((one) => [one.ae, one.id]));

/** A study UID that looks like one: a made-up root, then digits. */
function uid(n: number): string {
  return `1.2.826.0.1.3680043.9.7133.${1000 + n}.${20240000 + n * 7}`;
}

function between(roll: () => number, [low, high]: [number, number]): number {
  return low + Math.floor(roll() * (high - low + 1));
}

function pick<T>(roll: () => number, list: readonly T[]): T {
  return list[Math.floor(roll() * list.length)]!;
}

/** DICOM dates and times are strings, not dates. They are strings here too. */
function dicomDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function dicomTime(hour: number, minute: number, second: number): string {
  return [hour, minute, second].map((n) => String(n).padStart(2, '0')).join('');
}

/**
 * Weight the day of the week and the hour, because a heatmap over uniform noise
 * is a picture of nothing. Weekdays are busy, weekends are a skeleton service,
 * and the working day has two humps around a thinner lunch hour.
 */
const BY_WEEKDAY = [1, 1, 1, 1, 0.95, 0.28, 0.12]; // Monday … Sunday
const BY_HOUR = [
  0.02, 0.02, 0.02, 0.02, 0.03, 0.06, 0.2, 0.5, 0.9, 1, 1, 0.85, 0.55, 0.7, 0.95, 1, 0.9, 0.6, 0.35,
  0.2, 0.12, 0.08, 0.05, 0.03,
];

/** An index into `weights`, chosen in proportion to them. */
function weighted(roll: () => number, weights: readonly number[]): number {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let target = roll() * total;

  for (let i = 0; i < weights.length; i += 1) {
    target -= weights[i]!;
    if (target <= 0) return i;
  }

  return weights.length - 1;
}

/**
 * Five years, and growing.
 *
 * Not because more data is better, but because an archive that has existed
 * for two years cannot be forecast from and a storage chart that never once
 * draws a line is a feature nobody can look at. A real archive has years
 * behind it and takes more room every one of them -- which is the thing the
 * forecast is for, and the reason anybody asks.
 */
const FIRST_DAY = Date.UTC(2021, 0, 1);
const DAYS = 1826; // 1 January 2021 to 31 December 2025: five whole years.
const HOW_MANY = 2200;

/**
 * How much busier the archive gets.
 *
 * A day is chosen as u^(1/GROWTH) rather than u, which bends a flat
 * distribution towards the recent end. At 1.6 the last full year receives
 * roughly twice what the first did -- steep enough for the line to be worth
 * fitting and gentle enough not to look invented.
 */
const GROWTH = 1.6;

function build() {
  const roll = rolls(20260903);
  const bag = KINDS.flatMap((k) => Array.from({ length: k.share }, () => k));
  const studies = [];

  for (let n = 0; n < HOW_MANY; n += 1) {
    const kind = pick(roll, bag);
    const rooms = ROOMS.filter((r) => r.modality === kind.modality);
    const room = pick(roll, rooms);

    // A day, then a weekday-weighted nudge onto a plausible one.
    let day = Math.floor(DAYS * roll() ** (1 / GROWTH));
    const when = new Date(FIRST_DAY + day * 86400000);
    const weekday = (when.getUTCDay() + 6) % 7; // Monday = 0

    if (roll() > BY_WEEKDAY[weekday]!) {
      day = (day + 1 + weighted(roll, BY_WEEKDAY)) % DAYS;
    }

    const date = new Date(FIRST_DAY + day * 86400000);
    const hour = weighted(roll, BY_HOUR);
    const sizeMB = between(roll, kind.sizeMB as [number, number]);
    const series = between(roll, kind.series as [number, number]);

    studies.push({
      uid: uid(n),
      accession: `ACC${String(240000 + n * 3).padStart(8, '0')}`,
      patient: `PAT${String(1 + (n % 340)).padStart(6, '0')}`,
      date: dicomDate(date),
      time: dicomTime(hour, between(roll, [0, 59]), between(roll, [0, 59])),
      description: pick(roll, DESCRIPTIONS[kind.modality as keyof typeof DESCRIPTIONS]),
      modality: kind.modality,
      device: room.device,
      partition: SITE_PARTITION.get(room.site),
      series,
      // Instances per series varies; the point is only that the number is not
      // derivable from the series count, so a query cannot fake one from the other.
      instances: series * between(roll, [18, 240]),
      sizeKB: sizeMB * 1024,
      dirty: null,
    });
  }

  studies.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  return studies;
}

/** The clean archive: 900 studies, every one of them datable. */
export const STUDIES = build();

/**
 * What a real archive also contains.
 *
 * `StudyDate` is a `VARCHAR(8)` holding a DICOM `YYYYMMDD`, which is to say it
 * is a string holding whatever a modality put in it. These four are the shapes
 * that turn up: a modality that sent nothing, one that sent an empty string,
 * one configured for a human-readable format, and one that sent a word.
 *
 * They are the reason every dated query in `src/ask/` opens with a length check
 * and a digits-only check before it does anything else — and the reason the
 * answers say how many rows they could not date, instead of quietly dropping
 * them and reporting two totals that do not agree.
 */
export const RUBBISH_DATES = [null, '', '2024-03-05', 'UNKNOWN'];

export function withRubbishDates(studies: Study[] = STUDIES): Study[] {
  const spoiled = studies.map((one) => ({ ...one }));

  // Spread across the array rather than clustered, and on studies with real
  // storage attached, so their absence from a dated total is a visible number
  // rather than a rounding difference.
  RUBBISH_DATES.forEach((value, i) => {
    const at = Math.floor(((i + 1) * spoiled.length) / (RUBBISH_DATES.length + 1));
    spoiled[at] = { ...spoiled[at], date: value, dirty: 'undatable' };
  });

  return spoiled;
}

/**
 * What a study looks like when the modality field holds more than one modality.
 *
 * `ModalitiesInStudy` is multi-valued in the standard — value multiplicity 1-n,
 * delimited by a backslash — so `CT\MR` is a correct value for a study that
 * contains both. It is also the value that makes a `GROUP BY` on that column
 * invent a category which is neither CT nor MR, while undercounting both.
 */
export const COMBINED = 'CT' + String.fromCharCode(92) + 'MR';

export function withCombinedModalities(studies: Study[] = STUDIES): Study[] {
  const mixed = studies.map((one) => ({ ...one }));
  let seen = 0;

  for (let i = 0; i < mixed.length; i += 1) {
    if (mixed[i].modality !== 'CT') continue;
    seen += 1;

    // Every fourth CT also carries MR series, so the slice is big enough to see
    // on a chart and small enough that CT does not vanish from it.
    if (seen % 4 === 0) {
      mixed[i] = { ...mixed[i], modality: COMBINED, combined: ['CT', 'MR'] };
    }
  }

  return mixed;
}
