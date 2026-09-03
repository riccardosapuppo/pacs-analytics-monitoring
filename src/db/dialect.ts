/**
 * Three dialects, one query builder.
 *
 * Every query in `src/ask/` is assembled from the pieces below rather than
 * written out, so the same question can be asked of SQLite, SQL Server or
 * PostgreSQL without three copies of it drifting apart. The pieces are small on
 * purpose: a dialect that could rewrite whole queries would end up being three
 * implementations wearing one name.
 *
 * ── What is executed, and what is not ─────────────────────────────────────────
 *
 * **SQLite is executed.** It is in the runtime (`node:sqlite`, Node 24), so the
 * measurement, the tests and the service all really run, against six real
 * databases, with no server to install.
 *
 * **SQL Server and PostgreSQL are checked as text.** `npm run check:dialects`
 * asserts the SQL each one generates, statement by statement, against strings
 * written down by hand. That is a weaker claim than executing it and this file
 * is the wrong place to pretend otherwise: it proves the builder emits the
 * dialect it means to, and it does not prove the server accepts it.
 *
 * Saying which is which matters more than the number of dialects. A page that
 * listed three and executed one would be making a claim about two databases it
 * had never connected to.
 */

/**
 * Quote an identifier, and refuse anything that is not one.
 *
 * It takes `string | null` on purpose. Half the columns in `Schema` are
 * nullable -- an installation that does not have `StudySizeInKB` is a different
 * build, not a broken one -- and a query that reaches for a missing column is a
 * bug in the query rather than a fact about the database. Refusing here says so
 * once, loudly, instead of asking twenty-eight call sites to assert it.
 */
function safe(name: string | null | undefined): string {
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`not an identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * SQLite — the one that runs.
 *
 * Note `digitsOnly`: SQLite has no regular expressions by default, so the test
 * is a negative GLOB. `x GLOB '[0-9]*'` would only check the first character,
 * which passes `'2024-03-05'` and is exactly the sort of half-guard that makes a
 * dashboard confident and wrong.
 */
/**
 * One SQL dialect: the pieces of syntax that differ between them.
 *
 * Written as functions rather than as strings with holes, because the
 * differences are not all substitutions — `COUNT` and `COUNT_BIG`, `?` and
 * `$1`, three spellings of a substring. A shape they all satisfy is what lets
 * the queries be written once and checked three ways.
 */
export type Dialect = {
  name: string;
  executed: boolean;
  quote: (name: string | null) => string;
  placeholder: (n: number) => string;
  count: () => string;
  length: (x: string) => string;
  digitsOnly: (x: string) => string;
  toFloat: (x: string) => string;
  toInt: (x: string) => string;
  round: (x: string, places: number) => string;
  substring: (x: string, from: number, length: number) => string;
  today: () => string;
  weekday: (date: string) => string;
  hour: (time: string) => string;
  tables: (table?: string) => string;
  columns: (table: string) => string;
};

export const sqlite: Dialect = {
  name: 'sqlite',
  executed: true,

  quote: (name: string | null) => `"${safe(name)}"`,
  placeholder: () => '?',
  count: () => 'COUNT(*)',
  length: (x: string) => `LENGTH(${x})`,
  digitsOnly: (x: string) => `${x} NOT GLOB '*[^0-9]*'`,
  toFloat: (x: string) => `CAST(${x} AS REAL)`,
  toInt: (x: string) => `CAST(${x} AS INTEGER)`,
  round: (x: string, places: number) => `ROUND(${x}, ${places})`,
  substring: (x: string, from: number, length: number) => `SUBSTR(${x}, ${from}, ${length})`,
  today: () => `strftime('%Y%m%d', 'now')`,

  // Monday = 0. strftime('%w') counts from Sunday, so it is rotated.
  weekday: (date: string) =>
    `((CAST(strftime('%w', SUBSTR(${date}, 1, 4) || '-' || SUBSTR(${date}, 5, 2) || '-' || SUBSTR(${date}, 7, 2)) AS INTEGER) + 6) % 7)`,
  hour: (time: string) => `CAST(SUBSTR(${time}, 1, 2) AS INTEGER)`,

  tables: () => `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  columns: (table: string) => `SELECT name FROM pragma_table_info(${literal(table)})`,
};

/**
 * SQL Server.
 *
 * `COUNT_BIG` rather than `COUNT`: `COUNT` returns `int` and overflows at about
 * two billion rows, which an image archive counting instances rather than
 * studies will reach.
 */
export const sqlserver: Dialect = {
  name: 'sqlserver',
  executed: false,

  quote: (name: string | null) => `[${safe(name)}]`,
  placeholder: (n: number) => `@p${n}`,
  count: () => 'COUNT_BIG(*)',
  length: (x: string) => `LEN(${x})`,
  digitsOnly: (x: string) => `${x} NOT LIKE '%[^0-9]%'`,
  toFloat: (x: string) => `CAST(${x} AS FLOAT)`,
  toInt: (x: string) => `CAST(${x} AS INT)`,
  round: (x: string, places: number) => `ROUND(${x}, ${places})`,
  substring: (x: string, from: number, length: number) => `SUBSTRING(${x}, ${from}, ${length})`,
  today: () => `CONVERT(varchar(8), GETDATE(), 112)`,

  // 1 January 1900 was a Monday, so the remainder is already Monday-based.
  weekday: (date: string) => `(DATEDIFF(day, '19000101', TRY_CONVERT(date, ${date}, 112)) % 7)`,
  hour: (time: string) => `CAST(SUBSTRING(${time}, 1, 2) AS INT)`,

  tables: () => `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo'`,
  columns: (table: string) =>
    `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS WHERE LOWER(TABLE_NAME) = ${literal(
      table.toLowerCase()
    )} AND TABLE_SCHEMA = 'dbo'`,
};

/**
 * PostgreSQL.
 *
 * Two traps, both of which cost somebody an afternoon before they were written
 * down. `ROUND(x, n)` does not exist for `double precision` — only for
 * `numeric` — so the value is cast first. And an identifier quoted with double
 * quotes is case-SENSITIVE here, unlike SQL Server: `"studydate"` and
 * `"StudyDate"` are different columns. That is why introspection keeps the name
 * in the case the database gave it, rather than lowercasing it for tidiness.
 */
export const postgres: Dialect = {
  name: 'postgres',
  executed: false,

  quote: (name: string | null) => `"${safe(name)}"`,
  placeholder: (n: number) => `$${n}`,
  count: () => 'COUNT(*)',
  length: (x: string) => `char_length(${x})`,
  digitsOnly: (x: string) => `${x} ~ '^[0-9]+$'`,
  toFloat: (x: string) => `CAST(${x} AS double precision)`,
  toInt: (x: string) => `CAST(${x} AS integer)`,
  round: (x: string, places: number) => `round((${x})::numeric, ${places})`,
  substring: (x: string, from: number, length: number) => `SUBSTRING(${x} FROM ${from} FOR ${length})`,
  today: () => `to_char(now(), 'YYYYMMDD')`,

  weekday: (date: string) => `(EXTRACT(ISODOW FROM to_date(${date}, 'YYYYMMDD'))::int - 1)`,
  hour: (time: string) => `CAST(SUBSTRING(${time} FROM 1 FOR 2) AS integer)`,

  tables: () =>
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
  columns: (table: string) =>
    `SELECT column_name AS name FROM information_schema.columns WHERE lower(table_name) = ${literal(
      table.toLowerCase()
    )} AND table_schema NOT IN ('pg_catalog', 'information_schema')`,
};

/**
 * A string literal, for the two introspection queries only.
 *
 * Everything a caller can influence is a bound parameter; this exists because
 * an introspection query names a table, and a table name comes from this
 * codebase rather than from a request. The doubling is still done, because a
 * rule with an exception in it is a rule nobody can check.
 */
function literal(text: string): string {
  return `'${String(text).replace(/'/g, "''")}'`;
}

export const DIALECTS = { sqlite, sqlserver, postgres };

export function dialect(name: string): Dialect {
  const one = DIALECTS[name as keyof typeof DIALECTS];
  if (!one) throw new Error(`no dialect called ${name}`);
  return one;
}
