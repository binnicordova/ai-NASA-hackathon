import { el } from '../../shared/dom';
import { fmt, monthKey, monthLabel } from '../../shared/format';
import { t } from '../../shared/i18n';
import { metricNoun, metricValue, type BurnCalendar, type Metric } from '../domain/types';

interface Handlers {
  /** Rango nuevo, en claves `YYYY-MM`. Se llama al soltar, no en cada píxel. */
  onRange: (from: string, to: string) => void;
  onSelect: (year: number, month: number) => void;
}

type Drag = { mode: 'start' | 'end' | 'move' | 'new'; pointer: number; x: number; anchor: number; from: number; to: number; moved: boolean };

const SVG_NS = 'http://www.w3.org/2000/svg';
const KEY_STEP: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 };

/**
 * Selector de rango tipo "brush": la actividad mensual de 2000 a hoy como fondo y una ventana que se arrastra
 * para acercar o desplazar el periodo. Un clic sin arrastre elige ese mes.
 */
export class RangeBrush {
  private readonly chart = document.createElementNS(SVG_NS, 'svg');
  private readonly area = document.createElementNS(SVG_NS, 'path');
  private readonly dimLeft = el('div', { className: 'brush-dim' });
  private readonly dimRight = el('div', { className: 'brush-dim' });
  private readonly window = el('div', { className: 'brush-window' });
  private readonly startHandle = el('div', { className: 'brush-handle', tabIndex: 0 });
  private readonly endHandle = el('div', { className: 'brush-handle', tabIndex: 0 });
  private readonly cursor = el('div', { className: 'brush-cursor' });
  private readonly era = el('div', { className: 'brush-era' });
  private readonly tip = el('div', { className: 'brush-tip', hidden: true });
  private readonly track = el('div', { className: 'brush-track' });
  private readonly axis = el('div', { className: 'brush-axis' });

  private keys: string[] = [];
  private from = 0;
  private to = 0;
  private drag: Drag | null = null;
  private keyTimer = 0;

  constructor(
    root: HTMLElement,
    private readonly rangeText: HTMLElement,
    private readonly handlers: Handlers,
  ) {
    this.chart.setAttribute('class', 'brush-chart');
    this.chart.setAttribute('preserveAspectRatio', 'none');
    this.chart.setAttribute('aria-hidden', 'true');
    this.chart.append(this.area);
    for (const [handle, label] of [[this.startHandle, 'brush.start'], [this.endHandle, 'brush.end']] as const) {
      handle.setAttribute('role', 'slider');
      handle.dataset.label = label;
      handle.addEventListener('keydown', (event) => this.onKey(event, handle === this.startHandle));
    }
    this.window.append(this.startHandle, this.endHandle);
    this.track.append(this.chart, this.era, this.dimLeft, this.dimRight, this.window, this.cursor, this.tip);
    root.replaceChildren(this.track, this.axis);

    // Eventos de puntero: el mismo código sirve para ratón, lápiz y dedo.
    this.track.addEventListener('pointerdown', (event) => this.onDown(event));
    this.track.addEventListener('pointermove', (event) => this.onMove(event));
    this.track.addEventListener('pointerup', (event) => this.onUp(event));
    this.track.addEventListener('pointercancel', () => this.cancel());
    this.track.addEventListener('pointerleave', () => !this.drag && (this.tip.hidden = true));
    this.track.addEventListener('dblclick', () => this.commit(0, this.keys.length - 1));
    new ResizeObserver(() => this.renderAxis()).observe(this.track);
  }

  render(calendar: BurnCalendar, metric: Metric, selected: { year: number; month: number } | null): void {
    const series = calendar.series;
    this.keys = series.map((p) => monthKey(p.year, p.month));
    const n = this.keys.length;
    if (!n) return;
    const index = new Map(this.keys.map((key, i) => [key, i]));
    this.from = index.get(calendar.range.from) ?? 0;
    this.to = index.get(calendar.range.to) ?? n - 1;

    const values = series.map((p) => metricValue(p, metric));
    const max = Math.max(1, ...values);
    const y = (v: number): string => (100 - (92 * v) / max).toFixed(1);
    this.chart.setAttribute('viewBox', `0 0 ${n} 100`);
    this.area.setAttribute('d', `M0,100 ${values.map((v, i) => `L${i},${y(v)} L${i + 1},${y(v)}`).join(' ')} L${n},100 Z`);

    const viirs = index.get('2012-02');
    this.era.hidden = viirs === undefined;
    if (viirs !== undefined) {
      this.era.style.left = this.pct(viirs);
      this.era.textContent = t('brush.viirs');
    }

    const selectedIndex = selected ? index.get(monthKey(selected.year, selected.month)) : undefined;
    this.cursor.hidden = selectedIndex === undefined;
    if (selectedIndex !== undefined) {
      this.cursor.style.left = this.pct(selectedIndex + 0.5);
      this.cursor.title = `${monthLabel(selected!.year, selected!.month)}: ${fmt(values[selectedIndex]!)} ${metricNoun(metric)}`;
    }
    this.track.setAttribute('aria-label', t('brush.label'));
    this.paintWindow(this.from, this.to);
    this.renderAxis();
  }

  // --- pintar ------------------------------------------------------------------

  private pct(i: number): string {
    return `${((100 * i) / Math.max(1, this.keys.length)).toFixed(3)}%`;
  }

  private label(i: number): string {
    const [year, month] = this.keys[i]!.split('-').map(Number);
    return monthLabel(year!, month!);
  }

  private paintWindow(from: number, to: number): void {
    this.window.style.left = this.pct(from);
    this.window.style.width = this.pct(to - from + 1);
    this.dimLeft.style.cssText = `left:0;width:${this.pct(from)}`;
    this.dimRight.style.cssText = `left:${this.pct(to + 1)};right:0`;
    const months = to - from + 1;
    this.rangeText.textContent = `${this.label(from)} – ${this.label(to)} · ${t('brush.months', { n: months })}`;
    for (const [handle, i] of [[this.startHandle, from], [this.endHandle, to]] as const) {
      handle.setAttribute('aria-label', t(handle.dataset.label as 'brush.start' | 'brush.end'));
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(this.keys.length - 1));
      handle.setAttribute('aria-valuenow', String(i));
      handle.setAttribute('aria-valuetext', this.label(i));
    }
  }

  private renderAxis(): void {
    const n = this.keys.length;
    if (!n) return;
    const width = this.track.clientWidth || 600;
    const perYear = (width * 12) / n;
    const step = perYear >= 34 ? 1 : perYear >= 16 ? 2 : 5;
    const labels: HTMLElement[] = [];
    this.keys.forEach((key, i) => {
      const year = Number(key.slice(0, 4));
      if (key.endsWith('-01') && year % step === 0) labels.push(el('span', { textContent: String(year), style: `left:${this.pct(i)}` }));
    });
    this.axis.replaceChildren(...labels);
  }

  private showTip(i: number, text = this.label(i)): void {
    this.tip.hidden = false;
    this.tip.textContent = text;
    this.tip.style.left = this.pct(i + 0.5);
  }

  // --- puntero -------------------------------------------------------------------

  private indexAt(clientX: number): number {
    const box = this.track.getBoundingClientRect();
    const i = Math.floor(((clientX - box.left) / box.width) * this.keys.length);
    return Math.min(this.keys.length - 1, Math.max(0, i));
  }

  private onDown(event: PointerEvent): void {
    if (!this.keys.length || event.button > 0) return;
    const target = event.target as HTMLElement;
    const at = this.indexAt(event.clientX);
    const mode: Drag['mode'] =
      target === this.startHandle ? 'start' : target === this.endHandle ? 'end' : at >= this.from && at <= this.to ? 'move' : 'new';
    this.drag = { mode, pointer: event.pointerId, x: event.clientX, anchor: at, from: this.from, to: this.to, moved: false };
    this.track.setPointerCapture(event.pointerId);
    this.track.classList.add('dragging');
    if (mode === 'start' || mode === 'end') (target as HTMLElement).focus();
    event.preventDefault();
  }

  private onMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      if (event.pointerType === 'mouse' && this.keys.length) this.showTip(this.indexAt(event.clientX));
      return;
    }
    if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true;
    if (!drag.moved) return;
    const last = this.keys.length - 1;
    const at = this.indexAt(event.clientX);
    let { from, to } = this;
    if (drag.mode === 'start') from = Math.min(at, to);
    else if (drag.mode === 'end') to = Math.max(at, from);
    else if (drag.mode === 'new') [from, to] = [Math.min(drag.anchor, at), Math.max(drag.anchor, at)];
    else {
      const span = this.to - this.from;
      from = Math.min(last - span, Math.max(0, this.from + at - drag.anchor));
      to = from + span;
    }
    drag.from = from;
    drag.to = to;
    this.paintWindow(from, to);
    this.showTip(drag.mode === 'start' ? from : drag.mode === 'end' ? to : at, `${this.label(from)} – ${this.label(to)}`);
  }

  private onUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    this.drag = null;
    this.track.classList.remove('dragging');
    this.tip.hidden = true;
    if (!drag.moved) {
      // Un clic elige el mes; sobre un asa no hace nada (se está tomando el asa).
      if (drag.mode === 'move' || drag.mode === 'new') {
        const [year, month] = this.keys[drag.anchor]!.split('-').map(Number);
        this.handlers.onSelect(year!, month!);
      }
      return;
    }
    this.commit(drag.from, drag.to);
  }

  private cancel(): void {
    this.drag = null;
    this.track.classList.remove('dragging');
    this.tip.hidden = true;
    this.paintWindow(this.from, this.to);
  }

  private commit(from: number, to: number): void {
    if (!this.keys.length || (from === this.from && to === this.to)) return;
    this.from = from;
    this.to = to;
    this.paintWindow(from, to);
    this.handlers.onRange(this.keys[from]!, this.keys[to]!);
  }

  // --- teclado ---------------------------------------------------------------------

  private onKey(event: KeyboardEvent, isStart: boolean): void {
    const last = this.keys.length - 1;
    const current = isStart ? this.from : this.to;
    let next: number;
    if (event.key === 'Home') next = isStart ? 0 : this.from;
    else if (event.key === 'End') next = isStart ? this.to : last;
    else if (event.key in KEY_STEP) next = current + KEY_STEP[event.key]!;
    else return;
    event.preventDefault();
    next = isStart ? Math.max(0, Math.min(next, this.to)) : Math.min(last, Math.max(next, this.from));
    if (isStart) this.from = next;
    else this.to = next;
    this.paintWindow(this.from, this.to);
    // Al pulsar varias veces seguidas, se pide un solo rango al terminar.
    window.clearTimeout(this.keyTimer);
    const [from, to] = [this.from, this.to];
    this.keyTimer = window.setTimeout(() => this.handlers.onRange(this.keys[from]!, this.keys[to]!), 400);
  }
}
