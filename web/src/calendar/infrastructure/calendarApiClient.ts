import { areaQuery, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { t } from '../../shared/i18n';
import type { Anomaly, BurnCalendar, CellCollection, DailySeries, DayRange, Limits, Meta, PointSample, RankingRow } from '../domain/types';

/** Base de functions/. Vacío = mismo origen (proxy de Vite en desarrollo, mismo servidor en producción). */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {}

function url(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return `${API_BASE}/api/v1/${path}${text ? `?${text}` : ''}`;
}

async function getJson<T>(path: string, params: Record<string, string | null | undefined>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url(path, params), { signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(t('api.unreachable'));
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? t('api.status', { status: response.status }));
  }
  return (await response.json()) as T;
}

/** Límite de focos crudos por petición: más que eso satura el navegador sin aportar a la lectura. */
export const POINT_LIMIT = 30_000;

export const calendarApi = {
  meta: (signal?: AbortSignal) => getJson<Meta>('meta', {}, signal),

  /** El calendario es mensual: el rango de días se lleva a los meses que toca. */
  calendar: (area: AreaOfInterest, range: DayRange, signal?: AbortSignal) =>
    getJson<BurnCalendar>('calendar', { ...areaQuery(area), from: range.from.slice(0, 7), to: range.to.slice(0, 7) }, signal),

  limits: (signal?: AbortSignal) => getJson<Limits>('limits', {}, signal),

  /** Contorno oficial del departamento o distrito; `null` para el resto de áreas. */
  boundary: (area: AreaOfInterest, signal?: AbortSignal): Promise<GeoJSON.Feature | null> =>
    area.kind === 'department' || area.kind === 'district' ? getJson<GeoJSON.Feature>('boundary', areaQuery(area), signal) : Promise.resolve(null),

  daily: (area: AreaOfInterest, signal?: AbortSignal) => getJson<DailySeries>('daily', { ...areaQuery(area) }, signal),

  /** Sin mes: el mes en curso frente a su mediana histórica. */
  anomaly: (area: AreaOfInterest, signal?: AbortSignal) => getJson<Anomaly>('anomaly', { ...areaQuery(area) }, signal),

  cells: (area: AreaOfInterest, range: DayRange, signal?: AbortSignal) =>
    getJson<CellCollection>('cells', { ...areaQuery(area), ...range }, signal),

  points: (area: AreaOfInterest, range: DayRange, signal?: AbortSignal) =>
    getJson<PointSample>('points', { ...areaQuery(area), ...range, limit: String(POINT_LIMIT) }, signal),

  ranking: (range: DayRange, signal?: AbortSignal) => getJson<RankingRow[]>('ranking', { ...range }, signal),

  /** Enlaces de descarga para el área y el rango elegidos. */
  downloadUrl: (file: 'hotspots.csv' | 'export.csv' | 'calendar.csv', area: AreaOfInterest, range: DayRange) =>
    url(file, { ...areaQuery(area), ...range }),
};
