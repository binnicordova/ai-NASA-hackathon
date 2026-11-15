import { COUNTRY, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { monthKey } from '../../shared/format';
import type { Anomaly, BurnCalendar, CellCollection, Meta, Metric, RankingRow } from '../domain/types';
import { t } from '../../shared/i18n';
import { ApiError, calendarApi } from '../infrastructure/calendarApiClient';

/** Lo que el usuario ha elegido. Es lo único que se guarda en la URL. */
export interface Selection {
  area: AreaOfInterest;
  from: string | null;
  to: string | null;
  metric: Metric;
  month: { year: number; month: number } | null;
  inspectedYear: number | null;
}

/** Lo que functions/ ha respondido para esa selección. */
export interface ViewData {
  meta: Meta | null;
  calendar: BurnCalendar | null;
  ranking: RankingRow[];
  anomaly: Anomaly | null;
  cells: CellCollection | null;
  loading: boolean;
  error: string | null;
}

export type Listener = (selection: Selection, data: ViewData, changed: { area: boolean; month: boolean }) => void;

/**
 * Caso de uso de la vista: mantiene la selección, pide los datos a functions/ y avisa a la interfaz.
 * No calcula nada del dominio: medianas, anomalías y niveles llegan ya resueltos.
 */
export class CalendarController {
  readonly selection: Selection = { area: COUNTRY, from: null, to: null, metric: 'harmonized', month: null, inspectedYear: null };
  readonly data: ViewData = { meta: null, calendar: null, ranking: [], anomaly: null, cells: null, loading: false, error: null };
  private listeners: Listener[] = [];
  private calendarRequest: AbortController | null = null;
  private monthRequest: AbortController | null = null;

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(changed = { area: false, month: false }): void {
    for (const listener of this.listeners) listener(this.selection, this.data, changed);
  }

  async start(initial: Partial<Selection> = {}): Promise<void> {
    Object.assign(this.selection, initial);
    try {
      this.data.meta = await calendarApi.meta();
    } catch (error) {
      this.fail(error);
      return;
    }
    await this.loadCalendar(true);
  }

  /** Aplica una selección completa, por ejemplo al abrir un enlace compartido. */
  restore(selection: Partial<Selection>): Promise<void> {
    Object.assign(this.selection, { area: COUNTRY, from: null, to: null, month: null, inspectedYear: null }, selection);
    return this.loadCalendar(true);
  }

  setArea(area: AreaOfInterest): Promise<void> {
    this.selection.area = area;
    return this.loadCalendar(true);
  }

  setRange(from: string | null, to: string | null): Promise<void> {
    if (from && to && from > to) [from, to] = [to, from];
    this.selection.from = from;
    this.selection.to = to;
    return this.loadCalendar(false);
  }

  setMetric(metric: Metric): void {
    this.selection.metric = metric;
    this.emit();
  }

  inspectYear(year: number): void {
    const years = this.data.calendar?.years ?? [];
    if (!years.length) return;
    this.selection.inspectedYear = Math.min(years[years.length - 1]!.year, Math.max(years[0]!.year, year));
    this.emit();
  }

  selectMonth(year: number, month: number): Promise<void> {
    this.selection.month = { year, month };
    this.selection.inspectedYear = year;
    this.emit();
    return this.loadMonth();
  }

  private async loadCalendar(areaChanged: boolean): Promise<void> {
    this.calendarRequest?.abort();
    const request = (this.calendarRequest = new AbortController());
    const { area, from, to } = this.selection;
    this.data.loading = true;
    this.data.error = null;
    this.emit();
    try {
      const [calendar, ranking] = await Promise.all([
        calendarApi.calendar(area, { from, to }, request.signal),
        calendarApi.ranking({ from, to }, request.signal),
      ]);
      this.data.calendar = calendar;
      this.data.ranking = ranking;
      this.selection.from = calendar.range.from;
      this.selection.to = calendar.range.to;
      // El mes elegido debe quedar dentro del rango; por defecto, el más reciente.
      const selected = this.selection.month;
      const key = selected ? monthKey(selected.year, selected.month) : null;
      if (!key || key < calendar.range.from || key > calendar.range.to) {
        const last = calendar.series.filter((p) => monthKey(p.year, p.month) <= calendar.range.to).at(-1)!;
        this.selection.month = { year: last.year, month: last.month };
        this.selection.inspectedYear = last.year;
      }
      this.data.loading = false;
      this.emit({ area: areaChanged, month: false });
      await this.loadMonth(areaChanged);
    } catch (error) {
      this.fail(error);
    }
  }

  private async loadMonth(areaChanged = false): Promise<void> {
    const selected = this.selection.month;
    if (!selected) return;
    this.monthRequest?.abort();
    const request = (this.monthRequest = new AbortController());
    const key = monthKey(selected.year, selected.month);
    try {
      const [anomaly, cells] = await Promise.all([
        calendarApi.anomaly(this.selection.area, key, request.signal),
        calendarApi.cells(this.selection.area, key, request.signal),
      ]);
      this.data.anomaly = anomaly;
      this.data.cells = cells;
      this.emit({ area: areaChanged, month: true });
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return; // la reemplazó una petición más nueva
    this.data.loading = false;
    this.data.error = error instanceof ApiError ? error.message : t('err.generic');
    this.emit();
  }

  /** Vuelve a pintar con los mismos datos, por ejemplo al cambiar de idioma. */
  refresh(): void {
    this.emit();
  }

  downloadUrl(file: 'hotspots.csv' | 'export.csv' | 'calendar.csv'): string {
    return calendarApi.downloadUrl(file, this.selection.area, { from: this.selection.from, to: this.selection.to });
  }
}
