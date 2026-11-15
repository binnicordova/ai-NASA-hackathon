import type { AreaOfInterest } from '../area-of-interest/domain/area';
import type { Selection } from '../calendar/application/calendarController';
import type { Metric } from '../calendar/domain/types';
import { monthKey, parseMonthKey } from './format';

/** La selección vive en la URL para poder compartir una vista con un enlace. */
export function writeUrlState(selection: Selection): void {
  const params = new URLSearchParams();
  if (selection.area.kind === 'department') params.set('department', selection.area.department);
  if (selection.area.kind === 'bbox') {
    const b = selection.area.bbox;
    params.set('bbox', [b.west, b.south, b.east, b.north].map((v) => v.toFixed(3)).join(','));
  }
  if (selection.from) params.set('from', selection.from);
  if (selection.to) params.set('to', selection.to);
  if (selection.metric !== 'harmonized') params.set('metric', selection.metric);
  if (selection.month) params.set('month', monthKey(selection.month.year, selection.month.month));
  history.replaceState(null, '', `#${params.toString()}`);
}

export function readUrlState(): Partial<Selection> {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const state: Partial<Selection> = {};
  const department = params.get('department');
  const box = params.get('bbox')?.split(',').map(Number);
  if (department) state.area = { kind: 'department', department } satisfies AreaOfInterest;
  else if (box && box.length === 4 && box.every(Number.isFinite)) {
    state.area = { kind: 'bbox', bbox: { west: box[0]!, south: box[1]!, east: box[2]!, north: box[3]! } };
  }
  const from = params.get('from');
  const to = params.get('to');
  if (from && parseMonthKey(from)) state.from = from;
  if (to && parseMonthKey(to)) state.to = to;
  const metric = params.get('metric');
  if (metric === 'hotspots' || metric === 'events') state.metric = metric as Metric;
  const month = parseMonthKey(params.get('month') ?? '');
  if (month) {
    state.month = month;
    state.inspectedYear = month.year;
  }
  return state;
}
