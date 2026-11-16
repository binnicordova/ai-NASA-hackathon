import { areaLabel, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { byId, el } from '../../shared/dom';
import { addDays, compact, dayLabel, dayNumber, daysBetween, fmt, monthLabel, rangeLabel } from '../../shared/format';
import { monthNames, t, type Key } from '../../shared/i18n';
import { LEVEL_COLORS, MODIS_ERA, RAMP, VIIRS_ERA } from '../../shared/palette';
import { type Anomaly, type BurnCalendar, type DailySeries, type DayRange, type EventSummary, type Meta, type PointSummary, type RankingRow } from '../domain/types';

const setText = (id: string, text: string): void => {
  byId(id).textContent = text;
};

function showNote(id: string, text: string | null): void {
  const note = byId(id);
  note.hidden = !text;
  note.textContent = text ?? '';
}

/** Sumas de la serie diaria entre dos días, ambos incluidos. */
function sumDays(values: number[] | null, start: string, range: DayRange): number | null {
  if (!values) return null;
  const a = Math.max(0, dayNumber(range.from) - dayNumber(start));
  const b = Math.min(values.length - 1, dayNumber(range.to) - dayNumber(start));
  let sum = 0;
  for (let i = a; i <= b; i += 1) sum += values[i]!;
  return sum;
}

/** Área y rango, una sola vez arriba del panel: todas las tarjetas se refieren a esto. */
export function renderScope(range: DayRange, area: AreaOfInterest): void {
  setText('scopeArea', areaLabel(area));
  setText('scopeRange', t('range.label', { range: rangeLabel(range.from, range.to), n: fmt(daysBetween(range.from, range.to)) }));
}

/**
 * Tarjeta "en el rango elegido" de la pestaña armonizada, con precisión de días: actividad armonizada, hexágonos con
 * actividad y días con actividad. Los focos y eventos crudos viven en su propia tarjeta, no se repiten aquí.
 */
export function renderRangeCard(calendar: BurnCalendar, daily: DailySeries, range: DayRange, hexagons: number | null, visible: boolean): void {
  byId('rangeCard').hidden = !visible;
  if (!visible) return;
  setText('rangeHarmonized', fmt(sumDays(daily.harmonized, daily.start, range)!));
  setText('rangeHexagons', hexagons === null ? '…' : fmt(hexagons));
  const offset = dayNumber(range.from) - dayNumber(daily.start);
  let active = 0;
  for (let i = 0; i < daysBetween(range.from, range.to); i += 1) if ((daily.harmonized[offset + i] ?? 0) > 0) active += 1;
  setText('rangeDays', `${fmt(active)} / ${fmt(daysBetween(range.from, range.to))}`);
  const peak = calendar.peakSeason;
  setText(
    'peakSeason',
    peak.months.length
      ? t('peak', { months: peak.months.map((m) => monthNames()[m - 1]).join(', '), pct: Math.round(peak.share * 100) })
      : t('peak.none'),
  );
}

/**
 * El mes en curso frente a su mediana histórica: una lectura en palabras, el valor, la razón y el percentil.
 * Siempre en actividad armonizada, la única medida comparable entre años.
 */
export function renderMonthCard(calendar: BurnCalendar, anomaly: Anomaly | null): void {
  const fresh = anomaly;
  const toDate = fresh?.monthToDateDays ?? null;
  const last = calendar.series.at(-1)!;
  const year = fresh?.year ?? last.year;
  const month = fresh?.month ?? last.month;
  setText('monthLabel', monthLabel(year, month) + (toDate ? t('month.toDate', { d: toDate }) : ''));
  setText('monthValueLabel', t('kpi.activity'));
  setText('monthValue', fmt(fresh?.value ?? last.harmonized));

  const verdict = byId('verdict');
  verdict.hidden = true;
  if (!fresh) {
    setText('monthRatio', '…');
    setText('monthPercentile', '…');
    showNote('monthNote', null);
    return;
  }
  setText('monthRatio', fresh.ratio === null ? '—' : `${fresh.ratio.toFixed(1)}×`);
  // Sin una mediana válida el percentil no dice nada: se muestra vacío igual que la razón.
  setText('monthPercentile', !fresh.valid || fresh.percentile === null ? '—' : `p${fresh.percentile}`);
  if (fresh.valid && fresh.category) {
    // La lectura se da con texto y un signo, nunca solo con color.
    const sign = { below: '↓', normal: '≈', above: '↑', well_above: '⇈' }[fresh.category];
    verdict.hidden = false;
    verdict.dataset.category = fresh.category;
    verdict.textContent = `${sign} ${t(`verdict.${fresh.category}` as Key, { month: monthNames()[month - 1]! })}`;
  }
  const [refFrom, refTo] = calendar.referenceYears;
  showNote(
    'monthNote',
    !fresh.valid ? t('note.invalid') : toDate ? t('note.toDate', { d: toDate, a: refFrom, b: refTo }) : fresh.lowConfidence ? t('note.lowConf') : null,
  );
}

export function renderLevelLegend(calendar: BurnCalendar): void {
  const [low, , veryHigh] = calendar.levels.thresholds;
  byId('levelLegend').replaceChildren(
    ...LEVEL_COLORS.map((color, index) =>
      el('span', { className: 'row' },
        el('span', { style: `width:10px;height:10px;border-radius:2px;background:${color}${index === 0 ? ';border:1px solid var(--bd)' : ''}` }),
        t(`level.${index}` as Key) + (index === 0 ? t('level.under', { v: compact(low ?? 0) }) : index === 3 ? t('level.over', { v: compact(veryHigh ?? 0) }) : ''),
      ),
    ),
  );
}

export type RankingKey = 'hexagons' | 'hotspots' | 'events';

/**
 * Departamentos en el rango: hexágonos (celdas de ~36 km² con focos), focos y eventos de fuego. Se ordena por la
 * columna elegida; sin elegir, por hexágonos. Los ocho primeros, o todos.
 */
export function renderRanking(
  rows: RankingRow[], sortKey: RankingKey, showAll: boolean, area: AreaOfInterest, onPick: (department: string) => void,
): void {
  const value = (r: RankingRow): number => (sortKey === 'events' ? (r.events ?? 0) : r[sortKey]);
  const sorted = [...rows].sort((a, b) => value(b) - value(a) || b.hotspots - a.hotspots).slice(0, showAll ? rows.length : 8);
  byId('rankingBody').replaceChildren(
    ...sorted.map((row, index) => {
      const pick = el('button', { type: 'button', className: 'link', textContent: row.department });
      if (area.kind === 'department' && area.department === row.department) pick.setAttribute('aria-current', 'true');
      pick.addEventListener('click', () => onPick(row.department));
      return el('tr', {},
        el('td', { textContent: String(index + 1) }),
        el('td', {}, pick),
        el('td', { textContent: fmt(row.hexagons) }),
        el('td', { textContent: fmt(row.hotspots) }),
        el('td', { className: 'hl', textContent: row.events === null ? t('na') : fmt(row.events) }),
      );
    }),
  );
  document.querySelectorAll<HTMLElement>('.ranking th[data-sort]').forEach((th) =>
    th.setAttribute('aria-sort', th.dataset.sort === sortKey ? 'descending' : 'none'));
  const more = byId<HTMLButtonElement>('rankingMore');
  more.hidden = rows.length <= 8;
  more.textContent = showAll ? t('rank.less') : t('rank.all', { n: rows.length });
}

/** Textos que dependen de los metadatos: validación antes/después, límites y fuente. */
export function renderAbout(meta: Meta | null): void {
  const monthly = meta?.validation?.['holdout_2021_2024_monthly'];
  const before = monthly?.['before_unharmonized_cells']?.mape_pct;
  const after = monthly?.['after_harmonized_oos']?.mape_pct;
  setText('validationText', t('ba.text') + (before !== undefined && after !== undefined ? t('ba.validation', { b: before, a: after }) : ''));
  byId('caveats').replaceChildren(...[1, 2, 3, 4, 5, 6].map((n) => el('li', { textContent: t(`caveat.${n}` as Key) })));
  if (meta) setText('source', t('source', { a: meta.firstDate, b: meta.lastDate }));
}

export function renderStatus(loading: boolean, error: string | null): void {
  const status = byId('status');
  status.hidden = !loading && !error;
  status.textContent = error ?? t('status.loading');
  status.classList.toggle('error', Boolean(error));
}

/** Barra apilada con su leyenda: el reparto de los focos crudos por una categoría. */
function shareBar(title: string, counts: Record<string, number>, colors: Record<string, string>, labels: Record<string, string> = {}): HTMLElement {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const color = (key: string, i: number): string => colors[key] ?? RAMP[Math.min(RAMP.length - 1, 5 - i)]!;
  return el('div', { className: 'raw-bar' },
    el('h4', { textContent: title }),
    el('div', { className: 'raw-track', role: 'img', ariaLabel: entries.map(([k, n]) => `${labels[k] ?? k}: ${fmt(n)}`).join(', ') },
      ...entries.map(([key, n], i) => el('span', { style: `width:${((100 * n) / total).toFixed(2)}%;background:${color(key, i)}`, title: `${labels[key] ?? key}: ${fmt(n)}` }))),
    el('div', { className: 'raw-legend' },
      ...entries.map(([key, n], i) => el('span', {}, el('i', { style: `background:${color(key, i)}` }), `${labels[key] ?? key} ${fmt(n)} · ${Math.round((100 * n) / total)}%`))),
  );
}

/**
 * Tarjeta de focos crudos del rango: cuántos hay, en cuántos días y cómo se reparten por sensor, satélite, día/noche
 * y confianza. Cuenta todos los focos del área y el rango, no solo los que el mapa alcanza a dibujar.
 */
export function renderRawCard(summary: PointSummary | null, events: EventSummary | null, daily: DailySeries, range: DayRange): void {
  const card = byId('rawCard');
  if (!summary) {
    card.hidden = true;
    return;
  }
  renderEventStats(events, daily, range);
  card.hidden = false;
  // Tres maneras de contar lo mismo, de la más gruesa a la más fina: celdas de ~36 km², grupos del día y focos.
  setText('rawHexagons', fmt(summary.hexagons));
  setText('rawTotal', fmt(summary.total));
  setText('rawEventCount', events ? fmt(events.total) : t('na'));
  setText('rawDaysLine', t('raw.daysLine', {
    d: fmt(summary.activeDays), n: fmt(daysBetween(range.from, range.to)),
    busiest: summary.busiestDay ? `${dayLabel(summary.busiestDay)} (${fmt(summary.busiestCount)})` : '—',
  }));
  const satellites: Record<string, string> = { SNPP: VIIRS_ERA, N20: RAMP[4]!, N21: RAMP[2]!, Aqua: MODIS_ERA, Terra: RAMP[3]! };
  byId('rawBars').replaceChildren(
    ...(summary.total
      ? [
          shareBar(t('raw.bySensor'), summary.bySensor, { VIIRS: VIIRS_ERA, MODIS: MODIS_ERA }),
          shareBar(t('raw.bySatellite'), summary.bySatellite, satellites, { SNPP: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21' }),
          shareBar(t('raw.byDaynight'), summary.byDaynight, { D: RAMP[1]!, N: 'var(--tx2)' }, { D: t('raw.day'), N: t('raw.night') }),
          shareBar(t('raw.byConfidence'), summary.byConfidence, { h: RAMP[5]!, n: RAMP[2]! }, { h: t('raw.conf.h'), n: t('raw.conf.n') }),
        ]
      : []),
  );
  setText('rawFrp', summary.frpMedian === null ? '' : t('raw.frp', { m: summary.frpMedian.toFixed(1), x: fmt(summary.frpMax ?? 0) }));
}

/**
 * Recuento diario de los focos agrupados: cada día, los buffers que se tocan forman un evento. Barras de eventos por
 * día (o por semanas/meses si el rango es largo), tamaños de los eventos y el mayor del rango.
 */
export function renderEventStats(events: EventSummary | null, daily: DailySeries, range: DayRange): void {
  const box = byId('rawEvents');
  box.hidden = !events;
  if (!events) return;
  const days = daysBetween(range.from, range.to);
  setText('evTotal', events.total ? (events.hotspots / events.total).toFixed(1) : '—');
  const perDay = events.activeDays ? events.total / events.activeDays : 0;
  setText('evPerDay', events.activeDays ? `${perDay >= 10 ? fmt(perDay) : perDay.toFixed(1)} · ${t('ev.max')} ${fmt(events.busiestCount)}` : '—');
  setText('evBusiest', events.busiestDay ? `${dayLabel(events.busiestDay)} · ${fmt(events.busiestCount)}` : '—');

  // Barras: un día por barra hasta 120 días; si no, se agrupan en tramos iguales.
  const values = daily.events ?? [];
  const offset = dayNumber(range.from) - dayNumber(daily.start);
  const step = Math.max(1, Math.ceil(days / 120));
  const buckets: { start: string; sum: number }[] = [];
  for (let i = 0; i < days; i += step) {
    let sum = 0;
    for (let d = i; d < Math.min(days, i + step); d += 1) sum += values[offset + d] ?? 0;
    buckets.push({ start: addDays(range.from, i), sum });
  }
  const max = Math.max(1, ...buckets.map((b) => b.sum));
  const x0 = 2;
  const width = (322 - x0) / buckets.length;
  byId('evChart').innerHTML =
    buckets
      .map((b, i) => {
        const h = (b.sum / max) * 56;
        return b.sum
          ? `<rect class="bar" x="${(x0 + i * width).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${Math.max(0.6, width - (width > 3 ? 1 : 0)).toFixed(1)}" height="${h.toFixed(1)}"><title>${dayLabel(b.start)}${step > 1 ? ` (+${step - 1} d)` : ''}: ${fmt(b.sum)}</title></rect>`
          : '';
      })
      .join('') +
    `<line x1="${x0}" x2="322" y1="60.5" y2="60.5" stroke="var(--bd)"/>` +
    `<text x="${x0}" y="72">${dayLabel(range.from)}</text><text x="322" y="72" text-anchor="end">${dayLabel(range.to)}</text>`;
  // La escala ya está en "máx." de arriba: solo se explica la barra cuando agrupa varios días.
  const caption = byId('evChartText');
  caption.hidden = step === 1;
  caption.textContent = step === 1 ? '' : t('ev.chart.groups', { n: step, m: fmt(max) });

  byId('evSizes').replaceChildren(
    shareBar(t('ev.sizes'), events.sizes, { '1': RAMP[1]!, '2-5': RAMP[2]!, '6-20': RAMP[4]!, '21+': RAMP[5]! },
      { '1': t('ev.size.1'), '2-5': t('ev.size.2'), '6-20': t('ev.size.6'), '21+': t('ev.size.21') }),
  );
  const largest = events.largest;
  byId('evLargest').hidden = !largest;
  if (largest) {
    setText('evLargestText', t('ev.largest', { n: fmt(largest.hotspots), day: dayLabel(largest.day), frp: largest.frp === null ? '—' : fmt(largest.frp) }));
  }
}
