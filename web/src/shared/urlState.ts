import type { AreaOfInterest } from '../area-of-interest/domain/area';
import { mapPath, type PathLang } from '../area-of-interest/domain/paths';
import type { Selection } from '../calendar/application/calendarController';
import type { Metric } from '../calendar/domain/types';
import { isDay, monthEnd, parseMonthKey } from './format';

/**
 * La selección vive en la URL para poder compartir una vista con un enlace, y la URL se lee como una frase:
 *
 *   /mapa/cusco/canchis/sicuani?desde=2026-10-03&hasta=2026-10-07&vista=focos
 *   /en/map/cusco/canchis/sicuani?from=2026-10-03&to=2026-10-07&view=hotspots
 *
 * El área oficial va en la ruta (la que indexan los buscadores; functions/ escribe su título y su canónica); fechas,
 * pestaña y capas, en la consulta, con nombres en el idioma de la página. Se leen los dos idiomas y los enlaces
 * antiguos con fragmento (`#district=080601&from=…`), que se reescriben a la forma nueva.
 */

interface Keys {
  from: string;
  to: string;
  view: string;
  month: string;
  layer: string;
  buffers: string;
  box: string;
  polygon: string;
  hotspots: string;
  risk: string;
  overlap: string;
}

const KEYS: Record<PathLang, Keys> = {
  es: { from: 'desde', to: 'hasta', view: 'vista', month: 'mes', layer: 'capa', buffers: 'buffers', box: 'caja', polygon: 'poligono', hotspots: 'focos', risk: 'alerta', overlap: 'superpuestos' },
  en: { from: 'from', to: 'to', view: 'view', month: 'month', layer: 'layer', buffers: 'buffers', box: 'box', polygon: 'polygon', hotspots: 'hotspots', risk: 'early-warning', overlap: 'overlap' },
};

/** Lo que functions/ escribe en la página de un área oficial: el área completa, con sus nombres, y su ruta. */
interface ServedArea {
  path: string;
  area: AreaOfInterest;
}

function servedArea(): AreaOfInterest | null {
  const raw = document.querySelector<HTMLMetaElement>('meta[name="nasat-area"]')?.content;
  if (!raw) return null;
  try {
    const served = JSON.parse(raw) as ServedArea;
    // Solo vale para la página que se sirvió: después de navegar, manda la URL.
    return decodeURI(served.path) === decodeURI(location.pathname) ? served.area : null;
  } catch {
    return null;
  }
}

/** Primer y último día con datos: un rango que los cubre todos no se escribe (la dirección queda limpia y no envejece). */
export interface DataSpan {
  firstDate: string;
  lastDate: string;
}

/** La selección como URL legible. Sin los nombres del área (aún no cargan los límites), se conserva la ruta actual. */
export function urlFor(selection: Selection, lang: PathLang, span: DataSpan | null = null): string {
  const keys = KEYS[lang];
  const params = new URLSearchParams();
  const area = selection.area;
  if (area.kind === 'polygon') params.set(keys.polygon, area.ring.map(([lon, lat]) => `${lon},${lat}`).join(';'));
  if (area.kind === 'bbox') {
    const b = area.bbox;
    params.set(keys.box, [b.west, b.south, b.east, b.north].map((v) => v.toFixed(3)).join(','));
  }
  if (selection.from && selection.from !== span?.firstDate) params.set(keys.from, selection.from);
  if (selection.to && selection.to !== span?.lastDate) params.set(keys.to, selection.to);
  if (selection.risk) params.set(keys.view, keys.risk);
  else if (selection.metric === 'hotspots') params.set(keys.view, keys.hotspots);
  if (selection.risk && selection.riskMonth) params.set(keys.month, String(selection.riskMonth));
  if (selection.overlay) params.set(keys.layer, keys.hotspots);
  if (selection.buffers === 'overlap') params.set(keys.buffers, keys.overlap);
  const path = mapPath(area, lang) ?? location.pathname;
  const query = params.toString().replace(/%2C/g, ',').replace(/%3B/g, ';');
  return query ? `${path}?${query}` : path;
}

/**
 * Escribe la selección en la URL. Si cambia el área (la ruta), queda en el historial y "atrás" vuelve a la anterior;
 * los cambios de fechas o de pestaña reemplazan la entrada actual.
 */
export function writeUrlState(selection: Selection, lang: PathLang, span: DataSpan | null = null): void {
  const next = urlFor(selection, lang, span);
  const current = location.pathname + location.search;
  if (next === current && !location.hash) return;
  const newPath = next.split('?')[0] !== location.pathname;
  if (newPath && !location.hash) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

/** Enlaces anteriores: todo en el fragmento (`#department=Cusco&from=…&metric=hotspots&view=risk`). */
function readLegacy(params: URLSearchParams): Partial<Selection> {
  const state: Partial<Selection> = {};
  const department = params.get('department');
  const district = params.get('district');
  const province = params.get('province');
  if (department) state.area = { kind: 'department', department } satisfies AreaOfInterest;
  else if (province && /^\d{4}$/.test(province)) state.area = { kind: 'province', code: province, name: '', department: '' };
  else if (district && /^\d{6}$/.test(district)) state.area = { kind: 'district', ubigeo: district, name: '', department: '' };
  const ring = readRing(params.get('polygon'));
  const box = readBox(params.get('bbox'));
  if (!state.area && ring) state.area = ring;
  else if (!state.area && box) state.area = box;
  Object.assign(state, readFilters(params, { ...KEYS.en, view: 'view', risk: 'risk' }));
  if (params.get('metric') === 'hotspots') state.metric = 'hotspots' satisfies Metric;
  if (params.get('points') === '1') state.overlay = true;
  return state;
}

function readRing(text: string | null): AreaOfInterest | null {
  const ring = text?.split(';').map((pair) => pair.split(',').map(Number) as [number, number]);
  return ring && ring.length >= 3 && ring.every((p) => p.length === 2 && p.every(Number.isFinite)) ? { kind: 'polygon', ring } : null;
}

function readBox(text: string | null): AreaOfInterest | null {
  const box = text?.split(',').map(Number);
  return box && box.length === 4 && box.every(Number.isFinite)
    ? { kind: 'bbox', bbox: { west: box[0]!, south: box[1]!, east: box[2]!, north: box[3]! } }
    : null;
}

/** Fechas, pestaña, mes y capas con los nombres de un idioma. */
function readFilters(params: URLSearchParams, keys: Keys): Partial<Selection> {
  const state: Partial<Selection> = {};
  // Días AAAA-MM-DD; los enlaces antiguos con meses AAAA-MM se leen como meses completos.
  const from = params.get(keys.from) ?? '';
  const to = params.get(keys.to) ?? '';
  if (isDay(from)) state.from = from;
  else if (parseMonthKey(from)) state.from = `${from}-01`;
  if (isDay(to)) state.to = to;
  else if (parseMonthKey(to)) state.to = monthEnd(to);
  const view = params.get(keys.view);
  if (view === keys.hotspots) state.metric = 'hotspots';
  if (view === keys.risk) state.risk = true;
  if (params.get(keys.layer) === keys.hotspots) state.overlay = true;
  if (params.get(keys.buffers) === keys.overlap) state.buffers = 'overlap';
  const month = Number(params.get(keys.month));
  if (Number.isInteger(month) && month >= 1 && month <= 12) state.riskMonth = month;
  return state;
}

export function readUrlState(): Partial<Selection> {
  const hash = location.hash.replace(/^#/, '');
  if (hash.includes('=')) return readLegacy(new URLSearchParams(hash));
  const params = new URLSearchParams(location.search);
  const state: Partial<Selection> = {};
  // Las dos formas de nombrar los filtros: la página en español puede recibir un enlace en inglés y al revés.
  Object.assign(state, readFilters(params, KEYS.en), readFilters(params, KEYS.es));
  const area = servedArea() ?? readRing(params.get(KEYS.es.polygon) ?? params.get(KEYS.en.polygon)) ?? readBox(params.get(KEYS.es.box) ?? params.get(KEYS.en.box));
  if (area) state.area = area;
  return state;
}
