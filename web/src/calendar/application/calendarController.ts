import { COUNTRY, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { t } from '../../shared/i18n';

/** Cómo se dibujan los buffers de los focos crudos. */
export type BufferMode = 'overlap' | 'dissolve';
import type { Anomaly, BurnCalendar, CellCollection, DailySeries, DayRange, Limits, Meta, Metric, PointSample, RankingRow } from '../domain/types';
import { ApiError, calendarApi } from '../infrastructure/calendarApiClient';

/** Lo que el usuario ha elegido. Es lo único que se guarda en la URL. */
export interface Selection {
  area: AreaOfInterest;
  /** Primer y último día del rango (AAAA-MM-DD). `null` = todo lo disponible. */
  from: string | null;
  to: string | null;
  /** Pestaña: hexágonos armonizados o focos crudos. */
  metric: Metric;
  /** En la pestaña armonizada, superponer los focos crudos sobre los hexágonos. */
  overlay: boolean;
  /** Buffers de los focos: disueltos por día en una figura (por defecto) o superpuestos uno a uno. */
  buffers: BufferMode;
  inspectedYear: number | null;
}

/** Lo que functions/ ha respondido para esa selección. */
export interface ViewData {
  meta: Meta | null;
  /** Departamentos y distritos oficiales (INEI). `null` si el despliegue no los trae. */
  limits: Limits | null;
  /** Contorno oficial del área elegida, si es un departamento o un distrito. */
  boundary: GeoJSON.Feature | null;
  calendar: BurnCalendar | null;
  daily: DailySeries | null;
  ranking: RankingRow[];
  /** El mes en curso frente a su mediana histórica. No depende del rango. */
  anomaly: Anomaly | null;
  cells: CellCollection | null;
  points: PointSample | null;
  loading: boolean;
  mapLoading: boolean;
  error: string | null;
}

export interface Changes {
  area: boolean;
  map: boolean;
}

export type Listener = (selection: Selection, data: ViewData, changed: Changes) => void;

const NO_CHANGE: Changes = { area: false, map: false };

/**
 * Caso de uso de la vista: mantiene la selección, pide los datos a functions/ y avisa a la interfaz.
 * No calcula nada del dominio: medianas, anomalías y niveles llegan ya resueltos.
 */
export class CalendarController {
  readonly selection: Selection = { area: COUNTRY, from: null, to: null, metric: 'harmonized', overlay: false, buffers: 'dissolve', inspectedYear: null };
  readonly data: ViewData = {
    meta: null, limits: null, boundary: null, calendar: null, daily: null, ranking: [], anomaly: null, cells: null, points: null, loading: false, mapLoading: false, error: null,
  };
  private listeners: Listener[] = [];
  private areaRequest: AbortController | null = null;
  private rangeRequest: AbortController | null = null;
  private mapRequest: AbortController | null = null;
  /** Qué área y rango tienen las celdas y los focos ya pintados: así no se piden dos veces. */
  private cellsKey = '';
  private pointsKey = '';

  subscribe(listener: Listener): void {
    this.listeners.push(listener);
  }

  private emit(changed: Changes = NO_CHANGE): void {
    for (const listener of this.listeners) listener(this.selection, this.data, changed);
  }

  /** El rango vigente, recortado a los datos disponibles. */
  range(): DayRange {
    const meta = this.data.meta;
    const first = meta?.firstDate ?? '2000-11-01';
    const last = meta?.lastDate ?? first;
    const from = this.selection.from && this.selection.from >= first ? this.selection.from : first;
    const to = this.selection.to && this.selection.to <= last ? this.selection.to : last;
    return from <= to ? { from, to } : { from: first, to: last };
  }

  async start(initial: Partial<Selection> = {}): Promise<void> {
    Object.assign(this.selection, initial);
    try {
      [this.data.meta, this.data.limits] = await Promise.all([calendarApi.meta(), calendarApi.limits().catch(() => null)]);
    } catch (error) {
      this.fail(error);
      return;
    }
    this.completeDistrict();
    await this.loadArea();
  }

  /** Aplica una selección completa, por ejemplo al abrir un enlace compartido. */
  restore(selection: Partial<Selection>): Promise<void> {
    Object.assign(this.selection, { area: COUNTRY, from: null, to: null, metric: 'harmonized', overlay: false, buffers: 'dissolve', inspectedYear: null }, selection);
    this.completeDistrict();
    return this.loadArea();
  }

  setArea(area: AreaOfInterest): Promise<void> {
    this.selection.area = area;
    this.completeDistrict();
    return this.loadArea();
  }

  /** Un distrito que llega solo con su ubigeo (por ejemplo, desde un enlace) toma su nombre y departamento oficiales. */
  private completeDistrict(): void {
    const area = this.selection.area;
    if (area.kind !== 'district' || area.name) return;
    const found = this.data.limits?.districts.find((d) => d.ubigeo === area.ubigeo);
    if (found) this.selection.area = { ...area, name: found.name, department: found.department };
  }

  setRange(from: string | null, to: string | null): Promise<void> {
    if (from && to && from > to) [from, to] = [to, from];
    this.selection.from = from;
    this.selection.to = to;
    return this.loadRange();
  }

  setMetric(metric: Metric): Promise<void> {
    this.selection.metric = metric;
    this.emit();
    return this.loadMap();
  }

  /** Solo cambia cómo se dibujan los focos ya cargados: no pide nada a functions/. */
  setBuffers(buffers: BufferMode): void {
    this.selection.buffers = buffers;
    this.emit();
  }

  setOverlay(overlay: boolean): Promise<void> {
    this.selection.overlay = overlay;
    this.emit();
    return this.loadMap();
  }

  inspectYear(year: number): void {
    const years = this.data.calendar?.years ?? [];
    if (!years.length) return;
    this.selection.inspectedYear = Math.min(years[years.length - 1]!.year, Math.max(years[0]!.year, year));
    this.emit();
  }

  /** Cambia el área: todo se vuelve a pedir, también la serie diaria y el mes en curso. */
  private async loadArea(): Promise<void> {
    this.areaRequest?.abort();
    this.rangeRequest?.abort();
    const request = (this.areaRequest = new AbortController());
    const area = this.selection.area;
    const range = this.range();
    this.data.loading = true;
    this.data.error = null;
    this.emit();
    try {
      const [calendar, daily, anomaly, ranking, boundary] = await Promise.all([
        calendarApi.calendar(area, range, request.signal),
        calendarApi.daily(area, request.signal),
        calendarApi.anomaly(area, request.signal),
        calendarApi.ranking(range, request.signal),
        // Sin contorno el área sigue funcionando: solo no se dibuja su límite oficial.
        calendarApi.boundary(area, request.signal).catch(() => null),
      ]);
      Object.assign(this.data, { calendar, daily, anomaly, ranking, boundary, loading: false });
      this.selection.from = range.from;
      this.selection.to = range.to;
      this.selection.inspectedYear ??= calendar.years.at(-1)?.year ?? null;
      this.emit({ area: true, map: false });
      await this.loadMap(true);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Cambia solo el rango: el calendario (qué meses quedan dentro), el ranking y el mapa. */
  private async loadRange(): Promise<void> {
    this.rangeRequest?.abort();
    const request = (this.rangeRequest = new AbortController());
    const range = this.range();
    this.selection.from = range.from;
    this.selection.to = range.to;
    this.emit();
    const map = this.loadMap();
    try {
      const [calendar, ranking] = await Promise.all([
        calendarApi.calendar(this.selection.area, range, request.signal),
        calendarApi.ranking(range, request.signal),
      ]);
      Object.assign(this.data, { calendar, ranking });
      this.emit();
    } catch (error) {
      this.fail(error);
    }
    await map;
  }

  /** Pide solo las capas que la pestaña muestra: hexágonos, focos o ambos. */
  private async loadMap(areaChanged = false): Promise<void> {
    const { area, metric, overlay } = this.selection;
    const range = this.range();
    const key = JSON.stringify([area, range]);
    const wantCells = metric === 'harmonized';
    const wantPoints = metric === 'hotspots' || overlay;
    const needCells = wantCells && key !== this.cellsKey;
    const needPoints = wantPoints && key !== this.pointsKey;
    if (!needCells && !needPoints) {
      this.emit({ area: false, map: true });
      return;
    }
    this.mapRequest?.abort();
    const request = (this.mapRequest = new AbortController());
    this.data.mapLoading = true;
    this.emit();
    try {
      const [cells, points] = await Promise.all([
        needCells ? calendarApi.cells(area, range, request.signal) : Promise.resolve(null),
        needPoints ? calendarApi.points(area, range, request.signal) : Promise.resolve(null),
      ]);
      if (cells) [this.data.cells, this.cellsKey] = [cells, key];
      if (points) [this.data.points, this.pointsKey] = [points, key];
      this.data.mapLoading = false;
      this.emit({ area: areaChanged, map: true });
    } catch (error) {
      this.fail(error);
    }
  }

  /** Las capas pintadas corresponden al área y rango vigentes. */
  mapIsCurrent(layer: 'cells' | 'points'): boolean {
    return (layer === 'cells' ? this.cellsKey : this.pointsKey) === JSON.stringify([this.selection.area, this.range()]);
  }

  private fail(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return; // la reemplazó una petición más nueva
    this.data.loading = false;
    this.data.mapLoading = false;
    this.data.error = error instanceof ApiError ? error.message : t('err.generic');
    this.emit();
  }

  /** Vuelve a pintar con los mismos datos, por ejemplo al cambiar de idioma. */
  refresh(): void {
    this.emit({ area: false, map: true });
  }

  downloadUrl(file: 'hotspots.csv' | 'export.csv' | 'calendar.csv'): string {
    return calendarApi.downloadUrl(file, this.selection.area, this.range());
  }
}
