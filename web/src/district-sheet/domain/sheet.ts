import type { AreaOfInterest } from '../../area-of-interest/domain/area';
import type { Limits, PointSample } from '../../calendar/domain/types';
import { addDays } from '../../shared/format';

/**
 * Ficha del distrito: una página que un gestor de riesgos imprime, adjunta a su plan o reenvía por WhatsApp. Junta lo
 * que ya dicen el calendario armonizado, la Alerta temprana y los focos recientes; no calcula nada nuevo.
 */

/** Días que cubre el bloque de focos recientes, contando el último día con datos. */
export const RECENT_DAYS = 30;

/**
 * El ubigeo de la ficha: functions/ lo escribe en `<meta name="nasat-district">` (la dirección legible no lo lleva);
 * en desarrollo, de `?district=080601`.
 */
export function ubigeoFrom(document: Document, location: Location): string | null {
  const served = document.querySelector<HTMLMetaElement>('meta[name="nasat-district"]')?.content;
  const code = served || new URLSearchParams(location.search).get('district');
  return code && /^\d{6}$/.test(code) ? code : null;
}

/**
 * "Huánuco" → "huanuco", "Los Baños del Inca" → "los-banos-del-inca". La misma regla que `slugify` en
 * functions/src/fire_calendar/district_sheet/interfaces/urls.py: si cambia una, cambia la otra.
 */
export function slugify(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Dirección legible de la ficha: `/incendios/cusco/canchis/sicuani` o `/en/wildfires/…`. Sin provincia conocida, el
 * atajo por ubigeo, que redirige a ella.
 */
export function districtPath(area: Extract<AreaOfInterest, { kind: 'district' }>, lang: string): string {
  if (!area.province) return `/d/${area.ubigeo}${lang === 'en' ? '?lang=en' : ''}`;
  const section = lang === 'en' ? 'en/wildfires' : 'incendios';
  return `/${section}/${[area.department, area.province, area.name].map(slugify).join('/')}`;
}

/** El distrito oficial (INEI) con su provincia y su departamento, o null si el ubigeo no existe. */
export function districtArea(limits: Limits, ubigeo: string): Extract<AreaOfInterest, { kind: 'district' }> | null {
  const d = limits.districts.find((x) => x.ubigeo === ubigeo);
  return d ? { kind: 'district', ubigeo: d.ubigeo, name: d.name, department: d.department, province: d.province } : null;
}

/** Enlace que se comparte y que lleva el código QR: la dirección legible, en el idioma de la ficha. */
export const shareUrl = (origin: string, area: Extract<AreaOfInterest, { kind: 'district' }>, lang: string): string =>
  `${origin}${districtPath(area, lang)}`;

/** Los últimos RECENT_DAYS días con datos. */
export const recentRange = (lastDate: string): { from: string; to: string } => ({ from: addDays(lastDate, -(RECENT_DAYS - 1)), to: lastDate });

/** Fecha del foco más reciente: la API los devuelve del más nuevo al más viejo. */
export function latestSpot(sample: PointSample): string | null {
  const day = sample.points[0]?.[4];
  return typeof day === 'string' ? day : null;
}
