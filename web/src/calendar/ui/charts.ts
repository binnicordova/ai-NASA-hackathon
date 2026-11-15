import { compact, fmt, monthLabel, niceMax } from '../../shared/format';
import { monthNames, t, type Key } from '../../shared/i18n';
import { ACCENT, LEVEL_COLORS, NEUTRAL, NEUTRAL_LINE, VIIRS_ERA } from '../../shared/palette';
import { metricNoun, metricValue, type BurnCalendar, type Metric, type YearTotal } from '../domain/types';

// Todas las gráficas comparten el mismo lienzo: 324 de ancho, eje Y a la izquierda.
const X0 = 34;
const X1 = 318;

function yAxis(top: number, bottom: number, max: number, ticks: number[], label: (tick: number) => string): string {
  return ticks
    .map((tick) => {
      const y = bottom - (tick / max) * (bottom - top);
      return `<line class="grid" x1="${X0}" x2="${X1}" y1="${y}" y2="${y}"/><text x="${X0 - 4}" y="${y + 3}" text-anchor="end">${label(tick)}</text>`;
    })
    .join('');
}

const xy = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(1)}`;

/** Frecuencia histórica: en qué proporción de años cada mes alcanzó cada nivel. No es un pronóstico. */
export function renderFrequencyChart(
  svg: SVGElement,
  calendar: BurnCalendar,
  selectedMonth: number | null,
  onMonth: (month: number) => void,
): string {
  const top = 8;
  const bottom = 124;
  const band = (X1 - X0) / 12;
  let html = yAxis(top, bottom, 1, [0, 0.5, 1], (t) => `${Math.round(t * 100)}%`);
  for (const entry of calendar.levels.months) {
    const x = X0 + (entry.month - 1) * band + 4;
    let y = bottom;
    // El nivel más alto se apoya en la base: así su altura se lee directamente.
    for (const level of [3, 2, 1, 0]) {
      const count = entry.counts[level] ?? 0;
      const height = entry.years ? (count / entry.years) * (bottom - top) : 0;
      if (height > 0) {
        const gap = level < 3 ? 1 : 0;
        html += `<rect x="${x}" y="${(y - height + gap).toFixed(1)}" width="16" height="${Math.max(0, height - gap).toFixed(1)}" fill="${LEVEL_COLORS[level]}"><title>${t('freq.tip', { month: monthNames()[entry.month - 1]!, level: t(`level.${level}` as Key), k: count, n: entry.years, pct: Math.round((100 * count) / entry.years) })}</title></rect>`;
      }
      y -= height;
    }
    if (entry.month === selectedMonth) html += `<rect x="${x - 2}" y="${top - 2}" width="20" height="${bottom - top + 4}" fill="none" stroke="${ACCENT}" stroke-width="1.5" rx="3"/>`;
    html += `<text x="${x + 8}" y="138" text-anchor="middle">${monthNames()[entry.month - 1]![0]!.toUpperCase()}</text>`;
    html += `<rect class="hit" x="${x - 4}" y="${top}" width="${band}" height="${bottom - top + 16}" data-month="${entry.month}"><title>${monthNames()[entry.month - 1]}</title></rect>`;
  }
  svg.innerHTML = html;
  svg.querySelectorAll<SVGRectElement>('.hit').forEach((hit) => hit.addEventListener('click', () => onMonth(Number(hit.dataset.month))));

  const entry = calendar.levels.months.find((m) => m.month === selectedMonth);
  if (!entry || !entry.years) return t('freq.none');
  const high = (entry.counts[2] ?? 0) + (entry.counts[3] ?? 0);
  return t('freq.text', { month: monthNames()[entry.month - 1]!, k: high, n: entry.years, pct: Math.round((100 * high) / entry.years) });
}

/** Totales por año. Con la medida armonizada los años son comparables; con las otras, no. */
export function renderYearsChart(
  svg: SVGElement,
  calendar: BurnCalendar,
  metric: Metric,
  inspectedYear: number | null,
  onYear: (year: number) => void,
): string {
  const top = 10;
  const bottom = 128;
  const years = calendar.years;
  const band = (X1 - X0) / years.length;
  const value = (y: YearTotal): number => metricValue(y, metric);
  const max = niceMax(Math.max(...years.map((y) => (metric === 'harmonized' ? Math.max(y.harmonized, y.high) : value(y)))));
  const Y = (v: number): number => bottom - (v / max) * (bottom - top);
  const [fromYear, toYear] = [Number(calendar.range.from.slice(0, 4)), Number(calendar.range.to.slice(0, 4))];
  const records = metric === 'harmonized' ? years.filter((y) => y.rank !== null && y.rank <= 3).map((y) => y.year) : [];
  const complete = years.filter((y) => !y.partial && y.year >= calendar.referenceYears[0]).map(value).sort((a, b) => a - b);
  const median = complete.length ? complete[Math.floor((complete.length - 1) / 2)]! : 0;

  let html = yAxis(top, bottom, max, [0, max / 2, max], compact);
  const modisLine: string[] = [];
  years.forEach((year, index) => {
    const x = X0 + index * band + 1.5;
    const width = band - 3;
    const y = Y(value(year));
    const faded = year.year < fromYear || year.year > toYear ? ' opacity="0.3"' : '';
    const fill = year.partial ? `fill="none" stroke="${NEUTRAL_LINE}" stroke-dasharray="2 2"` : `fill="${records.includes(year.year) ? VIIRS_ERA : NEUTRAL}"`;
    html += `<rect${faded} x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${(bottom - y).toFixed(1)}" rx="2" ${fill}/>`;
    if (metric === 'harmonized' && year.year < 2012) html += `<line x1="${(x + width / 2).toFixed(1)}" x2="${(x + width / 2).toFixed(1)}" y1="${Y(year.high).toFixed(1)}" y2="${Y(year.low).toFixed(1)}" stroke="var(--tx2)" stroke-width="1"/>`;
    if (metric === 'events' && year.eventsModis !== null) modisLine.push(xy(x + width / 2, Y(year.eventsModis)));
    if (year.year === inspectedYear) html += `<rect x="${(x - 1.5).toFixed(1)}" y="${top - 2}" width="${(width + 3).toFixed(1)}" height="${bottom - top + 4}" fill="none" stroke="${ACCENT}" stroke-width="1.5" rx="3"/>`;
    if (year.year % 5 === 0) html += `<text x="${(x + width / 2).toFixed(1)}" y="142" text-anchor="middle">${year.year}</text>`;
    const extra =
      (year.partial ? t('years.partial') : '') +
      (metric === 'events' && year.eventsModis !== null ? t('years.modisOnly', { v: fmt(year.eventsModis) }) : '') +
      (metric === 'harmonized' && year.year < 2012 ? t('years.band', { a: fmt(year.low), b: fmt(year.high) }) : '');
    html += `<rect class="hit" x="${(X0 + index * band).toFixed(1)}" y="${top}" width="${band.toFixed(1)}" height="${bottom - top}" data-year="${year.year}"><title>${year.year}: ${fmt(value(year))} ${metricNoun(metric)}${extra}</title></rect>`;
  });
  if (metric === 'harmonized') html += `<line x1="${X0}" x2="${X1}" y1="${Y(median)}" y2="${Y(median)}" stroke="${NEUTRAL_LINE}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  if (metric === 'events' && modisLine.length) html += `<polyline fill="none" stroke="#633806" stroke-width="2" points="${modisLine.join(' ')}"/>`;
  svg.innerHTML = html;
  svg.querySelectorAll<SVGRectElement>('.hit').forEach((hit) => hit.addEventListener('click', () => onYear(Number(hit.dataset.year))));

  const inRange = t('years.range', { v: fmt(metricValue(calendar.rangeSummary, metric)), noun: metricNoun(metric) });
  if (metric === 'harmonized') return inRange + t('years.h', { years: records.join(', ') || '—', m: compact(median) });
  return inRange + t(metric === 'hotspots' ? 'years.r' : 'years.e');
}

/** El año inspeccionado, mes a mes, sobre el rango habitual (percentiles 10 a 90) y la mediana. */
export function renderYearDetail(svg: SVGElement, calendar: BurnCalendar, year: number): string {
  const top = 10;
  const bottom = 124;
  const rows = calendar.series.filter((p) => p.year === year);
  const medians = calendar.medians;
  const max = niceMax(Math.max(...medians.map((m) => m.p90), ...rows.map((r) => r.harmonized)));
  const px = (month: number): number => X0 + 10 + ((month - 1) * (X1 - X0 - 20)) / 11;
  const Y = (v: number): number => bottom - (v / max) * (bottom - top);
  const last = calendar.series.at(-1)!;

  let html = yAxis(top, bottom, max, [0, max / 2, max], compact);
  html += `<polygon fill="${NEUTRAL}" opacity="0.45" points="${medians.map((m) => xy(px(m.month), Y(m.p90))).join(' ')} ${[...medians].reverse().map((m) => xy(px(m.month), Y(m.p10))).join(' ')}"/>`;
  html += `<polyline fill="none" stroke="${NEUTRAL_LINE}" stroke-width="1.5" stroke-dasharray="4 3" points="${medians.map((m) => xy(px(m.month), Y(m.median))).join(' ')}"/>`;
  html += `<polyline fill="none" stroke="${VIIRS_ERA}" stroke-width="2" stroke-linejoin="round" points="${rows.map((r) => xy(px(r.month), Y(r.harmonized))).join(' ')}"/>`;
  for (const row of rows) {
    const toDate = row.year === last.year && row.month === last.month;
    html += `<circle cx="${px(row.month).toFixed(1)}" cy="${Y(row.harmonized).toFixed(1)}" r="3.5" fill="${toDate ? 'var(--s2)' : VIIRS_ERA}" stroke="${toDate ? VIIRS_ERA : 'var(--s2)'}" stroke-width="1.5"><title>${monthLabel(row.year, row.month)}: ${fmt(row.harmonized)}${toDate ? t('tip.toDate') : ''} · ${t('tip.median')} ${fmt(medians[row.month - 1]!.median)} · ${t('detail.counts', { h: fmt(row.hotspots) })}</title></circle>`;
  }
  for (let month = 1; month <= 12; month += 1) html += `<text x="${px(month).toFixed(1)}" y="138" text-anchor="middle">${monthNames()[month - 1]![0]!.toUpperCase()}</text>`;
  svg.innerHTML = html;

  const total = calendar.years.find((y) => y.year === year);
  if (!total || !rows.length) return '';
  const peak = [...rows].sort((a, b) => b.harmonized - a.harmonized)[0]!;
  const above = rows.filter((r) => !(r.year === last.year && r.month === last.month) && r.harmonized > medians[r.month - 1]!.p90).map((r) => monthNames()[r.month - 1]);
  const completeYears = calendar.years.filter((y) => y.rank !== null).length;
  return (
    t('detail.counts', { h: fmt(total.hotspots) }) +
    (total.events !== null ? t('detail.events', { e: fmt(total.events) }) : '') +
    t('detail.peak', { year, month: monthNames()[peak.month - 1]! }) +
    (total.partial ? t('detail.partial') : t('detail.rank', { r: total.rank ?? 0, n: completeYears })) +
    (above.length ? t('detail.above', { months: above.join(', ') }) : t('detail.noAbove')) +
    (year < calendar.referenceYears[0] ? t('detail.lowConf') : '')
  );
}

/** Antes y después: los focos crudos suben con cada satélite nuevo; la serie armonizada no. */
export function renderBeforeAfter(svg: SVGElement, calendar: BurnCalendar): void {
  const years = calendar.years;
  const band = (X1 - X0) / years.length;
  const first = years[0]!.year;
  const panel = (top: number, bottom: number, values: number[], color: string, label: string): string => {
    const max = niceMax(Math.max(...values));
    let html = `<text x="${X0}" y="${top - 3}">${label}</text>` + yAxis(top, bottom, max, [0, max], compact);
    values.forEach((value, index) => {
      const y = bottom - (value / max) * (bottom - top);
      html += `<rect x="${(X0 + index * band + 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="${(band - 3).toFixed(1)}" height="${(bottom - y).toFixed(1)}" rx="2" fill="${color}"><title>${years[index]!.year}: ${fmt(value)}</title></rect>`;
    });
    return html;
  };
  let html = panel(24, 84, years.map((y) => y.hotspots), NEUTRAL, t('ba.raw')) + panel(108, 168, years.map((y) => y.harmonized), VIIRS_ERA, t('ba.h'));
  for (const [year, label] of [[2012, t('ba.viirs')], [2018, '+ NOAA-20'], [2023, '+ NOAA-21']] as const) {
    const x = X0 + (year - first) * band;
    // La última etiqueta va a la izquierda de su línea y una fila más abajo para no pisar a la anterior.
    const last = year === 2023;
    html += `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="14" y2="168" stroke="${ACCENT}" stroke-width="1" stroke-dasharray="2 3"/><text x="${(x + (last ? -3 : 2)).toFixed(1)}" y="${last ? 23 : 12}"${last ? ' text-anchor="end"' : ''} style="fill:${ACCENT}">${label}</text>`;
  }
  for (let year = Math.ceil(first / 5) * 5; year <= years.at(-1)!.year; year += 5) html += `<text x="${(X0 + (year - first + 0.5) * band).toFixed(1)}" y="182" text-anchor="middle">${year}</text>`;
  svg.innerHTML = html;
}
