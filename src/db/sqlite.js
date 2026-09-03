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

import { readable } from './introspect.js';

/**
 * Wrap a `DatabaseSync` as the `run(sql, params)` the rest of the code expects.
 *
 * Every row goes through `readable` so callers can ask for a column by the name
 * they chose in the SELECT without caring what the driver did to its case.
 */
export function runner(db) {
  const run = (sql, params = []) => {
    const statement = db.prepare(sql);
    return statement.all(...params).map(readable);
  };

  run.one = (sql, params = []) => run(sql, params)[0] ?? null;

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
export function parameters(d) {
  const values = [];

  return {
    /** Add a value, get back the placeholder that refers to it. */
    add(value) {
      values.push(value);
      return d.placeholder(values.length);
    },
    get values() {
      return values;
    },
  };
}
