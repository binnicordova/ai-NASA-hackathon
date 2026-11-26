import type { AreaOfInterest } from '../../area-of-interest/domain/area';
import type { AreaForecast, BurnCalendar, DailySeries, Meta, MonthForecast, PointSummary, YearTotal } from '../../calendar/domain/types';
import { addDays, dayNumber } from '../../shared/format';

/**
 * Caso de muestra: el incendio de Sicuani (Canchis, Cusco), del 3 al 7 de octubre de 2026. Sicuani figura con riesgo
 * muy alto en el Plan Multisectorial 2025–2027 (anexo 4, fila 199) y ardió igual.
 *
 * Aquí solo están el lugar, los días y las fuentes: las cifras que cuenta el recorrido llegan de functions/ al recorrerlo,
 * así coinciden con lo que muestra la app.
 */
export const SICUANI = {
  area: { kind: 'district', ubigeo: '080601', name: 'Sicuani', department: 'Cusco', province: 'Canchis' } satisfies AreaOfInterest,
  from: '2026-10-03',
  to: '2026-10-07',
  /** El video de 30 s del caso en YouTube, en el idioma de la interfaz. */
  video: { es: 'xsZsKkPtBvs', en: 'dJ5Ccd7tOqI' },
  /** Plan Multisectorial 2025–2027, anexo 4: la lista de distritos con riesgo muy alto (CENEPRED, SIGRID). */
  riskList: 'https://sigrid.cenepred.gob.pe/sigridv3/documento/18524/descargar',
  /** La publicación que invita a autoridades y medios a pedir el calendario de su distrito. */
  contact: 'https://www.linkedin.com/feed/update/urn:li:activity:7531011270389698561/',
};

/** S-NPP, el primer satélite con VIIRS, empezó a enviar focos en enero de 2012: antes solo miraba MODIS. */
const FIRST_VIIRS_YEAR = 2012;

/** Por debajo de esta probabilidad, un mes es de fuego casi nulo (el mismo umbral que la Alerta temprana). */
const NEARLY_NONE = 0.05;

/** Focos de cada sensor en el rango: del resumen de todos los focos, no solo de los dibujados. */
export function sensorCounts(summary: PointSummary | null): { viirs: number; modis: number } | null {
  return summary ? { viirs: summary.bySensor.VIIRS ?? 0, modis: summary.bySensor.MODIS ?? 0 } : null;
}

/** Días del rango con al menos un foco, según la serie diaria del área. */
export function activeDays(daily: DailySeries, from: string, to: string): { active: number; days: number } {
  const start = dayNumber(daily.start);
  const [first, last] = [dayNumber(from), dayNumber(to)];
  let active = 0;
  for (let day = first; day <= last; day += 1) if ((daily.hotspots[day - start] ?? 0) > 0) active += 1;
  return { active, days: last - first + 1 };
}

/**
 * El año del caso frente al año de más actividad armonizada de la era solo MODIS. Contando focos crudos, el del caso
 * parece mucho peor porque hoy miran más satélites; la actividad armonizada dice cuál tuvo de verdad más fuego.
 */
export function rawVersusHarmonized(calendar: BurnCalendar, year: number): { year: YearTotal; reference: YearTotal } | null {
  const target = calendar.years.find((y) => y.year === year);
  const modisOnly = calendar.years.filter((y) => y.year < FIRST_VIIRS_YEAR && !y.partial);
  if (!target || !modisOnly.length) return null;
  const reference = modisOnly.reduce((best, y) => (y.harmonized > best.harmonized ? y : best));
  return reference.harmonized > 0 ? { year: target, reference } : null;
}

/**
 * Puesto de un mes entre ese mismo mes de todos los años, por actividad armonizada (1 = el de más fuego), y el primer
 * año de la serie con ese mes.
 */
export function monthRank(calendar: BurnCalendar, year: number, month: number): { rank: number; since: number } | null {
  const same = calendar.series.filter((p) => p.month === month);
  const target = same.find((p) => p.year === year);
  if (!target) return null;
  return { rank: 1 + same.filter((p) => p.harmonized > target.harmonized).length, since: Math.min(...same.map((p) => p.year)) };
}

/** El mes con más probabilidad de al menos un evento: el que la Alerta temprana muestra primero en el recorrido. */
export function peakMonth(forecast: AreaForecast): MonthForecast | null {
  const months = forecast.months.filter((m) => m.pAny >= NEARLY_NONE);
  return months.length ? months.reduce((best, m) => (m.pAny > best.pAny ? m : best)) : null;
}

/** Los meses que conviene vigilar: la misma regla que la ficha del distrito y su vista previa. */
export { watchMonths } from '../../calendar/domain/watch';

/** Nombre de cada fuente en `meta.tail.lastObservation`: MODIS va en Terra y Aqua; VIIRS, en NOAA-20 y NOAA-21. */
const SATELLITES: Record<string, string> = { MODIS: 'MODIS', N20: 'NOAA-20', N21: 'NOAA-21', SNPP: 'S-NPP' };

/**
 * La detección más reciente de los datos que se refrescan solos (FIRMS casi en tiempo real, revisado cada 15 minutos).
 * null si la app solo sirve la base sin refresco: entonces el recorrido no habla de vigilancia en vivo.
 */
export function latestDetection(meta: Meta | null): { satellite: string; at: Date } | null {
  const seen = Object.entries(meta?.tail?.lastObservation ?? {})
    .map(([key, iso]) => ({ satellite: SATELLITES[key] ?? key, at: new Date(iso) }))
    .filter((d) => !Number.isNaN(d.at.getTime()));
  return seen.length ? seen.reduce((a, b) => (b.at > a.at ? b : a)) : null;
}

/** Los dos últimos días con datos (el último suele estar en curso): lo más reciente que vieron los satélites. */
export const latestDays = (lastDate: string): { from: string; to: string } => ({ from: addDays(lastDate, -1), to: lastDate });
