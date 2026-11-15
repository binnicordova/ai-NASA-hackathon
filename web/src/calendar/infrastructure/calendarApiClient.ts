import { areaQuery, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { t } from '../../shared/i18n';
import type { Anomaly, BurnCalendar, CellCollection, Meta, RankingRow } from '../domain/types';

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

export interface Period {
  from: string | null;
  to: string | null;
}

export const calendarApi = {
  meta: (signal?: AbortSignal) => getJson<Meta>('meta', {}, signal),

  calendar: (area: AreaOfInterest, period: Period, signal?: AbortSignal) =>
    getJson<BurnCalendar>('calendar', { ...areaQuery(area), ...period }, signal),

  anomaly: (area: AreaOfInterest, month: string, signal?: AbortSignal) =>
    getJson<Anomaly>('anomaly', { ...areaQuery(area), month }, signal),

  cells: (area: AreaOfInterest, month: string, signal?: AbortSignal) =>
    getJson<CellCollection>('cells', { ...areaQuery(area), month }, signal),

  ranking: (period: Period, signal?: AbortSignal) => getJson<RankingRow[]>('ranking', { ...period }, signal),

  /** Enlaces de descarga para el área y el rango elegidos. */
  downloadUrl: (file: 'hotspots.csv' | 'export.csv' | 'calendar.csv', area: AreaOfInterest, period: Period) =>
    url(file, { ...areaQuery(area), ...period }),
};
