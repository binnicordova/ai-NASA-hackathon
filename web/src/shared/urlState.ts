import type { AreaOfInterest } from '../area-of-interest/domain/area';
import type { Selection } from '../calendar/application/calendarController';
import type { Metric } from '../calendar/domain/types';
import { isDay, monthEnd, parseMonthKey } from './format';

/** La selección vive en la URL para poder compartir una vista con un enlace. */
export function writeUrlState(selection: Selection): void {
  const params = new URLSearchParams();
  if (selection.area.kind === 'department') params.set('department', selection.area.department);
  if (selection.area.kind === 'district') params.set('district', selection.area.ubigeo);
  if (selection.area.kind === 'province') params.set('province', selection.area.code);
  if (selection.area.kind === 'polygon') params.set('polygon', selection.area.ring.map(([lon, lat]) => `${lon},${lat}`).join(';'));
  if (selection.area.kind === 'bbox') {
    const b = selection.area.bbox;
    params.set('bbox', [b.west, b.south, b.east, b.north].map((v) => v.toFixed(3)).join(','));
  }
  if (selection.from) params.set('from', selection.from);
  if (selection.to) params.set('to', selection.to);
  if (selection.metric !== 'harmonized') params.set('metric', selection.metric);
  if (selection.risk) params.set('view', 'risk');
  if (selection.risk && selection.riskMonth) params.set('month', String(selection.riskMonth));
  if (selection.overlay) params.set('points', '1');
  if (selection.buffers === 'overlap') params.set('buffers', 'overlap');
  history.replaceState(null, '', `#${params.toString()}`);
}

export function readUrlState(): Partial<Selection> {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const state: Partial<Selection> = {};
  const department = params.get('department');
  const box = params.get('bbox')?.split(',').map(Number);
  const district = params.get('district');
  const province = params.get('province');
  const ring = params.get('polygon')?.split(';').map((pair) => pair.split(',').map(Number) as [number, number]);
  if (department) state.area = { kind: 'department', department } satisfies AreaOfInterest;
  else if (province && /^\d{4}$/.test(province)) state.area = { kind: 'province', code: province, name: '', department: '' };
  else if (district && /^\d{6}$/.test(district)) state.area = { kind: 'district', ubigeo: district, name: '', department: '' };
  else if (ring && ring.length >= 3 && ring.every((p) => p.length === 2 && p.every(Number.isFinite))) state.area = { kind: 'polygon', ring };
  else if (box && box.length === 4 && box.every(Number.isFinite)) {
    state.area = { kind: 'bbox', bbox: { west: box[0]!, south: box[1]!, east: box[2]!, north: box[3]! } };
  }
  // Días AAAA-MM-DD; los enlaces antiguos con meses AAAA-MM se leen como meses completos.
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (isDay(from)) state.from = from;
  else if (parseMonthKey(from)) state.from = `${from}-01`;
  if (isDay(to)) state.to = to;
  else if (parseMonthKey(to)) state.to = monthEnd(to);
  if (params.get('metric') === 'hotspots') state.metric = 'hotspots' satisfies Metric;
  if (params.get('points') === '1') state.overlay = true;
  if (params.get('buffers') === 'overlap') state.buffers = 'overlap';
  if (params.get('view') === 'risk') state.risk = true;
  const month = Number(params.get('month'));
  if (Number.isInteger(month) && month >= 1 && month <= 12) state.riskMonth = month;
  return state;
}
