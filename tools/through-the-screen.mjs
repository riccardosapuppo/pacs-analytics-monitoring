#!/usr/bin/env node
/**
 * The console, driven with a browser.
 *
 *     npm run check:screen
 *     npm run check:screen -- --show          with a visible browser
 *     npm run check:screen -- --against URL   against something already running
 *
 * The layer the others cannot reach. `npm test` says the parts work,
 * `npm run measure` says the answers are right, `npm run check:dialects` says
 * the SQL is the dialect it means to be — and only this says that a person can
 * change the installation and **watch the two sides come apart**, which is the
 * one thing this project is for.
 *
 * It starts its own service on a port nothing else uses, so it can never go
 * green having measured a stranger's process.
 */

import { createRequire } from 'node:module';

import { startTheService } from './with-the-service.mjs';

const show = process.argv.includes('--show');

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright-core'));
} catch {
  console.error('playwright-core is not installed here, so this check cannot run.');
  console.error('  npm install');
  process.exit(2);
}

let checks = 0;
let bad = 0;

function is(what, got, wanted, detail) {
  checks += 1;

  if (got === wanted) return console.log(`    ok    ${what}`);

  bad += 1;
  console.log(`    NO    ${what}\n            wanted ${JSON.stringify(wanted)}, got ${JSON.stringify(detail ?? got)}`);
}

function has(what, got, wanted) {
  checks += 1;

  if (String(got ?? '').toLowerCase().includes(String(wanted).toLowerCase())) {
    return console.log(`    ok    ${what}`);
  }

  bad += 1;
  console.log(`    NO    ${what}\n            wanted something containing ${JSON.stringify(wanted)}, got ${JSON.stringify(got)}`);
}

const say = (what) => console.log(`\n  ${what}`);

const service = await startTheService();
const browser = await chromium.launch({ channel: 'msedge', headless: !show });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, reducedMotion: 'reduce' });

// Anything the page throws fails this even if every assertion passes: a screen
// that works while quietly throwing is a screen that stops working on the next
// browser.
const thrown = [];
page.on('pageerror', (error) => thrown.push(`threw: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') thrown.push(message.text());
});

/** Change the installation and wait for the page to have caught up. */
async function look(at) {
  await page.selectOption('#installation', at);
  await page.waitForFunction(
    (name) => document.getElementById('differs-says')?.dataset.showing === name,
    at,
    { timeout: 10_000 }
  );
}

const kpi = async (n) => (await page.locator('.kpis dd').nth(n).textContent()).trim();
const redRows = async () =>
  (await page.locator('#straight-list li[data-how="wrong"]').allTextContents()).map((one) =>
    one.replace(/\s+/g, ' ').trim()
  );

try {
  console.log(`\n  driving ${service.base} through the screen`);

  await page.goto(`${service.base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // ── 1. the control that matters ──────────────────────────────────────────
  say('the installations are all there to choose from');

  const offered = await page.locator('#installation option').allTextContents();
  is('six of them', offered.length, 6, offered.join(', '));
  is('and it opens on the documented one', offered[0], 'as-documented');

  // ── 2. the baseline is right where the schema is as documented ───────────
  say('on the installation whose schema matches the documentation');

  await look('as-documented');
  const studies = await kpi(0);
  is('the archive is 2,200 studies', studies, '2,200');
  is(
    'and NOTHING is marked wrong on the straight side',
    (await redRows()).length,
    0,
    (await redRows()).join(' | ')
  );

  // That assertion is the one that keeps this honest. If the baseline were
  // built to lose it would be wrong here too, and the whole measurement would
  // be a rigged comparison.

  // ── 3. the same studies, a different schema, the same answers ────────────
  say('changing the schema underneath does not change the answers');

  for (const which of ['older-column-names', 'modality-on-series', 'no-device-column']) {
    await look(which);
    is(`${which}: still 2,200 studies`, await kpi(0), '2,200');
  }

  // ── 4. and the straight side comes apart ─────────────────────────────────
  say('while the side that writes its SQL out does');

  await look('modality-on-series');
  const join = (await redRows()).join(' ');
  has('the join is caught, and by how much', join, 'too many');
  has('and it names the modality it got wrong', join, 'studies per modality');

  await look('combined-modalities');
  has('a category that is neither is caught', (await redRows()).join(' '), 'which is neither');

  await look('undatable-rows');
  const undated = (await redRows()).join(' ');
  has('and the four undatable rows are caught in the count', undated, 'how many studies');
  has(
    'the page says how many rows it could not date',
    await page.textContent('#undatable'),
    'cannot be dated'
  );

  // ── 5. a view that cannot be answered says so ────────────────────────────
  say('a view this installation cannot answer');

  await look('no-device-column');
  has('the device panel says why, rather than drawing nothing', await page.textContent('#devices'), 'Not answerable');
  has('and names the columns it looked for', await page.textContent('#devices'), 'SourceAeTitle');
  is(
    'the rest of the page still answers',
    await kpi(1),
    '472.6 GB',
    await kpi(1)
  );

  // ── 6. what it found in the schema ───────────────────────────────────────
  say('what it found, shown');

  await page.evaluate(() => {
    document.getElementById('found').open = true;
  });
  await page.waitForTimeout(300);

  await look('older-column-names');
  has('the resolved table names the older column', await page.textContent('#resolved'), 'StudySizeKB');
  is(
    'and marks the ones that were not the first choice',
    (await page.locator('#resolved tr[data-state="later"]').count()) > 0,
    true
  );

  // ── 7. the charts are drawn ──────────────────────────────────────────────
  say('the charts');

  await look('as-documented');
  is('the donut has a slice per modality', await page.locator('.donut path, .donut circle').count(), 8);
  is('the heatmap is a full grid, holes included', await page.locator('.heat-cell').count(), 168);
  is(
    'the forecast columns are dashed, so they cannot be read as measurements',
    (await page.locator('#storage rect.ahead').count()) > 0,
    true
  );
  is('and the study list has rows in it', (await page.locator('#studies tr').count()) > 5, true);

  // ── 8. and quietly ───────────────────────────────────────────────────────
  say('and the page itself');
  is('nothing was thrown while all that happened', thrown.length, 0, thrown.join(' | '));

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  is('it does not scroll sideways at 760 wide', overflow <= 1, true, String(overflow));
} catch (error) {
  console.error(`\n  the journey stopped: ${error.message.split('\n')[0]}`);
  bad += 1;
} finally {
  await browser.close();
  await service.stop();
}

console.log('');

if (bad > 0) {
  console.log(`${bad} of ${checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`${checks} checks: somebody can change the schema and watch the two sides come apart.`);
}
