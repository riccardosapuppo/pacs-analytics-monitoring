/**
 * The comparison itself: eight questions, six installations, two ways of asking.
 *
 * ── Why this is in src/ and not in the tool that prints it ───────────────────
 *
 * Because two things show it now. `npm run measure` prints it to a terminal and
 * fails the run when the resolved side is not right everywhere -- a check needs
 * an exit code, and a web page has none. The console shows the same grid on a
 * screen, because the argument of this project is that grid, and a reader who
 * has to open a terminal to see the argument mostly does not see it.
 *
 * Two audiences, one computation. Written twice they could disagree, and a page
 * and a check quietly disagreeing about the same numbers is precisely the
 * failure this project is about. So it is computed here, once, and the tool and
 * the route are both callers.
 *
 * Nothing here prints, exits, or holds a database open longer than it takes.
 */

import { INSTALLATIONS, open } from '../fixtures/installations.ts';
import { QUESTIONS, ABOUT, askResolved } from './questions.ts';
import { askStraight } from '../ask/straight.ts';
import { judge, truthFor } from './truth.ts';
import { mustResolve } from '../db/schema.ts';
import { runner } from '../db/sqlite.ts';
import { sqlite } from '../db/dialect.ts';

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
export type Kind = 'right' | 'patched' | 'loud' | 'silent';

export interface Outcome {
  readonly outcome: Kind;

  /** What went wrong, in words, or empty when nothing did. */
  readonly why: string;

  /** Which route the answer took: as written, patched, refused, threw. */
  readonly how: string;
}

export interface Cell {
  readonly installation: string;
  readonly question: string;
  readonly straight: Outcome;
  readonly resolved: Outcome;
}

export interface Comparison {
  readonly installations: readonly string[];
  readonly questions: readonly string[];

  /** One line per question saying what it is really asking. */
  readonly about: Readonly<Record<string, string>>;
  readonly cells: readonly Cell[];
}

/** What `askResolved` and `askStraight` both return. */
type Said = { how: string; value: unknown; error: string | null };

export function outcomeOf(ask: () => unknown, wantedIn: unknown): Outcome {
  const wanted = wantedIn as { unanswerable?: boolean } | null;
  let said: Said;

  try {
    said = ask() as Said;
  } catch (error) {
    return { outcome: 'loud', why: error instanceof Error ? error.message : String(error), how: 'threw' };
  }

  if (said.how === 'unanswerable') {
    // Saying "there is no such column here" is only right if there really is
    // nothing to answer with. Where the truth has an answer, refusing is a
    // loud failure like any other.
    if (wanted && wanted.unanswerable) return { outcome: 'right', why: '', how: said.how };
    return { outcome: 'loud', why: said.error ?? '', how: said.how };
  }

  const verdict = judge(wanted, said.value);

  if (!verdict.right) {
    return { outcome: 'silent', why: `${said.how}: ${verdict.why}`, how: said.how };
  }

  return { outcome: said.how === 'patched' ? 'patched' : 'right', why: '', how: said.how };
}

/**
 * Every question against every installation, both ways.
 *
 * Each database is opened, asked, and closed again: they are built in memory
 * from the invented facts, so this costs a few milliseconds and leaves nothing
 * behind. That matters for the route -- a request that leaks a handle per call
 * is a server that dies on the fiftieth reader.
 */
export function compareEverything(): Comparison {
  const cells: Cell[] = [];

  for (const installation of INSTALLATIONS) {
    const { db } = open(installation.name);

    try {
      const run = runner(db as unknown as Parameters<typeof runner>[0]);
      const schema = mustResolve(run, sqlite);
      const truth = truthFor(installation.name);

      for (const question of QUESTIONS) {
        const wanted = truth[question as keyof typeof truth];

        cells.push({
          installation: installation.name,
          question,
          straight: outcomeOf(() => askStraight(run, question, installation.name), wanted),
          resolved: outcomeOf(
            () => ({ how: 'resolved', value: askResolved(run, sqlite, schema, question), error: null }),
            wanted
          ),
        });
      }
    } finally {
      db.close();
    }
  }

  return {
    installations: INSTALLATIONS.map((one) => one.name),
    questions: [...QUESTIONS],
    about: ABOUT as Readonly<Record<string, string>>,
    cells,
  };
}

/** The four counts for one side of one installation, or of one question. */
export function tally(sides: readonly Outcome[]): Record<Kind, number> {
  const count = (what: Kind) => sides.filter((one) => one.outcome === what).length;
  return { right: count('right'), patched: count('patched'), loud: count('loud'), silent: count('silent') };
}
