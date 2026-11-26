import { el } from '../../shared/dom';
import { compact, fmt, monthKey, monthLabel } from '../../shared/format';
import { monthNames, t } from '../../shared/i18n';
import { RAMP, RAMP_INK, quantileBreaks, rampIndex } from '../../shared/palette';
import { metricNoun, metricValue, type BurnCalendar, type Measure, type MonthPoint } from '../domain/types';

interface Handlers {
  /** Clic en un mes: el rango pasa a ser ese mes completo. */
  onSelect: (year: number, month: number) => void;
  onYear: (year: number) => void;
}

function indexByMonth(calendar: BurnCalendar): Map<string, MonthPoint> {
  return new Map(calendar.series.map((p) => [monthKey(p.year, p.month), p]));
}

/** Calendario de quema compacto (año × mes). El número de cada celda está en la vista ampliada. */
export function renderHeatmap(
  container: HTMLElement,
  calendar: BurnCalendar,
  metric: Measure,
  range: { from: string; to: string },
  handlers: Handlers,
  /** Cortes de la rampa ya calculados; por defecto, cuantiles de todos los meses. */
  givenBreaks?: number[],
): void {
  // Meses que tocan el rango elegido (con precisión de días): los demás se atenúan.
  const fromKey = range.from.slice(0, 7);
  const toKey = range.to.slice(0, 7);
  const breaks = givenBreaks ?? quantileBreaks(calendar.series.map((p) => metricValue(p, metric)));
  const points = indexByMonth(calendar);
  const firstYear = calendar.series[0]!.year;
  const lastYear = calendar.series.at(-1)!.year;
  container.replaceChildren(el('div'), ...monthNames().map((m) => el('div', { className: 'cal-head', textContent: m[0]!.toUpperCase() })));

  for (let year = firstYear; year <= lastYear; year += 1) {
    if (year === 2012) container.append(el('div', { className: 'cal-divider', title: t('cal.divider') }));
    const label = el('button', { className: 'cal-year', type: 'button', textContent: year % 2 === 0 ? String(year) : '', title: t('cal.inspect', { year }) });
    label.setAttribute('aria-label', t('cal.inspect', { year }));
    label.addEventListener('click', () => handlers.onYear(year));
    container.append(label);
    for (let month = 1; month <= 12; month += 1) {
      const key = monthKey(year, month);
      const point = points.get(key);
      if (!point) {
        container.append(el('div', { className: 'cal-empty' }));
        continue;
      }
      const value = metricValue(point, metric);
      const cell = el('button', {
        className: 'cal-cell',
        type: 'button',
        title: `${monthLabel(year, month)}: ${fmt(value)} ${metricNoun(metric)} · ${t('cal.pick')}`,
        style:
          // Un mes sin focos no lleva color de fuego: se distingue de "poca actividad".
          `background:${value > 0 ? RAMP[rampIndex(value, breaks)] : 'var(--s1)'};` +
          (key < fromKey || key > toKey ? 'opacity:.3;' : ''),
      });
      cell.setAttribute('aria-label', cell.title);
      cell.addEventListener('click', () => handlers.onSelect(year, month));
      container.append(cell);
    }
  }
}

/** Vista ampliada: tabla con el número en cada celda, para no depender solo del color. */
export function renderFullCalendar(table: HTMLTableElement, calendar: BurnCalendar, metric: Measure): void {
  const breaks = quantileBreaks(calendar.series.map((p) => metricValue(p, metric)));
  const points = indexByMonth(calendar);
  const head = el('tr', {}, el('th', { textContent: t('cal.year'), scope: 'col' }), ...monthNames().map((m) => el('th', { textContent: m, scope: 'col' })), el('th', { textContent: t('cal.total'), scope: 'col' }));
  const body = el('tbody');
  for (const total of calendar.years) {
    const row = el('tr', {}, el('th', { textContent: `${total.year}${total.partial ? ' *' : ''}`, scope: 'row' }));
    for (let month = 1; month <= 12; month += 1) {
      const point = points.get(monthKey(total.year, month));
      if (!point) {
        row.append(el('td', { textContent: '', className: 'full-empty' }));
        continue;
      }
      const value = metricValue(point, metric);
      const level = rampIndex(value, breaks);
      row.append(el('td', {
        textContent: compact(value),
        title: `${monthLabel(total.year, month)}: ${fmt(value)}${point.lowConfidence ? t('tip.lowConf') : ''}`,
        style: `${value > 0 ? `background:${RAMP[level]};color:${RAMP_INK[level]}` : 'background:var(--s1)'}${point.sensor === 'MODIS' ? ';font-style:italic' : ''}`,
      }));
    }
    row.append(el('td', { textContent: compact(metricValue(total, metric)), className: 'full-total' }));
    body.append(row);
  }
  table.replaceChildren(el('thead', {}, head), body);
}
