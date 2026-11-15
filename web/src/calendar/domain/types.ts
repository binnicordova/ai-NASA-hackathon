import { t } from '../../shared/i18n';

/** Contrato con functions/ (GET /api/v1/...). Los cálculos viven allí; aquí solo se muestran. */

export type Metric = 'harmonized' | 'hotspots' | 'events';

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

export const metricValue = (point: Counts, metric: Metric): number =>
  metric === 'events' ? (point.events ?? 0) : point[metric];
