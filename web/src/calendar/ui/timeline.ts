import { el } from '../../shared/dom';
import { fmt, monthKey, monthLabel } from '../../shared/format';
import { ACCENT, MODIS_ERA, VIIRS_ERA } from '../../shared/palette';
import { metricNoun, metricValue, type BurnCalendar, type Metric } from '../domain/types';

const BAR_HEIGHT = 54;

/** Línea de tiempo horizontal: una barra por mes desde 2000. Clic en un mes para seleccionarlo. */
export class Timeline {
  private first = true;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly track: HTMLElement,
    private readonly onSelect: (year: number, month: number) => void,
  ) {}

  render(calendar: BurnCalendar, metric: Metric, selected: { year: number; month: number } | null): void {
    const keepScroll = this.scroller.scrollLeft;
    const max = Math.max(1, ...calendar.series.map((p) => metricValue(p, metric)));
    this.track.replaceChildren();
    let bars: HTMLElement | null = null;
    let year: number | null = null;
    let selectedBar: HTMLElement | null = null;

    for (const point of calendar.series) {
      if (point.year !== year) {
        year = point.year;
        bars = el('div', { className: 'tl-bars' });
        this.track.append(el('div', { className: 'tl-year' }, bars, el('div', { className: 'tl-label', textContent: String(year) })));
      }
      const key = monthKey(point.year, point.month);
      const inRange = key >= calendar.range.from && key <= calendar.range.to;
      const isSelected = selected?.year === point.year && selected.month === point.month;
      const value = metricValue(point, metric);
      const title = `${monthLabel(point.year, point.month)}: ${fmt(value)} ${metricNoun(metric)}`;
      const bar = el('button', {
        className: 'tl-bar',
        title,
        type: 'button',
        style:
          `height:${Math.max(2, Math.round((BAR_HEIGHT * value) / max))}px;` +
          `background:${isSelected ? ACCENT : point.sensor === 'MODIS' ? MODIS_ERA : VIIRS_ERA};` +
          (inRange ? '' : 'opacity:.3'),
      });
      bar.setAttribute('aria-label', title);
      if (isSelected) {
        bar.setAttribute('aria-current', 'true');
        selectedBar = bar;
      }
      bar.addEventListener('click', () => this.onSelect(point.year, point.month));
      bars!.append(bar);
    }

    // Posición del mes elegido dentro de la pista, medida en pantalla (no depende del contenedor posicionado).
    const selectedLeft = selectedBar
      ? selectedBar.getBoundingClientRect().left - this.track.getBoundingClientRect().left
      : null;
    if (this.first) {
      this.first = false;
      this.scroller.scrollLeft = selectedLeft === null ? this.scroller.scrollWidth : selectedLeft - this.scroller.clientWidth / 2;
    } else {
      this.scroller.scrollLeft = keepScroll;
      // Si el mes elegido quedó fuera de la vista (por ejemplo, al elegirlo en el calendario), se centra.
      if (selectedLeft !== null && (selectedLeft < keepScroll || selectedLeft > keepScroll + this.scroller.clientWidth - 12)) {
        this.scroller.scrollLeft = selectedLeft - this.scroller.clientWidth / 2;
      }
    }
  }
}
