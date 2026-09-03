/**
 * The runner for the dialect that is actually executed.
 *
 * `node:sqlite` arrived in the runtime, so a project about querying a database
 * can be run by cloning it and typing `npm start`: no server, no container, no
 * account, no driver to install. That is not a convenience — it is what lets
 * the measurement in `src/measure/` build six databases with six different
 * schemas on every run, which is a thing nobody would do if it needed six
 * servers.
 */

import type { Dialect } from './dialect.ts';
import { readable } from './introspect.ts';

/**
 * Wrap a `DatabaseSync` as the `run(sql, params)` the rest of the code expects.
 *
 * Every row goes through `readable` so callers can ask for a column by the name
 * they chose in the SELECT without caring what the driver did to its case.
 */
/** One row, with its column names as the SELECT wrote them. */
export type Row = Record<string, unknown>;

/**
 * A query, and the shape its caller says it returns.
 *
 * Every query in `src/ask/` goes through one of these. The cast lives here
 * rather than at the call sites, because a driver cannot know what a SELECT
 * produces and forty casts saying so would say nothing.
 */
export type Run = {
  <T = Row>(sql: string, params?: unknown[]): T[];
  one: <T = Row>(sql: string, params?: unknown[]) => T | null;
};

export function runner(db: { prepare: (sql: string) => { all: (...p: unknown[]) => unknown[] } }): Run {
  const run = ((sql: string, params: unknown[] = []) => {
    const statement = db.prepare(sql);
    return statement.all(...params).map((row) => readable(row as Record<string, unknown>));
  }) as unknown as Run;

  run.one = ((sql: string, params: unknown[] = []) => run(sql, params)[0] ?? null) as Run['one'];

  return run;
}

/**
 * Build the parameter list for a dialect.
 *
 * SQLite takes positional `?`, SQL Server takes named `@p1`, PostgreSQL takes
 * `$1`. A query is assembled by pushing values here and using what comes back,
 * so the same builder emits the right marker for whichever dialect it was
 * handed — and so that **no value is ever put into the SQL text**. There is no
 * escaping function anywhere in `src/ask/`, which is the only way to be sure
 * none is being used.
 */
export function parameters(d: Dialect) {
  const values: unknown[] = [];

  return {
    /** Add a value, get back the placeholder that refers to it. */
    add(value: unknown): string {
      values.push(value);
      return d.placeholder(values.length);
    },
    get values() {
      return values;
    },
  };
}
