/**
 * The number the README publishes about a check, against the number it ran.
 *
 * ── Why a check has to assert its own line ───────────────────────────────────
 *
 * The README lists the checks with a count beside each one:
 *
 *     npm run check:serving  # 33  nobody can be handed yesterday's page
 *
 * Those four numbers were all true. They were true because somebody had looked,
 * not because anything held them there -- so the first check added or removed
 * would have left a published number disagreeing with a printed one, quietly,
 * which is the shape of defect this repository keeps finding in other people's
 * code and had here in its own README.
 *
 * The cheapest place to catch it is inside the check itself: it has just run,
 * it knows its own count, and it is already running in CI. No extra job, no
 * second pass over the suite.
 *
 * ── Why a missing line fails rather than passes ──────────────────────────────
 *
 * A pattern that stops matching finds nothing, contradicts nothing, and reports
 * success. If the README stops naming a check, this says so instead of quietly
 * becoming an assertion about nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const README = path.join(here, '..', 'README.md');

/**
 * @param command the command as the README writes it, e.g. `npm run check:screen`
 * @param ran how many checks actually ran
 * @returns an explanation when they disagree, or null when they agree
 */
export function readmeDisagrees(command: string, ran: number): string | null {
  const readme = fs.readFileSync(README, 'utf8');

  // The command, then whitespace, a hash, whitespace, and the number. Written
  // against the block as it is, and it fails rather than shrugs if that block
  // is rewritten into some other shape.
  const line = new RegExp(`^\\s*${command.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+#\\s+(\\d+)\\b`, 'm');
  const found = readme.match(line);

  if (!found) {
    return `the README no longer says how many checks ${command} runs, so nothing was compared`;
  }

  const said = Number(found[1]);

  return said === ran
    ? null
    : `the README says ${command} runs ${said} checks and ${ran} ran. Whichever is wrong, they cannot both be published`;
}

/** Say it and fail the run. Used at the end of a check that has just counted. */
export function holdTheReadmeToIt(command: string, ran: number): void {
  const wrong = readmeDisagrees(command, ran);
  if (!wrong) return;

  console.log('');
  console.log(wrong);
  process.exitCode = 1;
}
