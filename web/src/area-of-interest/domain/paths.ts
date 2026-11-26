import type { AreaOfInterest } from './area';

/**
 * Direcciones legibles de las áreas oficiales, para buscadores y para quien lee el enlace en un mensaje:
 *
 * - Mapa: `/mapa/cusco`, `/mapa/cusco/canchis`, `/mapa/cusco/canchis/sicuani` (en inglés, `/en/map/…`). Todo el Perú es
 *   la portada `/` (`/en/map`).
 * - Ficha imprimible del distrito: `/incendios/cusco/canchis/sicuani` (`/en/wildfires/…`).
 *
 * Los nombres van de arriba abajo, como los nombra el INEI: departamento, provincia y distrito juntos son únicos (el
 * nombre del distrito solo no: 100 se repiten). Las mismas reglas están en
 * functions/src/fire_calendar/district_sheet/interfaces/urls.py: si cambia una, cambia la otra.
 */

export type PathLang = 'es' | 'en';

const MAP: Record<PathLang, string> = { es: 'mapa', en: 'en/map' };
const SHEET: Record<PathLang, string> = { es: 'incendios', en: 'en/wildfires' };

/** "Huánuco" → "huanuco", "Los Baños del Inca" → "los-banos-del-inca". */
export function slugify(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Los nombres del área de arriba abajo; null si no es un área oficial o aún le faltan nombres. */
export function placeNames(area: AreaOfInterest): string[] | null {
  if (area.kind === 'department') return area.department ? [area.department] : null;
  if (area.kind === 'province') return area.name && area.department ? [area.department, area.name] : null;
  if (area.kind === 'district') return area.name && area.department && area.province ? [area.department, area.province, area.name] : null;
  return null;
}

/** Dirección del mapa de un área: la portada para todo el Perú y para las áreas dibujadas (van en la consulta). */
export function mapPath(area: AreaOfInterest, lang: PathLang): string | null {
  if (area.kind === 'country' || area.kind === 'bbox' || area.kind === 'polygon') return lang === 'en' ? '/en/map' : '/';
  const names = placeNames(area);
  return names ? `/${MAP[lang]}/${names.map(slugify).join('/')}` : null;
}

/** Ficha imprimible del distrito; sin provincia conocida, el atajo por ubigeo, que redirige a ella. */
export function sheetPath(area: Extract<AreaOfInterest, { kind: 'district' }>, lang: PathLang): string {
  const names = placeNames(area);
  if (!names) return `/d/${area.ubigeo}${lang === 'en' ? '?lang=en' : ''}`;
  return `/${SHEET[lang]}/${names.map(slugify).join('/')}`;
}

/** "Sicuani (Canchis, Cusco)", "Canchis (Cusco)", "Cusco": el lugar como lo escribe el título de la página. */
export function placeTitle(area: AreaOfInterest): string | null {
  const names = placeNames(area);
  if (!names) return null;
  const [top, ...rest] = [...names].reverse();
  return rest.length ? `${top} (${rest.join(', ')})` : top!;
}
