/**
 * Dates that are not dates.
 *
 * `StudyDate` is a `VARCHAR(8)` holding whatever a modality put in it, and
 * every one of these is a shape that turns up in a real archive.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bucket, datable, fromDicomDate, readBucket, toDicomDate, within } from '../src/ask/dates.js';
import { parameters } from '../src/db/sqlite.js';
import { sqlite } from '../src/db/dialect.js';

const schema = { date: 'StudyDate', partition: 'ServerPartitionGUID' };

describe('reading a date somebody typed', () => {
  it('takes the three ways a person writes one', () => {
    assert.equal(toDicomDate('2024-03-05'), '20240305');
    assert.equal(toDicomDate('2024/03/05'), '20240305');
    assert.equal(toDicomDate('20240305'), '20240305');
  });

  it('and a Date, in UTC, so a timezone cannot move it a day', () => {
    assert.equal(toDicomDate(new Date(Date.UTC(2024, 2, 5))), '20240305');
  });

  it('and refuses anything else rather than guessing', () => {
    for (const one of ['', null, undefined, 'March', '2024-3-5', '05/03/2024', '2024030', new Date('nonsense')]) {
      assert.equal(toDicomDate(one), null, `it accepted ${JSON.stringify(one)}`);
    }
  });

  it('reads one back for a person, and leaves rubbish alone', () => {
    assert.equal(fromDicomDate('20240305'), '2024-03-05');
    assert.equal(fromDicomDate('UNKNOWN'), 'UNKNOWN');
    assert.equal(fromDicomDate(''), '');
  });
});

describe('the guard every dated query carries', () => {
  it('checks the length before the digits', () => {
    // Length first is not style. `NOT LIKE '%[^0-9]%'` over a long string is
    // the more expensive of the two on SQL Server, and a ten-character value
    // fails the cheap test first.
    const clause = datable(schema, sqlite, 's');
    assert.ok(clause.indexOf('LENGTH') < clause.indexOf('GLOB'), clause);
  });

  it('and asks for exactly eight, not at least eight', () => {
    assert.match(datable(schema, sqlite), /= 8/);
  });

  it('the digits test is a negative match, not a first-character one', () => {
    // `x GLOB '[0-9]*'` only checks the first character, which passes
    // '2024-03-05' — exactly the half-guard that makes a dashboard confident
    // and wrong.
    const clause = datable(schema, sqlite);
    assert.match(clause, /NOT GLOB/);
  });
});

describe('a period, over strings', () => {
  it('compares the dates as strings, which is why YYYYMMDD was chosen', () => {
    const bind = parameters(sqlite);
    const clause = within(schema, sqlite, bind, { from: '2024-03-01', to: '2024-03-31' }, 's');

    assert.match(clause, />= \?/);
    assert.match(clause, /<= \?/);
    assert.deepEqual(bind.values, ['20240301', '20240331']);
  });

  it('and every value is a parameter, never text in the SQL', () => {
    const bind = parameters(sqlite);
    const clause = within(schema, sqlite, bind, { from: '2024-03-01', partition: "'; DROP TABLE Study; --" }, 's');

    assert.ok(!clause.includes('DROP'), clause);
    assert.ok(bind.values.includes("'; DROP TABLE Study; --"));
  });

  it('a date it cannot read is left out rather than passed through', () => {
    const bind = parameters(sqlite);
    within(schema, sqlite, bind, { from: 'last Tuesday' }, 's');

    assert.deepEqual(bind.values, [], 'an unreadable date became a filter');
  });
});

describe('the buckets a trend is drawn from', () => {
  it('are substrings, which is the one thing this column is good at', () => {
    assert.match(bucket(schema, sqlite, 'year', 's'), /SUBSTR\(.*, 1, 4\)/);
    assert.match(bucket(schema, sqlite, 'month', 's'), /SUBSTR\(.*, 1, 6\)/);
    assert.match(bucket(schema, sqlite, 'day', 's'), /SUBSTR\(.*, 1, 8\)/);
  });

  it('and anything else is refused rather than silently made a month', () => {
    assert.throws(() => bucket(schema, sqlite, 'fortnight', 's'), /granularity/);
  });

  it('read back the way a person writes them', () => {
    assert.equal(readBucket('2024'), '2024');
    assert.equal(readBucket('202403'), '2024-03');
    assert.equal(readBucket('20240305'), '2024-03-05');
    assert.equal(readBucket('2024-0'), '2024-0', 'rubbish comes back as itself rather than being tidied');
  });
});
