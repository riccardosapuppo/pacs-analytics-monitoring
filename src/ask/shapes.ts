/**
 * The shapes every question in this folder shares.
 *
 * All of them are handed the same four things — a way to run a query, the
 * dialect to write it in, the schema that was found in this database, and the
 * filters somebody set on the page — and that repetition is the point rather
 * than an accident: a question that needed a fifth thing would be a question
 * that knew something about the installation, which is exactly what this
 * project is arguing against.
 */

import type { Dialect } from '../db/dialect.ts';
import type { Schema } from '../db/schema.ts';
import type { Run } from '../db/sqlite.ts';

export type { Dialect, Schema, Run };

/** What the page can narrow by. Every field optional; absent means "all". */
export type Filters = {
  from?: string | undefined;
  to?: string | undefined;
  modality?: string | undefined;
  description?: string | undefined;
  accession?: string | undefined;
  partition?: string | undefined;
  device?: string | undefined;
  uid?: string | undefined;
  sort?: string | undefined;
  direction?: string | undefined;
  granularity?: string | undefined;
  page?: string | number | undefined;
  pageSize?: string | number | undefined;
};

/**
 * Collects the values a query binds, and hands back the placeholder for each.
 *
 * Written as an object rather than an array because the placeholder differs by
 * dialect — `?` in SQLite, `$1` in Postgres — so the caller cannot know what to
 * write without asking.
 */
export type Bind = {
  add(value: unknown): string;
  /** A getter, not a method: `parameters()` exposes the array it is filling. */
  readonly values: unknown[];
};
