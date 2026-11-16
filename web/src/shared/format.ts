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

// --- días ------------------------------------------------------------------------
// Las fechas viajan como AAAA-MM-DD y se cuentan en UTC para que el huso horario del navegador no mueva un día.

const DAY_MS = 86_400_000;

export const dayNumber = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

export const isoFromNumber = (n: number): string => new Date(Math.round(n) * DAY_MS).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string => isoFromNumber(dayNumber(iso) + days);

export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from) + 1;

export const isDay = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(dayNumber(text));

/** Último día del mes `AAAA-MM`. */
export function monthEnd(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return isoFromNumber(Date.UTC(year, month, 0) / DAY_MS);
}

/** "15 sep 2024": fecha corta en el idioma de la interfaz. */
export function dayLabel(iso: string): string {
  const [year, month, day] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
  return `${day} ${monthNames()[month - 1]} ${year}`;
}

/** "Sep 2024 – Nov 2024" si el rango son meses completos; si no, con días. */
export function rangeLabel(from: string, to: string): string {
  const wholeMonths = from.endsWith('-01') && to === monthEnd(to.slice(0, 7));
  if (wholeMonths) {
    const a = monthLabel(Number(from.slice(0, 4)), Number(from.slice(5, 7)));
    const b = monthLabel(Number(to.slice(0, 4)), Number(to.slice(5, 7)));
    return a === b ? a : `${a} – ${b}`;
  }
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}
