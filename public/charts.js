/**
 * Four charts, in SVG, by hand.
 *
 * No charting library, and that is a decision rather than a shortage. A chart
 * library is a hundred and eighty kilobytes and an API to learn, in exchange
 * for four shapes that are twenty lines each — and it would be the only
 * dependency in a project whose argument is partly about how little it needs to
 * sit next to somebody's archive.
 *
 * ── What they all share ──────────────────────────────────────────────────────
 *
 * **A viewBox and no fixed size.** The SVG scales with its box; nothing here
 * measures the window or listens for a resize, which is where chart code
 * usually goes wrong.
 *
 * **Nothing is drawn for a value nobody has.** A missing number is not zero. A
 * zero-height bar and an absent bar look identical and mean opposite things, so
 * where there is nothing to draw these say so in words instead.
 */

/** Escape, because a device name is somebody else's data. */
function safe(text) {
  return String(text ?? '').replace(/[<>&"]/g, (one) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[one]);
}

/**
 * One colour per modality, and the same one everywhere on the page.
 *
 * A chart that assigns colours by position gives CT a different colour on two
 * charts on the same screen, and the reader — reasonably — believes the colour
 * means something.
 */
export const COLOURS = {
  CT: '#3b6ea5',
  MR: '#5a4b9c',
  CR: '#2f8a72',
  DX: '#4c9c5a',
  US: '#b0782a',
  MG: '#a4517a',
  NM: '#7a6a3a',
  PT: '#8a4a3a',
};

export function colourFor(name, n = 0) {
  return COLOURS[name] ?? ['#5b6b7c', '#6b5b7c', '#7c6b5b', '#5b7c6b'][n % 4];
}

/**
 * A donut.
 *
 * The arc maths is the only part worth reading: a slice is drawn as a single
 * `A` command, and `largeArcFlag` has to be set when the slice is more than
 * half the circle or the path takes the short way round and draws the
 * complement. That is the classic pie-chart bug — one slice inside out —
 * and it only appears when one category passes fifty per cent, which is to say
 * on somebody's data and never on the sample.
 */
export function donut(items, { size = 220, thickness = 34 } = {}) {
  const total = items.reduce((sum, one) => sum + one.value, 0);
  if (!total) return `<p class="nothing">Nothing to draw.</p>`;

  const middle = size / 2;
  const radius = middle - thickness / 2 - 2;

  let angle = -Math.PI / 2;
  const slices = [];

  items.forEach((one, n) => {
    const share = one.value / total;
    const sweep = share * Math.PI * 2;
    const to = angle + sweep;

    const at = (a) => `${(middle + radius * Math.cos(a)).toFixed(2)} ${(middle + radius * Math.sin(a)).toFixed(2)}`;

    // A full circle cannot be drawn as one arc: the start and end points
    // coincide and the path draws nothing at all.
    if (share > 0.999) {
      slices.push(
        `<circle cx="${middle}" cy="${middle}" r="${radius}" fill="none" stroke="${colourFor(one.name, n)}" stroke-width="${thickness}"><title>${safe(one.name)}: ${one.value}</title></circle>`
      );
    } else {
      slices.push(
        `<path d="M ${at(angle)} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(to)}"
               fill="none" stroke="${colourFor(one.name, n)}" stroke-width="${thickness}" stroke-linecap="butt">
           <title>${safe(one.name)}: ${one.value} (${(share * 100).toFixed(1)}%)</title>
         </path>`
      );
    }

    angle = to;
  });

  return `
    <div class="donut-row">
      <svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="a donut chart">
        ${slices.join('')}
        <text x="${middle}" y="${middle - 2}" class="donut-total">${total.toLocaleString('en-GB')}</text>
        <text x="${middle}" y="${middle + 16}" class="donut-label">studies</text>
      </svg>

      <ul class="key">
        ${items
          .map(
            (one, n) => `<li>
              <span class="swatch" style="background:${colourFor(one.name, n)}"></span>
              <span class="name">${safe(one.name)}</span>
              <span class="value">${one.value.toLocaleString('en-GB')}</span>
              <span class="share">${((one.value / total) * 100).toFixed(1)}%</span>
            </li>`
          )
          .join('')}
      </ul>
    </div>`;
}

/** Horizontal bars, for a list of named things with one number each. */
export function bars(items, { unit = '' } = {}) {
  if (!items.length) return `<p class="nothing">Nothing to draw.</p>`;

  const most = Math.max(...items.map((one) => one.value));

  return `<ul class="bars">
    ${items
      .map(
        (one, n) => `<li>
          <span class="bar-name">${safe(one.name)}</span>
          <span class="bar-track">
            <span class="bar-fill" style="width:${most ? (one.value / most) * 100 : 0}%;background:${colourFor(one.colour ?? one.name, n)}"></span>
          </span>
          <span class="bar-value">${one.value.toLocaleString('en-GB')}${unit}</span>
        </li>`
      )
      .join('')}
  </ul>`;
}

/**
 * Columns over time, with an optional dashed continuation.
 *
 * The forecast is drawn dashed and in a different weight, because a
 * continuation drawn like the data is a continuation somebody will read off as
 * data. Anything that is not measured has to look like it.
 */
/**
 * @param each      how wide one column is. Sixty months at fifty pixels is a
 *                  chart three thousand pixels wide; at fourteen it is one
 *                  somebody can see all of.
 * @param labelEvery label every Nth column. Sixty labels under sixty columns
 *                  are sixty labels nobody can read, and the ones that matter
 *                  are the years.
 */
export function columns(items, { forecast = [], unit = '', height = 180, each: eachWide = 54, labelEvery = 1 } = {}) {
  if (!items.length) return `<p class="nothing">Nothing to draw.</p>`;

  const all = [...items, ...forecast];
  const most = Math.max(...all.map((one) => one.value), 1);
  const gap = Math.max(2, Math.round(eachWide / 7));
  const width = Math.max(320, all.length * (eachWide + gap));
  const each = (width - gap * (all.length - 1)) / all.length;

  const bar = (one, n, dashed) => {
    const tall = (one.value / most) * (height - 34);
    const x = n * (each + gap);
    const y = height - 22 - tall;

    const labelled = n % labelEvery === 0;

    return `<g>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${each.toFixed(1)}" height="${Math.max(1, tall).toFixed(1)}"
            rx="2" class="${dashed ? 'column ahead' : 'column'}">
        <title>${safe(one.name)}: ${one.value.toLocaleString('en-GB')}${unit}${dashed ? ' (a line, not a measurement)' : ''}</title>
      </rect>
      ${labelled ? `<text x="${(x + each / 2).toFixed(1)}" y="${height - 8}" class="column-label">${safe(one.name)}</text>` : ''}
      ${labelled && eachWide > 24 ? `<text x="${(x + each / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" class="column-value">${short(one.value)}</text>` : ''}
    </g>`;
  };

  return `<svg viewBox="0 0 ${width} ${height}" class="columns" role="img" aria-label="columns over time">
    ${items.map((one, n) => bar(one, n, false)).join('')}
    ${forecast.map((one, n) => bar(one, items.length + n, true)).join('')}
  </svg>`;
}

/**
 * The weekday-by-hour grid.
 *
 * A grid rather than a chart: seven rows of twenty-four cells, shaded by count.
 * Every cell is drawn even when it is empty — a heatmap with holes in it is a
 * heatmap where "nothing happened" and "nothing was recorded" look the same.
 */
export function grid(rows, days) {
  const most = Math.max(1, ...rows.flat());

  return `<div class="heat">
    <div class="heat-hours">${Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('')}</div>
    ${rows
      .map(
        (row, d) => `<div class="heat-row">
          <span class="heat-day">${safe(days[d]).slice(0, 3)}</span>
          ${row
            .map(
              (n, h) =>
                `<span class="heat-cell" style="--weight:${(n / most).toFixed(3)}" title="${safe(days[d])} ${String(h).padStart(2, '0')}:00 — ${n} ${n === 1 ? 'study' : 'studies'}"></span>`
            )
            .join('')}
        </div>`
      )
      .join('')}
  </div>`;
}

/** 1234567 → "1.2M". Axis labels are read at a glance or not at all. */
function short(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${Math.round(value / 1e3)}k`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

export { safe, short };
