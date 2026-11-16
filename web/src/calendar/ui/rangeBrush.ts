import { el } from '../../shared/dom';
import { addDays, dayLabel, dayNumber, fmt, monthEnd, monthLabel } from '../../shared/format';
import { monthNames, t } from '../../shared/i18n';
import { metricNoun, type DailySeries, type DayRange, type Measure } from '../domain/types';

interface Handlers {
  /** Rango nuevo, en días `AAAA-MM-DD`. Se llama al soltar, no en cada píxel. */
  onRange: (from: string, to: string) => void;
}

type Drag = { mode: 'start' | 'end' | 'move' | 'new'; pointer: number; x: number; anchor: number; from: number; to: number; moved: boolean };

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Con más de dos años a la vista se elige por meses; con menos, por días. */
const MONTH_MODE_DAYS = 730;
/** Lo más cerca que se puede acercar la vista: dos semanas. */
const MIN_VIEW_DAYS = 14;
const VIIRS_START = '2012-01-20';

/**
 * Línea de tiempo con inicio y fin: la actividad de fondo, una ventana que se arrastra para elegir el rango y zoom
 * (rueda, botones o doble clic) para pasar de años a días. Lejos se elige por meses; cerca, por días.
 */
export class RangeBrush {
  private readonly chart = document.createElementNS(SVG_NS, 'svg');
  private readonly area = document.createElementNS(SVG_NS, 'path');
  private readonly dimLeft = el('div', { className: 'brush-dim' });
  private readonly dimRight = el('div', { className: 'brush-dim' });
  private readonly window = el('div', { className: 'brush-window' });
  private readonly startHandle = el('div', { className: 'brush-handle', tabIndex: 0 });
  private readonly endHandle = el('div', { className: 'brush-handle', tabIndex: 0 });
  private readonly era = el('div', { className: 'brush-era' });
  private readonly tip = el('div', { className: 'brush-tip', hidden: true });
  private readonly track = el('div', { className: 'brush-track' });
  private readonly flags = el('div', { className: 'brush-flags' });
  private readonly startFlag = el('span', { className: 'brush-flag start' });
  private readonly endFlag = el('span', { className: 'brush-flag end' });
  private readonly axis = el('div', { className: 'brush-axis' });

  private daily: DailySeries | null = null;
  private metric: Measure = 'harmonized';
  private origin = 0; // número de día del índice 0
  private n = 0;
  private from = 0;
  private to = 0;
  /** Vista visible, en días desde el origen: [v0, v1). */
  private v0 = 0;
  private v1 = 1;
  private drag: Drag | null = null;
  private keyTimer = 0;
  private frame = 0;
  private lastRange = '';

  constructor(
    root: HTMLElement,
    private readonly rangeText: HTMLElement,
    private readonly viewText: HTMLElement,
    private readonly handlers: Handlers,
  ) {
    this.chart.setAttribute('class', 'brush-chart');
    this.chart.setAttribute('viewBox', '0 0 1000 100');
    this.chart.setAttribute('preserveAspectRatio', 'none');
    this.chart.setAttribute('aria-hidden', 'true');
    this.chart.append(this.area);
    for (const [handle, label] of [[this.startHandle, 'brush.start'], [this.endHandle, 'brush.end']] as const) {
      handle.setAttribute('role', 'slider');
      handle.dataset.label = label;
      handle.addEventListener('keydown', (event) => this.onKey(event, handle === this.startHandle));
    }
    this.window.append(this.startHandle, this.endHandle);
    this.track.append(this.chart, this.era, this.dimLeft, this.dimRight, this.window, this.tip);
    this.flags.append(this.startFlag, this.endFlag);
    root.replaceChildren(this.flags, this.track, this.axis);

    // Eventos de puntero: el mismo código sirve para ratón, lápiz y dedo.
    this.track.addEventListener('pointerdown', (event) => this.onDown(event));
    this.track.addEventListener('pointermove', (event) => this.onMove(event));
    this.track.addEventListener('pointerup', (event) => this.onUp(event));
    this.track.addEventListener('pointercancel', () => this.cancel());
    this.track.addEventListener('pointerleave', () => !this.drag && (this.tip.hidden = true));
    this.track.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.track.addEventListener('dblclick', () => this.fitSelection());
    new ResizeObserver(() => this.paint()).observe(this.track);
  }

  render(daily: DailySeries, range: DayRange, metric: Measure): void {
    const dataChanged = daily !== this.daily;
    this.daily = daily;
    this.metric = metric;
    this.origin = dayNumber(daily.start);
    this.n = daily.harmonized.length;
    if (!this.drag) {
      this.from = this.clampIndex(dayNumber(range.from) - this.origin);
      this.to = this.clampIndex(dayNumber(range.to) - this.origin);
    }
    // La primera vez, o si la serie nueva no cabe en la vista actual, se ve todo; si no, se conserva el zoom.
    if (dataChanged && (this.v1 - this.v0 <= 1 || this.v1 > this.n)) this.setView(0, this.n);
    // Si el rango cambió desde fuera (enlace, fechas, calendario) y quedó fuera de la vista, la vista lo sigue.
    const key = `${range.from}|${range.to}`;
    if (key !== this.lastRange) {
      // Al abrir un enlace con un rango corto (menos de un 5 % de la serie), se entra ya acercado a él.
      const firstShortRange = this.lastRange === '' && (this.to - this.from + 1) * 20 < this.n;
      this.lastRange = key;
      if (firstShortRange || this.from < this.v0 || this.to + 1 > this.v1) {
        const pad = Math.max(2, (this.to - this.from + 1) * 0.15);
        this.setView(this.from - pad, this.to + 1 + pad);
      }
    }
    this.track.setAttribute('aria-label', t('brush.label'));
    this.paint();
  }

  // --- zoom público (botones) ----------------------------------------------------

  /** Acerca (factor < 1) o aleja (factor > 1) alrededor del centro de la selección. */
  zoomBy(factor: number): void {
    const center = Math.min(Math.max((this.from + this.to + 1) / 2, this.v0), this.v1);
    this.zoomAround(center, factor);
  }

  /** Encuadra la vista en el rango elegido, con un margen a cada lado. */
  fitSelection(): void {
    const span = this.to - this.from + 1;
    const pad = Math.max(2, span * 0.15);
    this.setView(this.from - pad, this.to + 1 + pad);
    this.paint();
  }

  showAll(): void {
    this.setView(0, this.n);
    this.paint();
  }

  // --- geometría -----------------------------------------------------------------

  private clampIndex(i: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.round(i)));
  }

  private setView(v0: number, v1: number): void {
    let span = Math.min(this.n, Math.max(MIN_VIEW_DAYS, v1 - v0));
    let start = v0 + (v1 - v0 - span) / 2;
    start = Math.min(this.n - span, Math.max(0, start));
    if (span > this.n) span = this.n;
    this.v0 = start;
    this.v1 = start + span;
  }

  private zoomAround(at: number, factor: number): void {
    const span = this.v1 - this.v0;
    const next = Math.min(this.n, Math.max(MIN_VIEW_DAYS, span * factor));
    const ratio = (at - this.v0) / span;
    this.setView(at - ratio * next, at - ratio * next + next);
    this.schedulePaint();
  }

  private get monthMode(): boolean {
    return this.v1 - this.v0 > MONTH_MODE_DAYS;
  }

  private pct(i: number): string {
    return `${((100 * (i - this.v0)) / (this.v1 - this.v0)).toFixed(3)}%`;
  }

  private iso(i: number): string {
    return addDays(this.daily!.start, i);
  }

  private label(i: number): string {
    const iso = this.iso(i);
    return this.monthMode ? monthLabel(Number(iso.slice(0, 4)), Number(iso.slice(5, 7))) : dayLabel(iso);
  }

  /** Índices del primer y último día del mes que contiene al día i. */
  private monthBounds(i: number): [number, number] {
    const key = this.iso(i).slice(0, 7);
    return [this.clampIndex(dayNumber(`${key}-01`) - this.origin), this.clampIndex(dayNumber(monthEnd(key)) - this.origin)];
  }

  private values(): number[] {
    return this.metric === 'events' ? this.daily!.events ?? this.daily!.hotspots : this.daily![this.metric];
  }

  // --- pintar ------------------------------------------------------------------

  private schedulePaint(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    if (!this.daily || !this.n) return;
    this.paintChart();
    this.paintWindow(this.from, this.to);
    this.paintAxis();
    const viirs = dayNumber(VIIRS_START) - this.origin;
    this.era.hidden = viirs < this.v0 || viirs > this.v1;
    this.era.style.left = this.pct(viirs);
    this.era.textContent = t('brush.viirs');
    this.viewText.textContent = t('brush.view', {
      a: this.label(Math.ceil(this.v0)), b: this.label(Math.min(this.n - 1, Math.floor(this.v1 - 0.001))),
      unit: t(this.monthMode ? 'brush.unit.month' : 'brush.unit.day'),
    });
  }

  /** Barras de la vista: por meses de lejos, por días de cerca. La escala se ajusta a lo visible. */
  private paintChart(): void {
    const values = this.values();
    const first = Math.max(0, Math.floor(this.v0));
    const last = Math.min(this.n - 1, Math.ceil(this.v1));
    const bars: [number, number, number][] = [];
    if (this.monthMode) {
      let i = this.monthBounds(first)[0];
      while (i <= last) {
        const [a, b] = this.monthBounds(i);
        let sum = 0;
        for (let d = a; d <= b; d += 1) sum += values[d] ?? 0;
        bars.push([a, b + 1, sum]);
        i = b + 1;
      }
    } else {
      for (let d = first; d <= last; d += 1) bars.push([d, d + 1, values[d] ?? 0]);
    }
    const max = Math.max(1e-9, ...bars.map((bar) => bar[2]));
    const span = this.v1 - this.v0;
    const x = (i: number): string => ((1000 * (i - this.v0)) / span).toFixed(2);
    const y = (v: number): string => (100 - (92 * v) / max).toFixed(1);
    const gap = this.monthMode ? 0 : 0.12; // un hueco fino separa las barras diarias
    this.area.setAttribute('d', bars.filter((bar) => bar[2] > 0).map(([a, b, v]) => `M${x(a + gap)},100V${y(v)}H${x(b - gap)}V100Z`).join(''));
  }

  private paintWindow(from: number, to: number): void {
    this.window.style.left = this.pct(from);
    this.window.style.width = `${((100 * (to - from + 1)) / (this.v1 - this.v0)).toFixed(3)}%`;
    this.dimLeft.style.cssText = `left:0;width:${this.pct(from)}`;
    this.dimRight.style.cssText = `left:${this.pct(to + 1)};right:0`;
    const days = to - from + 1;
    const fromIso = this.iso(from);
    const toIso = this.iso(to);
    this.rangeText.textContent = `${dayLabel(fromIso)} – ${dayLabel(toIso)} · ${t('brush.days', { n: fmt(days) })}`;
    // Inicio y fin a la vista, sobre cada asa. Si quedan muy juntos, se leen como una sola etiqueta.
    const width = this.track.clientWidth || 600;
    const close = ((to + 1 - from) / (this.v1 - this.v0)) * width < 150;
    this.startFlag.textContent = close ? `${dayLabel(fromIso)} – ${dayLabel(toIso)}` : dayLabel(fromIso);
    this.startFlag.classList.toggle('both', close);
    this.endFlag.hidden = close;
    this.endFlag.textContent = dayLabel(toIso);
    // Cada etiqueta se ancla a su asa, sin salirse de la pista por ningún lado.
    const place = (flag: HTMLElement, i: number, align: number): void => {
      const x = ((i - this.v0) / (this.v1 - this.v0)) * width - align * flag.offsetWidth;
      flag.style.left = `${Math.max(0, Math.min(width - flag.offsetWidth, x)).toFixed(1)}px`;
    };
    place(this.startFlag, close ? (from + to + 1) / 2 : from, close ? 0.5 : 0);
    if (!close) place(this.endFlag, to + 1, 1);
    for (const [handle, i] of [[this.startHandle, from], [this.endHandle, to]] as const) {
      handle.setAttribute('aria-label', t(handle.dataset.label as 'brush.start' | 'brush.end'));
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', String(this.n - 1));
      handle.setAttribute('aria-valuenow', String(i));
      handle.setAttribute('aria-valuetext', dayLabel(this.iso(i)));
    }
  }

  /** Marcas del eje según el zoom: años, meses o días, sin que se pisen. */
  private paintAxis(): void {
    const width = this.track.clientWidth || 600;
    const pxPerDay = width / (this.v1 - this.v0);
    const labels: HTMLElement[] = [];
    const first = Math.max(0, Math.floor(this.v0));
    const last = Math.min(this.n - 1, Math.ceil(this.v1));
    const add = (i: number, text: string): void => {
      if (i >= this.v0 && i <= this.v1) labels.push(el('span', { textContent: text, style: `left:${this.pct(i)}` }));
    };
    if (pxPerDay * 30 < 34) {
      // Años: cada 1, 2 o 5 según el espacio.
      const perYear = pxPerDay * 365;
      const step = perYear >= 40 ? 1 : perYear >= 20 ? 2 : 5;
      for (let i = first; i <= last; i += 1) {
        const iso = this.iso(i);
        if (iso.endsWith('-01-01') && Number(iso.slice(0, 4)) % step === 0) add(i, iso.slice(0, 4));
      }
    } else if (pxPerDay < 4) {
      // Meses (con el año en enero o en el primer mes visible).
      const step = pxPerDay * 30 >= 56 ? 1 : 3;
      let shownYear = false;
      for (let i = first; i <= last; i += 1) {
        const iso = this.iso(i);
        const month = Number(iso.slice(5, 7));
        if (iso.endsWith('-01') && (month - 1) % step === 0) {
          const withYear = month === 1 || !shownYear;
          shownYear = true;
          add(i, withYear ? `${monthNames()[month - 1]} ${iso.slice(0, 4)}` : monthNames()[month - 1]!);
        }
      }
    } else {
      // Días: uno de cada k para dejar ~56 px entre etiquetas.
      const k = [1, 2, 7, 14].find((step) => step * pxPerDay >= 56) ?? 14;
      for (let i = first; i <= last; i += 1) {
        const iso = this.iso(i);
        const day = Number(iso.slice(8, 10));
        // Semanas: días 1, 8, 15 y 22; quincenas: 1 y 15. Así no se juntan dos etiquetas a fin de mes.
        const marks = k === 7 ? [1, 8, 15, 22] : [1, 15];
        if (k === 1 || (k === 2 && day % 2 === 1 && day < 31) || (k >= 7 && marks.includes(day))) {
          add(i, `${day} ${monthNames()[Number(iso.slice(5, 7)) - 1]}`);
        }
      }
    }
    this.axis.replaceChildren(...labels);
  }

  private showTip(i: number, text?: string): void {
    this.tip.hidden = false;
    if (text === undefined) {
      const values = this.values();
      let value = values[i] ?? 0;
      if (this.monthMode) {
        const [a, b] = this.monthBounds(i);
        value = 0;
        for (let d = a; d <= b; d += 1) value += values[d] ?? 0;
      }
      text = `${this.label(i)} · ${fmt(value)} ${metricNoun(this.metric)}`;
    }
    this.tip.textContent = text;
    this.tip.style.left = this.pct(i + 0.5);
  }

  // --- puntero -------------------------------------------------------------------

  private indexAt(clientX: number): number {
    const box = this.track.getBoundingClientRect();
    return this.clampIndex(Math.floor(this.v0 + ((clientX - box.left) / box.width) * (this.v1 - this.v0)));
  }

  /** Ajusta un extremo al mes completo cuando la vista está en meses. */
  private snap(from: number, to: number): [number, number] {
    if (!this.monthMode) return [from, to];
    return [this.monthBounds(from)[0], this.monthBounds(to)[1]];
  }

  private onDown(event: PointerEvent): void {
    if (!this.n || event.button > 0) return;
    const target = event.target as HTMLElement;
    const at = this.indexAt(event.clientX);
    const mode: Drag['mode'] =
      target === this.startHandle ? 'start' : target === this.endHandle ? 'end' : at >= this.from && at <= this.to ? 'move' : 'new';
    this.drag = { mode, pointer: event.pointerId, x: event.clientX, anchor: at, from: this.from, to: this.to, moved: false };
    this.track.setPointerCapture(event.pointerId);
    this.track.classList.add('dragging');
    if (mode === 'start' || mode === 'end') target.focus();
    event.preventDefault();
  }

  private onMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      if (event.pointerType === 'mouse' && this.n) this.showTip(this.indexAt(event.clientX));
      return;
    }
    if (Math.abs(event.clientX - drag.x) > 3) drag.moved = true;
    if (!drag.moved) return;
    const last = this.n - 1;
    const at = this.indexAt(event.clientX);
    let { from, to } = this;
    if (drag.mode === 'start') [from] = this.snap(Math.min(at, to), to);
    else if (drag.mode === 'end') [, to] = this.snap(from, Math.max(at, from));
    else if (drag.mode === 'new') [from, to] = this.snap(Math.min(drag.anchor, at), Math.max(drag.anchor, at));
    else {
      const span = this.to - this.from;
      from = Math.min(last - span, Math.max(0, this.from + at - drag.anchor));
      to = from + span;
    }
    drag.from = from;
    drag.to = to;
    this.paintWindow(from, to);
    this.showTip(drag.mode === 'start' ? from : drag.mode === 'end' ? to : at, `${dayLabel(this.iso(from))} – ${dayLabel(this.iso(to))}`);
  }

  private onUp(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    this.drag = null;
    this.track.classList.remove('dragging');
    this.tip.hidden = true;
    // Un clic sin arrastre no cambia nada: el rango se elige arrastrando.
    if (drag.moved) this.commit(drag.from, drag.to);
  }

  private onWheel(event: WheelEvent): void {
    if (!this.n) return;
    event.preventDefault();
    const box = this.track.getBoundingClientRect();
    const at = this.v0 + ((event.clientX - box.left) / box.width) * (this.v1 - this.v0);
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
    if (horizontal) {
      // Desplazar la vista sin cambiar el zoom.
      const delta = ((event.shiftKey ? event.deltaY : event.deltaX) / box.width) * (this.v1 - this.v0);
      this.setView(this.v0 + delta, this.v1 + delta);
      this.schedulePaint();
      return;
    }
    this.zoomAround(at, Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0025)));
  }

  private cancel(): void {
    this.drag = null;
    this.track.classList.remove('dragging');
    this.tip.hidden = true;
    this.paintWindow(this.from, this.to);
  }

  private commit(from: number, to: number): void {
    if (!this.n || (from === this.from && to === this.to)) {
      this.paintWindow(this.from, this.to);
      return;
    }
    this.from = from;
    this.to = to;
    this.paintWindow(from, to);
    this.handlers.onRange(this.iso(from), this.iso(to));
  }

  // --- teclado ---------------------------------------------------------------------

  private onKey(event: KeyboardEvent, isStart: boolean): void {
    const last = this.n - 1;
    const current = isStart ? this.from : this.to;
    // Paso de un día cerca y de un mes lejos; RePág/AvPág saltan 30 días o un año.
    const step = this.monthMode ? 30 : 1;
    const big = this.monthMode ? 365 : 30;
    const keys: Record<string, number> = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big };
    let next: number;
    if (event.key === 'Home') next = isStart ? 0 : this.from;
    else if (event.key === 'End') next = isStart ? this.to : last;
    else if (event.key in keys) next = current + keys[event.key]!;
    else return;
    event.preventDefault();
    next = isStart ? Math.max(0, Math.min(next, this.to)) : Math.min(last, Math.max(next, this.from));
    [this.from, this.to] = isStart ? this.snap(next, this.to) : this.snap(this.from, next);
    this.paintWindow(this.from, this.to);
    // Al pulsar varias veces seguidas, se pide un solo rango al terminar.
    window.clearTimeout(this.keyTimer);
    const [from, to] = [this.from, this.to];
    this.keyTimer = window.setTimeout(() => this.handlers.onRange(this.iso(from), this.iso(to)), 400);
  }
}
