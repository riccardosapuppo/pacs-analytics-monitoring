/**
 * The console, in plain JavaScript.
 *
 * No framework, no build step. This page exists so somebody can change the
 * installation and watch what happens; a toolchain between them and that is a
 * toolchain for nothing.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 *
 * One control matters, and it is the select at the top. The six installations
 * hold the same studies and disagree only about how to write them down, so:
 *
 *   the numbers here do NOT move when you change it
 *   the numbers under "with the SQL written straight" DO
 *
 * Everything else on the page is in service of noticing that.
 */

import { bars, colourFor, columns, donut, grid, safe, short } from './charts.js';

const $ = (id) => document.getElementById(id);

let installation = null;

// ────────────────────────────────────────────────────────────── the shell

async function readInstallations() {
  const health = await (await fetch('/api/health')).json();

  $('installation').innerHTML = health.installations
    .map((one) => `<option value="${safe(one)}">${safe(one)}</option>`)
    .join('');

  installation = health.installations[0];
}

/**
 * Redraw everything, and only then say what is on the screen.
 *
 * The `data-showing` attribute is set after all three fetches have finished,
 * not after the first. Setting it inside the schema fetch made it true while
 * the dashboard was still the previous installation, and a check waiting on it
 * read a page that had not finished redrawing — and asserted against the
 * installation before.
 *
 * The rule is the one that keeps coming up: wait for the work, not for the
 * signal that happens to arrive first.
 */
async function showEverything() {
  $('differs-says').dataset.showing = '';
  await Promise.all([showSchema(), showDashboard(), showStudies()]);
  $('differs-says').dataset.showing = installation;
}

$('installation').addEventListener('change', () => {
  installation = $('installation').value;
  void showEverything();
});

const where = (what, extra = {}) => {
  const at = new URLSearchParams({ installation, ...extra });
  return `${what}?${at}`;
};

// ─────────────────────────────────────────────── what it found in the schema

async function showSchema() {
  const said = await (await fetch(where('/api/schema'))).json();

  $('differs').dataset.plain = said.differs.startsWith('nothing') ? 'yes' : 'no';
  $('differs-says').innerHTML = `<strong>${safe(said.differs)}.</strong> ${safe(said.why)}`;


  $('notes').innerHTML = said.notes.map((one) => `<li>${safe(one)}</li>`).join('');

  const second = said.resolved.filter((one) => one.position > 0).length;
  const missing = said.resolved.filter((one) => one.resolved === null).length;

  $('found-say').textContent =
    [
      `${said.resolved.filter((one) => one.resolved).length} of ${said.resolved.length} found`,
      second ? `${second} on a later candidate` : null,
      missing ? `${missing} absent` : null,
    ]
      .filter(Boolean)
      .join(' · ');

  $('resolved').innerHTML = said.resolved
    .map(
      (one) => `<tr data-state="${one.resolved ? (one.position > 0 ? 'later' : 'first') : 'missing'}">
        <td class="field">${safe(one.field)}</td>
        <td class="is">${one.resolved ? `<code>${safe(one.resolved)}</code>` : '<span class="absent">not here</span>'}</td>
        <td class="candidates">${one.candidates
          .map((c, n) => `<code class="${n === one.position ? 'won' : ''}">${safe(c)}</code>`)
          .join(' ')}</td>
      </tr>`
    )
    .join('');
}

// ────────────────────────────────────────────────────────────── the numbers

async function showDashboard() {
  const said = await (await fetch(where('/api/dashboard'))).json();

  // The headline four. `undatable` is not one of them: it is a caveat on all
  // of them, so it goes underneath in a sentence rather than beside them as a
  // number somebody might read as a fifth measurement.
  $('kpis').innerHTML = [
    ['studies', said.summary.studies.toLocaleString('en-GB')],
    ['storage', `${(said.summary.storageKB / 1024 / 1024).toFixed(1)} GB`],
    ['patients', said.summary.patients.toLocaleString('en-GB')],
    ['images', short(said.summary.instances)],
  ]
    .map(([what, value]) => `<div><dt>${what}</dt><dd>${value}</dd></div>`)
    .join('');

  if (said.summary.undatable > 0) {
    $('undatable').hidden = false;
    $('undatable').innerHTML =
      `<strong>${said.summary.undatable} of the ${said.summary.inTheArchive.toLocaleString('en-GB')} rows here cannot be dated</strong>` +
      ` — <code>StudyDate</code> holds whatever the sending modality put in it, and these are not eight digits.` +
      ` They are in the archive and in none of the charts below, which is why the count says so rather than` +
      ` letting a total and a chart disagree by four.`;
  } else {
    $('undatable').hidden = true;
  }

  drawStraight(said.straight, said);

  // ── modalities ───────────────────────────────────────────────────────────
  if (!said.modalities.available) {
    $('modalities').innerHTML = unavailable(said.modalities.why);
  } else {
    $('modalities').innerHTML =
      donut(said.modalities.rows.map((one) => ({ name: one.modality, value: one.studies }))) +
      `<p class="hint small">Read from <strong>${safe(said.modalities.from === 'series' ? 'Series, through a correlated subquery' : 'a column on Study')}</strong>.` +
      (said.modalities.overlapping
        ? ` ${said.modalities.overlapping} studies carry more than one modality and are counted under each, so this column adds to more than the archive holds.`
        : '') +
      `</p>`;
  }

  // ── devices ──────────────────────────────────────────────────────────────
  if (!said.devices.available) {
    $('devices').innerHTML = unavailable(said.devices.why, said.devices.looked);
  } else {
    $('devices').innerHTML = bars(said.devices.rows.map((one) => ({ name: one.device, value: one.studies })));
  }

  // ── storage ──────────────────────────────────────────────────────────────
  const room = said.storage;

  $('storage').innerHTML =
    columns(
      room.years.map((one) => ({ name: String(one.year), value: Math.round(one.gb) })),
      { forecast: room.forecast.possible ? room.forecast.years.map((one) => ({ name: String(one.year), value: Math.round(one.gb) })) : [], unit: ' GB' }
    ) +
    `<p class="hint small">` +
    (room.forecast.possible
      ? `The dashed columns are <strong>a straight line through the ${room.forecast.from} complete years</strong>, and nothing more — about ` +
        `${room.forecast.perYearGB.toFixed(0)} GB a year. It knows nothing about the scanner arriving in March. ` +
        (room.runsOut.known
          ? `At that rate the ${room.runsOut.capacityGB} GB volume, ${room.runsOut.percentUsed.toFixed(0)}% used, lasts about ${room.runsOut.yearsLeft.toFixed(0)} more years.`
          : `Set <code>PACS_CAPACITY_GB</code> and it will also say when the volume runs out; without it there is no number to give.`)
      : safe(room.forecast.why)) +
    `</p>`;

  // ── the months ───────────────────────────────────────────────────────────
  // Narrow, and labelled once a year. Sixty months at full width is a chart
  // three thousand pixels across, and sixty labels under it are sixty labels
  // nobody reads.
  $('trend').innerHTML =
    columns(
      said.trend.rows.map((one) => ({ name: one.label.slice(0, 4), value: one.studies })),
      { each: 13, labelEvery: 12, height: 150 }
    ) +
    `<p class="hint small">${said.trend.rows.length} months, one column each, labelled once a year.</p>`;

  // ── the heatmap ──────────────────────────────────────────────────────────
  if (!said.heatmap.available) {
    $('heatmap').innerHTML = unavailable(said.heatmap.why);
  } else {
    $('heatmap').innerHTML =
      grid(said.heatmap.grid, said.heatmap.days) +
      `<p class="hint small">Busiest: <strong>${safe(said.heatmap.busiest.day)} at ${String(said.heatmap.busiest.hour).padStart(2, '0')}:00</strong>` +
      ` (${said.heatmap.busiest.studies} studies). Weekday and hour are both worked out in the database from two string columns —` +
      ` and Monday is zero in three different ways across the three dialects.</p>`;
  }
}

/**
 * A view that cannot be answered here, drawn as a fact rather than an error.
 *
 * A chart of nothing labelled as data is worse than no chart: a reader takes an
 * empty panel to mean the archive has none of that, when it means the column
 * was never created.
 */
function unavailable(why, looked) {
  return `<p class="unavailable">
    <strong>Not answerable on this installation.</strong> ${safe(why)}.
    ${looked ? `Looked for: ${looked.map((one) => `<code>${safe(one)}</code>`).join(', ')}.` : ''}
  </p>`;
}

/**
 * The straight side, beside the answers.
 *
 * What is shown is not only the number but **how it went** — right, patched,
 * or wrong — because two numbers side by side is two numbers somebody has to
 * compare, and the interesting cases differ by amounts nobody notices.
 */
function drawStraight(straight, said) {
  const mine = {
    'how many studies': said.summary.studies,
    'how much storage, in GB': said.summary.storageKB / 1024 / 1024,
    'how many patients': said.summary.patients,
  };

  // The breakdowns are compared as breakdowns. Reporting only that a chart
  // has "8 categories" would have said nothing at all about the installation
  // where a join multiplied every count by the number of series -- which is
  // the cell this whole panel exists for.
  const breakdowns = {
    'studies per modality': said.modalities.available
      ? Object.fromEntries(said.modalities.rows.map((one) => [one.modality, one.studies]))
      : null,
    'studies per device': said.devices.available
      ? Object.fromEntries(said.devices.rows.map((one) => [one.device, one.studies]))
      : null,
  };

  const rows = [];

  for (const [question, answer] of Object.entries(straight)) {
    if (answer.error) {
      rows.push({ question, said: 'could not answer', trouble: answer.error, how: 'unanswerable' });
      continue;
    }

    if (answer.value !== null && typeof answer.value === 'object') {
      rows.push(compareBreakdown(question, answer, breakdowns[question]));
      continue;
    }

    const wanted = mine[question];
    const value = Number(answer.value);
    const differs = wanted !== undefined && Math.abs(value - wanted) > Math.max(1e-6, Math.abs(wanted) * 1e-9);

    rows.push({
      question,
      said: Number.isInteger(value) ? value.toLocaleString('en-GB') : value.toFixed(1),
      trouble: differs
        ? `here it says ${Number.isInteger(wanted) ? wanted.toLocaleString('en-GB') : wanted.toFixed(1)}`
        : null,
      how: answer.how,
    });
  }
  $('straight-list').innerHTML = rows
    .map(
      (one) => `<li data-how="${one.trouble ? 'wrong' : one.how}">
        <span class="q">${safe(one.question)}</span>
        <span class="a">${safe(one.said)}</span>
        <span class="note">${one.trouble ? safe(one.trouble) : one.how === 'patched' ? 'errored, then patched' : 'agrees'}</span>
      </li>`
    )
    .join('');
}

/**
 * Two breakdowns, compared as breakdowns.
 *
 * What is reported is the worst single category rather than a total, because
 * a total can be right while every category in it is wrong -- and because
 * "CT: 1,379 against 512" is a sentence somebody understands immediately,
 * where "the breakdown differs" is not.
 */
function compareBreakdown(question, answer, wanted) {
  const got = answer.value ?? {};
  const keys = Object.keys(got);
  const invented = keys.filter((one) => /\\/.test(one));

  if (!wanted) {
    // Nothing to compare against: this installation cannot answer it at all,
    // and the straight version answering anyway is itself the finding.
    return {
      question,
      said: `${keys.length} categories`,
      trouble: 'here that cannot be answered at all',
      how: 'wrong',
    };
  }

  if (invented.length) {
    return {
      question,
      said: `${keys.length} categories`,
      trouble: `including ${invented.join(', ')}, which is neither of them`,
      how: 'wrong',
    };
  }

  let worst = null;

  for (const key of new Set([...Object.keys(wanted), ...keys])) {
    const a = wanted[key] ?? 0;
    const b = got[key] ?? 0;
    if (a === b) continue;

    const by = Math.abs(b - a);
    if (!worst || by > worst.by) worst = { key, wanted: a, got: b, by };
  }

  if (!worst) {
    return { question, said: `${keys.length} categories`, trouble: null, how: answer.how };
  }

  const times = worst.wanted ? (worst.got / worst.wanted).toFixed(1) : null;

  return {
    question,
    said: `${worst.key}: ${worst.got.toLocaleString('en-GB')}`,
    trouble:
      `here it is ${worst.wanted.toLocaleString('en-GB')}` +
      (times && times !== '1.0' ? ` — ${times}× too many` : ''),
    how: 'wrong',
  };
}

// ────────────────────────────────────────────────────────────── the studies

async function showStudies() {
  const extra = {};
  if ($('f-modality').value.trim()) extra.modality = $('f-modality').value.trim();
  if ($('f-description').value.trim()) extra.description = $('f-description').value.trim();

  const said = await (await fetch(where('/api/studies', { ...extra, pageSize: '25' }))).json();

  $('found-count').textContent = `${said.total.toLocaleString('en-GB')} studies match, showing ${said.rows.length}`;
  $('csv').href = where('/api/studies.csv', extra);

  $('studies').innerHTML = said.rows.length
    ? said.rows
        .map(
          (one) => `<tr>
            <td class="mono">${safe(one.date ?? '—')}${one.time ? ` <span class="faint">${safe(one.time)}</span>` : ''}</td>
            <td><span class="chip" style="--chip:${colourFor(one.modality ?? '')}">${safe(one.modality ?? '—')}</span></td>
            <td>${safe(one.description ?? '—')}</td>
            <td class="mono faint">${safe(one.device ?? '—')}</td>
            <td class="right">${one.series ?? '—'}</td>
            <td class="right">${one.instances === null ? '—' : short(one.instances)}</td>
            <td class="right">${one.sizeKB === null ? '—' : `${(one.sizeKB / 1024).toFixed(0)} MB`}</td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="nothing">Nothing matches that.</td></tr>`;
}

$('find').addEventListener('submit', (event) => {
  event.preventDefault();
  void showStudies();
});

// ────────────────────────────────────────────────────────────── on arrival

await readInstallations();
await showEverything();
