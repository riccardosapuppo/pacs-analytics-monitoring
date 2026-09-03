#!/usr/bin/env node
/**
 * Nobody can be handed yesterday's page.
 *
 *     npm run check:serving
 *
 * A caching header is right in the source and wrong in the response more often
 * than anything else in a small service, and the failure is invisible from
 * inside: everything works, on the machine that has never had an old copy.
 *
 * The specific trap this exists for — met in a sibling project and worth
 * carrying — is that `etag` and `lastModified` are **separate** options in
 * every static file server, and both default to on. Turning off only the first
 * leaves the revalidation that serves somebody a stale page.
 *
 * There is no framework here, so the serving is thirty lines in
 * `src/http/api.js`. That does not make it right; it makes it checkable.
 */

import { startTheService } from './with-the-service.mjs';

let checks = 0;
let bad = 0;

function must(what, condition, detail) {
  checks += 1;

  if (condition) return console.log(`  ok    ${what}`);

  bad += 1;
  console.log(`  NO    ${what}`);
  if (detail) console.log(`          ${detail}`);
}

const service = await startTheService();

try {
  console.log(`\nHow ${service.base} serves what it serves\n`);

  for (const path of ['/', '/console.js', '/charts.js', '/console.css', '/mark.svg']) {
    const response = await fetch(`${service.base}${path}`);
    const cache = response.headers.get('cache-control') ?? '';

    must(`${path} is served`, response.status === 200, `status ${response.status}`);
    must(`${path} says no-store`, /no-store/.test(cache), cache || '(no Cache-Control at all)');
    must(`${path} carries no ETag`, !response.headers.get('etag'), response.headers.get('etag'));
    must(
      `${path} carries no Last-Modified`,
      !response.headers.get('last-modified'),
      response.headers.get('last-modified')
    );
  }

  // The types, because a module served as text/plain is a module the browser
  // refuses to run — with a console message about MIME types that says nothing
  // about which file.
  const types = {
    '/': 'text/html',
    '/console.js': 'text/javascript',
    '/charts.js': 'text/javascript',
    '/console.css': 'text/css',
    '/mark.svg': 'image/svg+xml',
  };

  for (const [path, wanted] of Object.entries(types)) {
    const response = await fetch(`${service.base}${path}`);
    const got = response.headers.get('content-type') ?? '';

    must(`${path} is ${wanted}`, got.startsWith(wanted), got);
  }

  // A file that is not there is not the page. A static server that falls back
  // to index.html for everything answers 200 for a typo, and the console then
  // tries to run HTML as JavaScript.
  const missing = await fetch(`${service.base}/nothing-here.js`);
  must('a file that does not exist is a 404', missing.status === 404, String(missing.status));
  must(
    'and not the page in disguise',
    !(missing.headers.get('content-type') ?? '').startsWith('text/html'),
    missing.headers.get('content-type')
  );

  // Nothing above the folder, whatever the request says.
  for (const climb of ['/../package.json', '/..%2Fpackage.json', '/%2e%2e/package.json']) {
    const response = await fetch(`${service.base}${climb}`);
    const body = await response.text();

    must(`${climb} gets nothing`, !/"name":\s*"pacs-analytics/.test(body), `status ${response.status}`);
  }

  // An endpoint that does not exist says where the API starts, rather than
  // returning the page or an empty 500.
  const nowhere = await fetch(`${service.base}/api/nothing`);
  const said = await nowhere.json();
  must('an unknown endpoint says where the API starts', Boolean(said.it_starts_at), JSON.stringify(said));

  // And an installation nobody has says which there are, rather than falling
  // back to a default — a dashboard silently showing a different site than the
  // one asked for is the whole failure this project is about, in miniature.
  const wrong = await fetch(`${service.base}/api/dashboard?installation=nowhere`);
  const list = await wrong.json();
  must('an unknown installation is refused', wrong.status === 404, String(wrong.status));
  must('and it says which there are', Array.isArray(list.there_are), JSON.stringify(list).slice(0, 80));
} finally {
  await service.stop();
}

console.log('');

if (bad > 0) {
  console.log(`${bad} of ${checks} checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`All ${checks} checks passed.`);
}
