import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * What the README publishes about this repository, against the repository.
 *
 * The three browser-and-dialect checks assert their own printed count from
 * inside themselves (see `tools/readme-says.ts`), because each of them has just
 * counted and is already running. This one covers what is left: how many tests
 * there are, and whether every command the README tells somebody to run exists.
 *
 * Both numbers were true when this was written. They were true because somebody
 * had looked, which is not the same as being held there -- the first test added
 * would have left a published figure disagreeing with a printed one, quietly,
 * and a README that is wrong about its own repository is worse than one that
 * says nothing: it is confidently wrong, and it is the first thing anybody
 * reads.
 *
 * Counted from the files rather than by running the suite, so this is one read
 * of three files and not a second pass over everything. The two agree because
 * nothing here generates test cases in a loop -- and if that changes, the two
 * numbers will disagree and this is what will say so.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function casesInTheSuite(): number {
  return fs
    .readdirSync(here)
    .filter((name) => name.endsWith('.test.ts'))
    .reduce((all, name) => {
      const source = fs.readFileSync(path.join(here, name), 'utf8');
      return all + (source.match(/^\s*(?:it|test)\(/gm) ?? []).length;
    }, 0);
}

describe('the README, about this repository', () => {
  it('says how many tests there are, and is right', () => {
    // A pattern that has stopped matching finds nothing, contradicts nothing
    // and passes, so the emptiness is tested before the number.
    const said = readme.match(/^\s*npm test\s+#\s+(\d+)\b/m);

    assert.ok(said, 'the README no longer says how many tests there are, so nothing was compared');
    assert.equal(
      Number(said[1]),
      casesInTheSuite(),
      `the README says ${said[1]} and there are ${casesInTheSuite()}`
    );
  });

  it('tells nobody to run a command this package does not have', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    const named = [...readme.matchAll(/\bnpm run ([a-z][a-z:-]*)/g)].map((one) => one[1]!);
    assert.ok(named.length > 0, 'the README names no commands at all, which cannot be right');

    const missing = [...new Set(named)].filter((one) => !(one in (manifest.scripts ?? {})));
    assert.deepEqual(missing, [], `named in the README and not in package.json: ${missing.join(', ')}`);
  });
});
