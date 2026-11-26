import type { AreaOfInterest } from '../../area-of-interest/domain/area';
import type { Limits, PointSample } from '../../calendar/domain/types';
import { addDays } from '../../shared/format';

/**
 * Ficha del distrito: una página que un gestor de riesgos imprime, adjunta a su plan o reenvía por WhatsApp. Junta lo
 * que ya dicen el calendario armonizado, la Alerta temprana y los focos recientes; no calcula nada nuevo.
 */

/** Días que cubre el bloque de focos recientes, contando el último día con datos. */
export const RECENT_DAYS = 30;

/** El ubigeo de la ficha: de la ruta corta `/d/080601` o, en desarrollo, de `?district=080601`. */
export function ubigeoFrom(location: Location): string | null {
  const fromPath = /^\/d\/(\d{6})\/?$/.exec(location.pathname)?.[1];
  const fromQuery = new URLSearchParams(location.search).get('district');
  const code = fromPath ?? fromQuery;
  return code && /^\d{6}$/.test(code) ? code : null;
}

/** El distrito oficial (INEI) con su provincia y su departamento, o null si el ubigeo no existe. */
export function districtArea(limits: Limits, ubigeo: string): Extract<AreaOfInterest, { kind: 'district' }> | null {
  const d = limits.districts.find((x) => x.ubigeo === ubigeo);
  return d ? { kind: 'district', ubigeo: d.ubigeo, name: d.name, department: d.department, province: d.province } : null;
}

/** Enlace corto que se comparte (y que lleva el código QR). En inglés, con `?lang=en`. */
export const shareUrl = (origin: string, ubigeo: string, lang: string): string => `${origin}/d/${ubigeo}${lang === 'en' ? '?lang=en' : ''}`;

/** Los últimos RECENT_DAYS días con datos. */
export const recentRange = (lastDate: string): { from: string; to: string } => ({ from: addDays(lastDate, -(RECENT_DAYS - 1)), to: lastDate });

/** Fecha del foco más reciente: la API los devuelve del más nuevo al más viejo. */
export function latestSpot(sample: PointSample): string | null {
  const day = sample.points[0]?.[4];
  return typeof day === 'string' ? day : null;
}
