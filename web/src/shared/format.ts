import { locale, monthNames } from './i18n';

export const fmt = (value: number): string => Math.round(value).toLocaleString(locale());

/** 12 345 → "12.3k", 1 234 567 → "1.2M". Para ejes y etiquetas cortas. */
export function compact(value: number): string {
  if (value >= 1e6) return `${Math.round(value / 1e5) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`;
  return String(Math.round(value));
}

export const monthLabel = (year: number, month: number): string => `${monthNames()[month - 1]} ${year}`;
export const monthKey = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}`;

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : null;
}

/** Redondea hacia arriba a un número "bonito" para el máximo de un eje. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / power) * power;
}
