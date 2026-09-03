#!/usr/bin/env node
/**
 * The pictures in the README, made rather than taken.
 *
 *     npm run screenshots
 *
 * Nothing here photographs the screen. It starts its own service on its own
 * port, opens the console in a browser, drives it, and captures **the page** —
 * so whatever else happens to be on this machine cannot end up in a file about
 * to be pushed to a repository.
 *
 * Generated rather than kept by hand so they cannot quietly stop matching the
 * thing they are pictures of. Re-run whenever the console changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { startTheService } from './with-the-service.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(here, '..', 'docs');

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright-core'));
} catch {
  console.error('playwright-core is not installed here, so the pictures cannot be retaken.');
  console.error('  npm install');
  process.exit(2);
}

fs.mkdirSync(DOCS, { recursive: true });

const service = await startTheService();
const browser = await chromium.launch({ channel: 'msedge' });
const say = (name: string): void => console.log(`  docs/${name}`);

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1150 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });

  const look = async (at: string) => {
    await page.selectOption('#installation', at);
    await page.waitForFunction(
      (name: string) => document.getElementById('differs-says')?.dataset.showing === name,
      at,
      { timeout: 15_000 }
    );
    await page.waitForTimeout(400);
  };

  await page.goto(`${service.base}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. The whole page, on the installation whose schema matches the
  //    documentation — where the straight side is right about everything, which
  //    is the picture that stops this looking like a rigged comparison.
  await page.screenshot({ path: path.join(DOCS, 'console.png'), fullPage: true });
  say('console.png');

  // 2. The cell the project is about: the modality on Series, and the obvious
  //    repair multiplying every count.
  await look('modality-on-series');
  await page.locator('.numbers').screenshot({ path: path.join(DOCS, 'the-join.png') });
  say('the-join.png');

  // 3. The four rows nothing can date, and what they do to a page that does not
  //    mention them.
  await look('undatable-rows');
  await page.locator('.numbers').screenshot({ path: path.join(DOCS, 'undatable.png') });
  say('undatable.png');

  // 4. What the schema turned out to be. The panel that makes every number
  //    above it traceable to a column.
  await look('older-column-names');
  await page.evaluate(() => {
    (document.getElementById('found') as HTMLDetailsElement).open = true;
  });
  await page.waitForTimeout(400);
  await page.locator('#found').screenshot({ path: path.join(DOCS, 'what-it-found.png') });
  say('what-it-found.png');

  // 5. A view that cannot be answered here, drawn as a fact rather than an
  //    empty chart.
  await look('no-device-column');
  await page.locator('.two').screenshot({ path: path.join(DOCS, 'not-answerable.png') });
  say('not-answerable.png');

  // 6. The mark, at the sizes it is actually seen.
  const mark = await browser.newPage({ viewport: { width: 320, height: 96 }, deviceScaleFactor: 4 });
  const svg = fs.readFileSync(path.join(here, '..', 'public', 'mark.svg'), 'utf8');

  await mark.setContent(
    `<style>html,body{margin:0;background:#f2f4f7;display:flex;gap:18px;align-items:center;
       justify-content:center;height:96px}img{display:block}</style>` +
      [16, 32, 64]
        .map(
          (size) =>
            `<img src="data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}" width="${size}" height="${size}">`
        )
        .join('')
  );

  await mark.waitForFunction(() => Array.from(document.images).every((one) => one.complete));
  await mark.screenshot({ path: path.join(DOCS, 'the-mark.png') });
  say('the-mark.png');
  await mark.close();

  await page.close();
} catch (error) {
  console.error(`\nThe pictures could not be retaken: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
  await service.stop();
}

console.log(`\nThe pictures in the README are of the console as it is now.`);
