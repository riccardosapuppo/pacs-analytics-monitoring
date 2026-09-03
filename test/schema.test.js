/**
 * Reading the schema, and the one place where reading it changes the shape of
 * the query rather than a name in it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CANDIDATES, modalityExpression, resolution, resolve } from '../src/db/schema.js';
import { INSTALLATIONS, open } from '../src/fixtures/installations.js';
import { pickColumn, readable } from '../src/db/introspect.js';
import { postgres, sqlite, sqlserver } from '../src/db/dialect.js';
import { runner } from '../src/db/sqlite.js';

function look(at) {
  const { db } = open(at);
  const run = runner(db);
  return { schema: resolve(run, sqlite), run, db };
}

describe('picking a column out of what is there', () => {
  const columns = new Map([
    ['studysizekb', 'StudySizeKB'],
    ['studysizeinkb', 'StudySizeInKB'],
  ]);

  it('prefers the earlier candidate when both are present', () => {
    // An upgrade adds a column beside the one it replaces and stops writing to
    // the old one. Preferring the newer name is the difference between a
    // storage chart that is current and one that stopped growing in 2021.
    assert.equal(pickColumn(columns, ['StudySizeInKB', 'StudySizeKB', 'StudySize']), 'StudySizeInKB');
  });

  it('and returns the case the database uses, not the case it was asked for', () => {
    // PostgreSQL treats a double-quoted identifier as case-sensitive, so
    // "studysizeinkb" will not find a column called StudySizeInKB.
    assert.equal(pickColumn(columns, ['STUDYSIZEKB']), 'StudySizeKB');
  });

  it('and null when none of them is there, which is a fact rather than a fault', () => {
    assert.equal(pickColumn(columns, ['SourceDevice']), null);
    assert.equal(pickColumn(null, ['anything']), null);
  });

  it('a row can be read by whichever case the driver chose', () => {
    const row = readable({ StudyDate: '20240305' });
    assert.equal(row.StudyDate, '20240305');
    assert.equal(row.studydate, '20240305');
  });
});

describe('what each installation turns out to call things', () => {
  it('the documented one resolves everything on its first candidate', () => {
    const { schema, db } = look('as-documented');

    for (const one of resolution(schema)) {
      if (one.field === 'guid' || one.resolved === null) continue;
      assert.equal(one.position, 0, `${one.field} came from candidate ${one.position}`);
    }

    db.close();
  });

  it('the older one resolves four of them on a later candidate', () => {
    const { schema, db } = look('older-column-names');
    const later = resolution(schema).filter((one) => one.position > 0);

    assert.equal(later.length, 6, later.map((one) => one.field).join(", "));
    assert.equal(schema.size, 'StudySizeKB');
    assert.equal(schema.device, 'SourceAeTitle');

    db.close();
  });

  it('the one with no device column says so rather than inventing a name', () => {
    const { schema, db } = look('no-device-column');

    assert.equal(schema.device, null);
    assert.ok(
      schema.notes.some((one) => /no source device column/.test(one)),
      schema.notes.join(' | ')
    );

    db.close();
  });

  it('and every candidate list is ordered newest first', () => {
    // The order is the argument, so it is worth asserting that somebody has not
    // sorted these alphabetically at some point.
    assert.deepEqual(CANDIDATES.size, ['StudySizeInKB', 'StudySizeKB', 'StudySize']);
    assert.deepEqual(CANDIDATES.modality, ['ModalitiesInStudy', 'Modality', 'PrimaryModality']);
  });
});

describe('where the modality is, which changes the shape of the query', () => {
  it('on Study it is a column reference', () => {
    const { schema, db } = look('as-documented');

    assert.equal(schema.modalityFrom, 'study');
    assert.equal(modalityExpression(schema, sqlite, 's'), 's."ModalitiesInStudy"');

    db.close();
  });

  it('on Series it is a CORRELATED SUBQUERY, and never a join', () => {
    const { schema, db } = look('modality-on-series');

    assert.equal(schema.modalityFrom, 'series');

    const expression = modalityExpression(schema, sqlite, 's');

    // The single most important assertion in this file. Series is one-to-many:
    // a join multiplies every study by the number of series it contains and
    // carries its storage along, without erroring, keeping the shape of the
    // chart and changing every number on it.
    assert.match(expression, /^\(SELECT MIN\(/);
    assert.ok(!/\bJOIN\b/i.test(expression), expression);

    db.close();
  });

  it('and where there is none at all it is null, rather than an empty string', () => {
    const schema = { modalityFrom: null };
    assert.equal(modalityExpression(schema, sqlite, 's'), null);
  });
});

describe('the identifiers that reach the SQL', () => {
  it('are quoted by the dialect, three different ways', () => {
    assert.equal(sqlite.quote('StudyDate'), '"StudyDate"');
    assert.equal(sqlserver.quote('StudyDate'), '[StudyDate]');
    assert.equal(postgres.quote('StudyDate'), '"StudyDate"');
  });

  it('and anything that is not an identifier is refused, not escaped', () => {
    // Column names never come from a request — they come from introspection,
    // which means they came from the database. This is the belt on top of
    // that: there is no escaping here to get subtly wrong.
    for (const bad of ['Study Date', 'Study;DROP', '1Study', '', null, 'Study"Date']) {
      assert.throws(() => sqlite.quote(bad), /not an identifier/, `it accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe('the six installations', () => {
  it('are six, each differing in exactly one thing', () => {
    assert.equal(INSTALLATIONS.length, 6);

    for (const one of INSTALLATIONS) {
      assert.ok(one.differs, `${one.name} does not say how it differs`);
      assert.ok(one.why, `${one.name} does not say why it is like that`);
    }
  });

  it('and all of them can be read', () => {
    for (const one of INSTALLATIONS) {
      const { schema, db } = look(one.name);
      assert.equal(schema.ok, true, `${one.name}: missing ${schema.missing?.join(', ')}`);
      db.close();
    }
  });
});
