import { t } from '../../shared/i18n';

/** Contrato con functions/ (GET /api/v1/...). Los cálculos viven allí; aquí solo se muestran. */

/** Pestañas del mapa: hexágonos armonizados o focos crudos. Los eventos de fuego quedan como dato informativo. */
export type Metric = 'harmonized' | 'hotspots';

export interface Counts {
  harmonized: number;
  hotspots: number;
  events: number | null;
  eventsModis: number | null;
}

export interface MonthPoint extends Counts {
  year: number;
  month: number;
  low: number;
  high: number;
  sensor: 'MODIS' | 'VIIRS';
  lowConfidence: boolean;
}

export interface YearTotal extends Counts {
  year: number;
  low: number;
  high: number;
  partial: boolean;
  rank: number | null;
}

export interface MonthMedian {
  month: number;
  median: number;
  p10: number;
  p90: number;
  years: number;
}

export interface BurnCalendar {
  area: { kind: string; label: string };
  unit: string;
  lastDay: number;
  referenceYears: [number, number];
  range: { from: string; to: string; months: number };
  rangeSummary: Counts & { mixesSensorEras: boolean };
  series: MonthPoint[];
  years: YearTotal[];
  medians: MonthMedian[];
  levels: { names: string[]; thresholds: number[]; months: { month: number; counts: number[]; years: number }[] };
  peakSeason: { months: number[]; share: number };
}

export interface Anomaly {
  year: number;
  month: number;
  value: number;
  median: number | null;
  ratio: number | null;
  percentile: number | null;
  monthToDateDays: number | null;
  lowConfidence: boolean;
  valid: boolean;
  category: 'below' | 'normal' | 'above' | 'well_above' | null;
}

export interface RankingRow {
  department: string;
  /** Celdas H3 de ~36 km² con al menos un foco en el rango. */
  hexagons: number;
  harmonized: number;
  hotspots: number;
  events: number | null;
}

export interface ErrorStats {
  mape_pct: number;
  bias_pct: number;
}

export interface Meta {
  firstDate: string;
  lastDate: string;
  departments: string[];
  source: string;
  caveats: string[];
  validation: Record<string, Record<string, ErrorStats>> | null;
  hasHotspotPoints: boolean;
}

export interface CellProperties {
  department: string;
  harmonized: number;
  hotspots: number;
  activeDays: number;
}

export type CellCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon, CellProperties>;

export const metricLabel = (metric: Metric): string => t(`metric.${metric}.label`);
export const metricNoun = (metric: Metric): string => t(`metric.${metric}.noun`);

export const metricValue = (point: Counts, metric: Metric): number => point[metric];

/** Serie diaria densa: el valor i es del día `start` + i. Fondo de la línea de tiempo y totales del rango. */
export interface DailySeries {
  start: string;
  harmonized: number[];
  hotspots: number[];
  events: number[] | null;
}

/** Un foco crudo de FIRMS: [lon, lat, instrumento, satélite, fecha, hora UTC, confianza, FRP, día/noche]. */
export type PointRow = [number, number, 'MODIS' | 'VIIRS', string, string, string, string, number | null, string];

/** Resumen de todos los focos crudos del área y el rango (no solo de los dibujados). */
export interface PointSummary {
  total: number;
  activeDays: number;
  /** Celdas H3 de ~36 km² con al menos un foco. */
  hexagons: number;
  bySensor: Record<string, number>;
  bySatellite: Record<string, number>;
  byDaynight: Record<string, number>;
  byConfidence: Record<string, number>;
  frpMedian: number | null;
  frpMax: number | null;
  busiestDay: string | null;
  busiestCount: number;
}

/** Límites oficiales del INEI para elegir el área. */
export interface Limits {
  source: string;
  retrieved: string;
  rule: string;
  departments: { code: string; name: string }[];
  districts: { ubigeo: string; name: string; province: string; department: string }[];
}

/** Focos agrupados por día (buffer 375 m VIIRS / 1 km MODIS y disolución de los que se tocan). */
export interface EventSummary {
  total: number;
  hotspots: number;
  activeDays: number;
  busiestDay: string | null;
  busiestCount: number;
  sizes: Record<'1' | '2-5' | '6-20' | '21+', number>;
  largest: { day: string; hotspots: number; frp: number | null; lat: number; lon: number } | null;
}

export interface PointSample {
  summary: PointSummary | null;
  events: EventSummary | null;
  total: number;
  shown: number;
  truncated: boolean;
  points: PointRow[];
}

/** Rango de días elegido, ambos extremos incluidos (AAAA-MM-DD). */
export interface DayRange {
  from: string;
  to: string;
}
