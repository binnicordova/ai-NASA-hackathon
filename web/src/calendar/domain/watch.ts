import type { AreaForecast, MonthForecast } from './types';

/** Por debajo de esta probabilidad de fuego, un mes no se vigila (la franja "casi nula" de la Alerta temprana). */
export const WATCH_FLOOR = 0.05;

/**
 * Los meses que conviene vigilar: los `count` de más probabilidad de fuego (al menos WATCH_FLOOR), en el orden del año.
 * Es la misma regla que `watch_months` en functions/src/fire_calendar/district_sheet/domain/services.py (la que
 * escribe la vista previa del enlace compartido): si cambia una, cambia la otra.
 */
export function watchMonths(forecast: AreaForecast, count = 3): MonthForecast[] {
  return forecast.months
    .filter((m) => m.pAny >= WATCH_FLOOR)
    .sort((a, b) => b.pAny - a.pAny || a.month - b.month)
    .slice(0, count)
    .sort((a, b) => a.month - b.month);
}
