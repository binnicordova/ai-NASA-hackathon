import { t } from '../../shared/i18n';

/** Área de interés: el país, un departamento o distrito oficial (INEI), una caja o un polígono dibujado. */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Vértice [lon, lat]. */
export type LonLat = [number, number];

export type AreaOfInterest =
  | { kind: 'country' }
  | { kind: 'department'; department: string }
  | { kind: 'district'; ubigeo: string; name: string; department: string }
  | { kind: 'bbox'; bbox: BoundingBox }
  | { kind: 'polygon'; ring: LonLat[] };

/** Máximo de vértices que se envían a functions/ (que acepta hasta 500). */
const MAX_VERTICES = 300;

/** Simplificación Douglas-Peucker de un trazo; sube la tolerancia hasta quedar bajo el máximo de vértices. */
export function simplifyRing(points: LonLat[], tolerance = 0.002): LonLat[] {
  const dp = (pts: LonLat[], tol: number): LonLat[] => {
    if (pts.length < 3) return pts;
    const [x1, y1] = pts[0]!;
    const [x2, y2] = pts[pts.length - 1]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const norm = Math.hypot(dx, dy) || 1e-12;
    let far = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const [x, y] = pts[i]!;
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm;
      if (d > far) [far, index] = [d, i];
    }
    if (far <= tol) return [pts[0]!, pts[pts.length - 1]!];
    return [...dp(pts.slice(0, index + 1), tol).slice(0, -1), ...dp(pts.slice(index), tol)];
  };
  let tol = tolerance;
  let out = dp(points, tol);
  while (out.length > MAX_VERTICES) out = dp(points, (tol *= 2));
  return out.map(([lon, lat]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))] as LonLat);
}

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
  if (area.kind === 'district') return t('area.districtLabel', { name: area.name, dept: area.department });
  if (area.kind === 'polygon') return t('area.polygonLabel', { n: area.ring.length });
  if (area.kind === 'bbox') {
    const b = area.bbox;
    return t('area.custom', { s: b.south.toFixed(2), w: b.west.toFixed(2), n: b.north.toFixed(2), e: b.east.toFixed(2) });
  }
  return t('area.country');
}

/** Parámetros de consulta que entiende functions/. */
export function areaQuery(area: AreaOfInterest): Record<string, string> {
  if (area.kind === 'department') return { department: area.department };
  if (area.kind === 'district') return { district: area.ubigeo };
  if (area.kind === 'polygon') return { polygon: area.ring.map(([lon, lat]) => `${lon},${lat}`).join(';') };
  if (area.kind === 'bbox') {
    const b = area.bbox;
    return { bbox: [b.west, b.south, b.east, b.north].map((v) => v.toFixed(4)).join(',') };
  }
  return {};
}
