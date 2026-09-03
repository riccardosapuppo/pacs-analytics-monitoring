#!/usr/bin/env node
/**
 * The mark in the header and the mark in the tab have to be the same mark.
 *
 *     npm run check:mark
 *
 * They live in two files because they have to: the one in the page draws with
 * CSS custom properties so it sits on a light or a dark ground, and a favicon is
 * loaded outside the page and inherits nothing, so its colours are literal.
 *
 * Two files, one drawing — and "keep them in step by remembering" is not a plan.
 * This compares the geometry, which is what makes it the same mark, and ignores
 * the colours, which are the part that has to differ.
 *
 * It reads only the `<svg data-mark>` element, not every shape on the page.
 * WHICH element is the mark is a fact about the page, so the page states it —
 * the first version of this compared everything drawn anywhere and reported a
 * drift the moment a second drawing was added, which was a correct alarm about
 * the wrong thing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '..', 'public');

const page = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
const icon = fs.readFileSync(path.join(web, 'mark.svg'), 'utf8');

const marked = page.match(/<svg [^>]*data-mark[^]*?<[/]svg>/);

if (!marked) {
  console.error('No <svg data-mark> in public/index.html, so there is nothing to compare.');
  console.error('The header mark carries that attribute so this check knows which drawing is the mark.');
  process.exit(1);
}

/**
 * Every shape, as the numbers that place it.
 *
 * Read with a pattern rather than an XML parser: one of the two files is inside
 * an HTML document and the other is a standalone SVG, and the geometry is what
 * matters either way. Rects and circles, because a mark that grew a circle and
 * was compared only on its rectangles would compare nothing against nothing and
 * report a match.
 */
type Shape = Record<string, number | string | null>;

function shapes(source: string): Shape[] {
  const found: Shape[] = [];

  for (const one of source.matchAll(/<(rect|circle)\b([^>]*)>/g)) {
    const attributes = one[2] ?? '';
    const number = (name: string): number | null => {
      const hit = attributes.match(new RegExp(`\\b${name}="([\\d.]+)"`));
      return hit ? Number(hit[1]) : null;
    };

    found.push({
      kind: one[1],
      x: number('x') ?? 0,
      y: number('y') ?? 0,
      width: number('width'),
      height: number('height'),
      rx: number('rx'),
      cx: number('cx'),
      cy: number('cy'),
      r: number('r'),
      opacity: number('opacity'),
    });
  }

  return found;
}

const inPage = shapes(marked[0]);
const inIcon = shapes(icon);

let bad = 0;

if (inPage.length === 0 || inIcon.length === 0) {
  console.error(`Nothing was found to compare: ${inPage.length} shapes in the page, ${inIcon.length} in the favicon.`);
  console.error('A check that passes by finding nothing is worse than no check.');
  process.exit(1);
}

if (inPage.length !== inIcon.length) {
  console.error(`The header mark and the tab icon have drifted apart:\n`);
  console.error(`  the page draws ${inPage.length} shapes and the favicon ${inIcon.length}\n`);
  bad += 1;
} else {
  for (const [n, one] of inPage.entries()) {
    const other = inIcon[n];

    for (const key of Object.keys(one)) {
      if (one[key] !== other[key]) {
        console.error(`Shape ${n + 1} differs on ${key}: ${one[key]} in the page, ${other[key]} in the favicon.`);
        bad += 1;
      }
    }
  }
}

/**
 * And one ground colour, everywhere.
 *
 * A tab strip in one colour and an icon in another is worse than no theme
 * colour at all — the browser paints the strip before the icon loads, and the
 * two disagreeing is the sort of thing nobody reports and everybody notices.
 */
const grounds = {
  'the stylesheet': fs
    .readFileSync(path.join(web, 'console.css'), 'utf8')
    .match(/--mark-ground:\s*(#[0-9a-f]{6})/i)?.[1],
  'the favicon': icon.match(/<rect[^>]*rx="8"[^>]*fill="(#[0-9a-f]{6})"/i)?.[1],
  'the theme colour': page.match(/name="theme-color"\s+content="(#[0-9a-f]{6})"/i)?.[1],
};

for (const [where, colour] of Object.entries(grounds)) {
  if (!colour) {
    console.error(`No ground colour could be found in ${where}.`);
    bad += 1;
  }
}

const distinct = new Set(
  Object.values(grounds)
    .filter((one): one is string => typeof one === 'string')
    .map((one) => one.toLowerCase())
);

if (distinct.size > 1) {
  console.error(
    `The ground colour is not one colour: ${Object.entries(grounds)
      .map(([where, colour]) => `${colour} in ${where}`)
      .join(', ')}`
  );
  bad += 1;
}

if (bad > 0) {
  console.error('\nBoth are drawn in public/index.html and public/mark.svg.');
  process.exitCode = 1;
} else {
  console.log(`The mark matches: ${inPage.length} shapes, and one ground colour throughout.`);
}
