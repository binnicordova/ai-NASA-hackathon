import type { PointRow } from './types';

/**
 * Agrupa los focos crudos en eventos de fuego por día, con la misma regla que src/etl/fire_events.py:
 * cada foco lleva un buffer del tamaño de su píxel (375 m VIIRS, 1 km MODIS) y dos focos del mismo día quedan en el
 * mismo evento si sus buffers se tocan (distancia ≤ suma de radios). Es la "disolución" de un SIG contada como
 * componentes conexas, sin construir polígonos.
 */

export const BUFFER_M = { VIIRS: 375, MODIS: 1000 } as const;

export interface FireEvent {
  day: string;
  hotspots: number;
  viirs: number;
  modis: number;
  frp: number;
}

export interface DailyEvents {
  /** Índice del evento de cada foco, en el mismo orden que las filas. */
  eventOf: Int32Array;
  events: FireEvent[];
}

const EARTH_R = 6_371_008.8;
const RAD = Math.PI / 180;
/** Celda de la grilla de búsqueda: el mayor alcance posible entre dos focos (1 km + 1 km). */
const CELL_M = 2 * BUFFER_M.MODIS;
const COS0 = Math.cos(-9.5 * RAD); // latitud media del Perú, solo para la grilla

export function groupDailyEvents(rows: PointRow[]): DailyEvents {
  const n = rows.length;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const grid = new Map<string, number[]>();
  rows.forEach((row, i) => {
    x[i] = EARTH_R * row[0] * RAD * COS0;
    y[i] = EARTH_R * row[1] * RAD;
    const key = `${row[4]}|${Math.floor(x[i]! / CELL_M)}|${Math.floor(y[i]! / CELL_M)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  for (let i = 0; i < n; i += 1) {
    const row = rows[i]!;
    const cx = Math.floor(x[i]! / CELL_M);
    const cy = Math.floor(y[i]! / CELL_M);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get(`${row[4]}|${cx + dx}|${cy + dy}`) ?? []) {
          if (j <= i) continue;
          const other = rows[j]!;
          const mid = Math.cos(((row[1] + other[1]) / 2) * RAD);
          const dist = Math.hypot(EARTH_R * (row[0] - other[0]) * RAD * mid, EARTH_R * (row[1] - other[1]) * RAD);
          if (dist <= BUFFER_M[row[2]] + BUFFER_M[other[2]]) parent[find(i)] = find(j);
        }
      }
    }
  }
  const index = new Map<number, number>();
  const eventOf = new Int32Array(n);
  const events: FireEvent[] = [];
  rows.forEach((row, i) => {
    const root = find(i);
    let id = index.get(root);
    if (id === undefined) {
      id = events.push({ day: row[4], hotspots: 0, viirs: 0, modis: 0, frp: 0 }) - 1;
      index.set(root, id);
    }
    const event = events[id]!;
    event.hotspots += 1;
    if (row[2] === 'VIIRS') event.viirs += 1;
    else event.modis += 1;
    event.frp += row[7] ?? 0;
    eventOf[i] = id;
  });
  return { eventOf, events };
}
