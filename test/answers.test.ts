/**
 * The answers themselves: the invariant, the multi-valued modality, the
 * forecast that refuses, and the CSV that has to survive a spreadsheet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { INSTALLATIONS, open } from '../src/fixtures/installations.ts';
import { QUESTIONS, askResolved } from '../src/measure/questions.ts';
import { asCsv, studies } from '../src/ask/studies.ts';
import { forecast, whenItRunsOut } from '../src/ask/storage.ts';
import { judge, truthFor } from '../src/measure/truth.ts';
import { modalities, splitModalities } from '../src/ask/modalities.ts';
import { mustResolve } from '../src/db/schema.ts';
import { runner } from '../src/db/sqlite.ts';
import { sqlite } from '../src/db/dialect.ts';
import { summary } from '../src/ask/summary.ts';

function look(at: string) {
  const { db } = open(at);
  const run = runner(db as unknown as Parameters<typeof runner>[0]);
  return { run, schema: mustResolve(run, sqlite), db };
}

describe('the invariant this project exists to keep', () => {
  it('every question, every installation, matches the facts', () => {
    // The measurement reports this; here it fails the suite. The six hold the
    // same studies, so anything other than the same answers is a defect and
    // not a number to watch.
    for (const installation of INSTALLATIONS) {
      const { run, schema, db } = look(installation.name);
      const truth = truthFor(installation.name);

      for (const question of QUESTIONS) {
        const verdict = judge(truth[question as keyof typeof truth], askResolved(run, sqlite, schema, question));
        assert.ok(verdict.right, `${installation.name} · ${question}: ${verdict.why}`);
      }

      db.close();
    }
  });

  it('and the four installations with clean data agree with each other exactly', () => {
    const said = ['as-documented', 'older-column-names', 'modality-on-series', 'no-device-column'].map((name) => {
      const { run, schema, db } = look(name);
      const answer = summary(run, sqlite, schema, {});
      db.close();
      return { name, ...answer };
    });

    for (const one of said.slice(1)) {
      assert.equal(one.studies, said[0].studies, `${one.name} counts differently`);
      assert.equal(one.storageKB, said[0].storageKB, `${one.name} measures differently`);
      assert.equal(one.patients, said[0].patients, `${one.name} counts patients differently`);
    }
  });
});

describe('rows that cannot be dated', () => {
  it('are left out of the answer and reported beside it', () => {
    const { run, schema, db } = look('undatable-rows');
    const said = summary(run, sqlite, schema, {});

    assert.equal(said.undatable, 4);
    assert.equal(said.inTheArchive, said.studies + said.undatable);

    db.close();
  });

  it('and the number is reported even when it is zero', () => {
    // A field that appears only when it is interesting teaches a reader that
    // its absence means nothing, rather than that there are none.
    const { run, schema, db } = look('as-documented');
    const said = summary(run, sqlite, schema, {});

    assert.equal(said.undatable, 0);
    assert.ok('undatable' in said);

    db.close();
  });

  it('and none of them reaches a monthly bucket', () => {
    const { run, schema, db } = look('undatable-rows');
    const buckets = Object.keys(askResolved(run, sqlite, schema, 'studies per month'));

    for (const one of buckets) {
      assert.match(one, /^\d{6}$/, `a bucket called ${one} got onto the chart`);
    }

    db.close();
  });
});

describe('a modality field that holds more than one modality', () => {
  it('splits on the backslash the standard uses', () => {
    assert.deepEqual(splitModalities(`CT${String.fromCharCode(92)}MR`), ['CT', 'MR']);
    assert.deepEqual(splitModalities('CT'), ['CT']);
    assert.deepEqual(splitModalities(''), []);
    assert.deepEqual(splitModalities(null), []);
  });

  it('so CT keeps its count instead of losing it to a category that is neither', () => {
    const clean = look('as-documented');
    const mixed = look('combined-modalities');

    const ofClean = Object.fromEntries(
      modalities(clean.run, sqlite, clean.schema, {}).rows.map((one) => [one.modality, one.studies])
    );
    const ofMixed = modalities(mixed.run, sqlite, mixed.schema, {});
    const counts = Object.fromEntries(ofMixed.rows.map((one) => [one.modality, one.studies]));

    assert.equal(counts.CT, ofClean.CT, 'CT lost studies to a combined category');
    assert.ok(counts.MR > ofClean.MR, 'the combined studies did not reach MR');

    // And there is no such category.
    for (const one of Object.keys(counts)) {
      assert.ok(!one.includes(String.fromCharCode(92)), `a category called ${one} survived`);
    }

    clean.db.close();
    mixed.db.close();
  });

  it('and says how many studies are counted twice, because the column then over-adds', () => {
    const { run, schema, db } = look('combined-modalities');
    const said = modalities(run, sqlite, schema, {});

    assert.ok(said.overlapping! > 0);
    assert.equal(said.storageOverlaps, true);

    const total = said.rows.reduce((n, one) => n + one.studies, 0);
    const archive = summary(run, sqlite, schema, {}).studies;
    assert.equal(total, archive + said.overlapping!, 'the overlap does not account for the difference');

    db.close();
  });
});

describe('the forecast', () => {
  const years = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, gb: 100 + i * 20, studies: 0, kb: 0 }));

  it('refuses below three complete years, because two define a line exactly', () => {
    const said = forecast(years(2023, 2024), { thisYear: 2026 });

    assert.equal(said.possible, false);
    assert.match(String(said.why), /2 complete years/);
  });

  it('drops the current year, which is what makes these charts turn downwards', () => {
    const withPartial = [...years(2021, 2025), { year: 2026, gb: 30, studies: 0, kb: 0 }];
    const said = forecast(withPartial, { thisYear: 2026 });

    assert.equal(said.from, 5, 'the part-year was fitted as a whole one');
    assert.ok(said.perYearGB! > 0, `a partial year dragged the line downwards: ${said.perYearGB!}`);
  });

  it('and fits a line that is a line', () => {
    const said = forecast(years(2021, 2025), { thisYear: 2026 });

    assert.equal(said.possible, true);
    assert.ok(Math.abs(said.perYearGB! - 20) < 1e-6, String(said.perYearGB!));
    assert.equal(said.years[0].year, 2026);
    assert.ok(Math.abs(said.years[0].gb - 200) < 1e-6, String(said.years[0].gb));
  });

  it('and when the volume runs out is a separate question with its own refusal', () => {
    const line = forecast(years(2021, 2025), { thisYear: 2026 });

    assert.equal(whenItRunsOut(500, line, null).known, false);
    assert.match(String(whenItRunsOut(500, line, null).why), /how large/);

    const said = whenItRunsOut(500, line, 1000);
    assert.equal(said.known, true);
    assert.equal(said.percentUsed, 50);
    assert.ok(Math.abs(said.yearsLeft - 25) < 1e-6, String(said.yearsLeft));
  });
});

describe('the CSV, which has to survive a spreadsheet', () => {
  const rows = [
    { uid: '1.2.3', accession: 'ACC1', date: '2024-03-05', time: '09:15', modality: 'CT', description: 'CT CHEST', device: 'CT_ROOM_1', series: 4, instances: 300, sizeKB: 1024 },
  ];

  it('separates with a semicolon, because a comma is a decimal point in most of Europe', () => {
    assert.match(asCsv(rows).split('\r\n')[0], /uid;accession;date/);
  });

  it('and starts with a byte-order mark, or Excel reads it in the system codepage', () => {
    assert.equal(asCsv(rows).charCodeAt(0), 0xfeff);
    assert.notEqual(asCsv(rows, { bom: false }).charCodeAt(0), 0xfeff);
  });

  it('and puts an apostrophe in front of anything a spreadsheet would run', () => {
    const nasty = [{ ...rows[0], description: '=HYPERLINK("http://example.com")' }];
    const line = asCsv(nasty).split('\r\n')[1];

    assert.ok(line.includes(`'=HYPERLINK`), line);
  });

  it('and quotes a cell containing the separator rather than breaking the row', () => {
    const awkward = [{ ...rows[0], description: 'CHEST; ABDOMEN' }];
    const line = asCsv(awkward).split('\r\n')[1];

    assert.ok(line.includes('"CHEST; ABDOMEN"'), line);
    assert.equal(line.split(';').length, 11, 'the semicolon inside the cell split the row');
  });
});

describe('finding a study', () => {
  it('pages in the database rather than in the application', () => {
    const { run, schema, db } = look('as-documented');

    const first = studies(run, sqlite, schema, { page: 1, pageSize: 10 });
    const second = studies(run, sqlite, schema, { page: 2, pageSize: 10 });

    assert.equal(first.rows.length, 10);
    assert.equal(second.rows.length, 10);
    assert.notEqual(first.rows[0].uid, second.rows[0].uid);
    assert.equal(first.total, second.total);

    db.close();
  });

  it('and refuses a page size nobody meant', () => {
    const { run, schema, db } = look('as-documented');
    assert.equal(studies(run, sqlite, schema, { pageSize: 100000 }).pageSize, 200);
    db.close();
  });

  it('a per cent sign somebody types is a per cent sign, not a wildcard', () => {
    const { run, schema, db } = look('as-documented');

    const all = studies(run, sqlite, schema, { pageSize: 1 }).total;
    const wild = studies(run, sqlite, schema, { description: '%', pageSize: 1 }).total;

    assert.notEqual(wild, all, 'a typed % matched everything');
    db.close();
  });

  it('and a study with two modalities is found by either of them', () => {
    const { run, schema, db } = look('combined-modalities');

    const ct = studies(run, sqlite, schema, { modality: 'CT', pageSize: 1 }).total;
    const mr = studies(run, sqlite, schema, { modality: 'MR', pageSize: 1 }).total;
    const clean = look('as-documented');
    const cleanCt = studies(clean.run, sqlite, clean.schema, { modality: 'CT', pageSize: 1 }).total;

    // A LIKE rather than an equality: a study that is CT\MR is a CT study, and
    // `= 'CT'` says it is not.
    assert.equal(ct, cleanCt, 'the combined studies fell out of the CT search');
    assert.ok(mr > 0);

    clean.db.close();
    db.close();
  });
});
