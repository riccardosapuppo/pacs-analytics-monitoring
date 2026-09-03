#!/usr/bin/env node
/**
 * The claim, measured.
 *
 *     npm run measure
 *     npm run measure -- --detail       every cell, with what went wrong
 *
 * Eight questions, six installations, two ways of answering each. The
 * installations hold **the same studies**; they disagree only about how to
 * write them down. So every question has one right answer, worked out from the
 * facts in plain JavaScript by `src/measure/truth.js` — never by running a
 * query, because an expectation computed the way the answer is computed agrees
 * with a bug.
 *
 * ── Four outcomes, and the last one is the subject ───────────────────────────
 *
 *   right    it ran as written and matched the facts
 *   patched  it errored, the obvious one-line repair ran, and that matched
 *   loud     it errored and nothing obvious repairs it
 *   silent   it ran, answered, and was wrong
 *
 * The first three have one thing in common: **somebody knows**. A query that
 * cannot find a column stops the page and gets fixed on Monday. A query that
 * joins a one-to-many table returns numbers six times too large, keeps the
 * shape of the chart, and is believed -- because a number on a dashboard is
 * believed.
 *
 * The baseline is not built to lose. On the installation whose schema matches
 * the documentation it gets all eight right, which is what it should do: it is
 * the query anybody writes first, correctly, having read the schema they were
 * given.
 *
 * The run fails if the resolved side is not right everywhere. That is not a
 * vanity threshold: the installations hold the same studies, so anything other
 * than the same answers is a defect, and there is no version of this project
 * in which that is acceptable.
 */

import { INSTALLATIONS, open } from '../src/fixtures/installations.js';
import { QUESTIONS, ABOUT, askResolved } from '../src/measure/questions.js';
import { askStraight } from '../src/ask/straight.js';
import { judge, truthFor } from '../src/measure/truth.js';
import { resolve } from '../src/db/schema.js';
import { runner } from '../src/db/sqlite.js';
import { sqlite } from '../src/db/dialect.js';

const detail = process.argv.includes('--detail');

const results = [];

for (const installation of INSTALLATIONS) {
  const { db } = open(installation.name);
  const run = runner(db);
  const schema = resolve(run, sqlite);
  const truth = truthFor(installation.name);

  for (const question of QUESTIONS) {
    const wanted = truth[question];

    results.push({
      installation: installation.name,
      question,
      straight: outcomeOf(() => askStraight(run, question, installation.name), wanted),
      resolved: outcomeOf(() => ({ how: 'resolved', value: askResolved(run, sqlite, schema, question), error: null }), wanted),
    });
  }

  db.close();
}

// ---------------------------------------------------------------- the report

console.log('\nEight questions, six installations holding the same studies.\n');

const width = Math.max(...INSTALLATIONS.map((one) => one.name.length));
const head = `${'installation'.padEnd(width)}   SQL written straight              the schema read first`;

console.log(head);
console.log(`${'-'.repeat(width)}   ${'-'.repeat(30)}    ${'-'.repeat(24)}`);

for (const installation of INSTALLATIONS) {
  const mine = results.filter((one) => one.installation === installation.name);

  console.log(
    `${installation.name.padEnd(width)}   ${score(mine.map((one) => one.straight)).padEnd(30)}    ${score(
      mine.map((one) => one.resolved)
    )}`
  );
}

console.log('');
console.log('  right    ran as written, and matches the facts');
console.log('  patched  errored, and the obvious one-line repair was right');
console.log('  loud     errored, and nothing obvious repairs it');
console.log('  SILENT   ran, answered, and was wrong. Nobody sees anything.');

// ------------------------------------------------------- the number that counts

const silentlyWrong = results.filter((one) => one.straight.outcome === 'silent');

console.log(`\n${'='.repeat(72)}`);
console.log(`  ${silentlyWrong.length} of ${results.length} answers were WRONG WITHOUT ERRORING.`);
console.log(`${'='.repeat(72)}\n`);

for (const one of silentlyWrong) {
  console.log(`  ${one.installation} · ${one.question}`);
  console.log(`      ${one.straight.why}`);
}

if (silentlyWrong.length === 0) console.log('  (none, which would mean the fixtures have stopped being awkward)');

// ------------------------------------------------------------------ per question

console.log('\nBy question — where the straight version comes apart:\n');

for (const question of QUESTIONS) {
  const mine = results.filter((one) => one.question === question);
  const count = (what) => mine.filter((one) => one.straight.outcome === what).length;

  console.log(
    `  ${question.padEnd(30)} ` +
      `${String(count('patched')).padStart(2)} patched  ` +
      `${String(count('loud')).padStart(2)} loud  ` +
      `${String(count('silent')).padStart(2)} SILENT   ${ABOUT[question]}`
  );
}

if (detail) {
  console.log('\nEvery cell:\n');

  for (const one of results) {
    const mark = (side) =>
      ({ right: 'ok     ', patched: 'patched', loud: 'LOUD   ', silent: 'SILENT ' })[side.outcome];
    console.log(`  ${one.installation.padEnd(width)}  ${one.question.padEnd(30)}  straight ${mark(one.straight)}  read ${mark(one.resolved)}`);
    if (one.straight.why) console.log(`      straight: ${one.straight.why}`);
    if (one.resolved.why) console.log(`      read:     ${one.resolved.why}`);
  }
}

// ---------------------------------------------------------------- the gate

const readWrong = results.filter((one) => one.resolved.outcome !== 'right');

console.log('');

if (readWrong.length > 0) {
  console.log(`${readWrong.length} answers are wrong on the side that reads the schema first. That is a defect:`);
  console.log('the six installations hold the same studies, so they must give the same answers.\n');

  for (const one of readWrong) {
    console.log(`  ${one.installation} · ${one.question}: ${one.resolved.why}`);
  }

  process.exitCode = 1;
} else {
  console.log('Reading the schema first: every question, every installation, right.');
  console.log(`Writing the SQL straight: ${silentlyWrong.length} answers wrong with nothing to show for it.`);
}

// ---------------------------------------------------------------------------

/**
 * What happened, in four kinds rather than two.
 *
 *   right    it ran as written and matched the facts
 *   patched  it errored, the obvious one-line repair ran, and THAT matched
 *   loud     it errored and nothing obvious repairs it
 *   silent   it ran -- as written or repaired -- and was wrong
 *
 * `patched` is its own kind because collapsing it either way would tell a lie.
 * Counting it as `right` hides that the query did not work on that site at all;
 * counting it as `loud` hides that somebody fixed it in an afternoon and moved
 * on, which is what actually happens.
 *
 * The three that are not `silent` all have one thing in common: **somebody
 * knows**. That is the line the whole measurement is drawn around.
 */
function outcomeOf(ask, wanted) {
  let said;

  try {
    said = ask();
  } catch (error) {
    return { outcome: 'loud', why: error.message, how: 'threw' };
  }

  if (said.how === 'unanswerable') {
    // Saying "there is no such column here" is only right if there really is
    // nothing to answer with. Where the truth has an answer, refusing is a
    // loud failure like any other.
    if (wanted && wanted.unanswerable) return { outcome: 'right', why: '', how: said.how };
    return { outcome: 'loud', why: said.error, how: said.how };
  }

  const verdict = judge(wanted, said.value);

  if (!verdict.right) {
    return { outcome: 'silent', why: `${said.how}: ${verdict.why}`, how: said.how };
  }

  return { outcome: said.how === 'patched' ? 'patched' : 'right', why: '', how: said.how };
}

function score(sides) {
  const count = (what) => sides.filter((one) => one.outcome === what).length;
  const parts = [`${count('right')} right`];

  if (count('patched')) parts.push(`${count('patched')} patched`);
  if (count('loud')) parts.push(`${count('loud')} loud`);
  parts.push(`${count('silent')} SILENT`);

  return parts.join('  ');
}
