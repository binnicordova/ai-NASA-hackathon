import { t } from '../../shared/i18n';

/** Área de interés: el país, un departamento o una caja dibujada o tecleada. */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type AreaOfInterest =
  | { kind: 'country' }
  | { kind: 'department'; department: string }
  | { kind: 'bbox'; bbox: BoundingBox };

export const COUNTRY: AreaOfInterest = { kind: 'country' };

/** Extensión aproximada del Perú, para encuadrar el mapa y validar cajas. */
export const PERU_BOUNDS: BoundingBox = { west: -81.4, south: -18.4, east: -68.6, north: 0.1 };

export type BoxResult = { ok: true; bbox: BoundingBox } | { ok: false; error: string };

/**
 * Valida una caja antes de enviarla. La regla definitiva vive en functions/;
 * aquí solo se da una respuesta inmediata al usuario.
 */
export function makeBoundingBox(north: number, south: number, west: number, east: number): BoxResult {
  if ([north, south, west, east].some((value) => !Number.isFinite(value))) {
    return { ok: false, error: t('err.coords.numbers') };
  }
  if (south >= north) return { ok: false, error: t('err.coords.ns') };
  if (west >= east) return { ok: false, error: t('err.coords.we') };
  if (north < PERU_BOUNDS.south || south > PERU_BOUNDS.north || east < PERU_BOUNDS.west || west > PERU_BOUNDS.east) {
    return { ok: false, error: t('err.coords.outside') };
  }
  return { ok: true, bbox: { west, south, east, north } };
}

export function areaLabel(area: AreaOfInterest): string {
  if (area.kind === 'department') return area.department;
  if (area.kind === 'bbox') {
    const b = area.bbox;
    return t('area.custom', { s: b.south.toFixed(2), w: b.west.toFixed(2), n: b.north.toFixed(2), e: b.east.toFixed(2) });
  }
  return t('area.country');
}

/** Parámetros de consulta que entiende functions/. */
export function areaQuery(area: AreaOfInterest): Record<string, string> {
  if (area.kind === 'department') return { department: area.department };
  if (area.kind === 'bbox') {
    const b = area.bbox;
    return { bbox: [b.west, b.south, b.east, b.north].map((v) => v.toFixed(4)).join(',') };
  }
  return {};
}
