import { cssToken } from './dom';

/**
 * Colores de datos del tema activo. Se declaran en `styles.css` y aquí solo se leen, una vez al cargar:
 * si el sistema cambia de tema, `main.ts` recarga la página.
 */
const FIRE_STEPS = [1, 2, 3, 4, 5, 6];
const lowToHigh = <T>(steps: T[]): T[] => (cssToken('--ramp-order') === 'reversed' ? steps.reverse() : steps);

/** Rampa secuencial de poco a mucho fuego: el valor más alto es el color más alejado del fondo. */
export const RAMP: readonly string[] = lowToHigh(FIRE_STEPS.map((step) => cssToken(`--fire-${step}`)));
/** Cómo se ve cada extremo de la rampa en el tema activo, para describirla con palabras. */
export const [LOW_TONE, HIGH_TONE] = lowToHigh<'dark' | 'light'>(['dark', 'light']);
/** Tinta legible sobre cada paso de la rampa. */
export const RAMP_INK: readonly string[] = lowToHigh(FIRE_STEPS.map((step) => cssToken(`--fire-ink-${step}`)));
/** Los cuatro niveles de actividad usan pasos alternos de la misma rampa. */
export const LEVEL_COLORS: readonly string[] = [0, 2, 3, 5].map((step) => RAMP[step]!);
export const ACCENT = cssToken('--acc');
export const NEUTRAL = cssToken('--c-neutral');
export const NEUTRAL_LINE = cssToken('--c-neutral-line');
export const MODIS_ERA = cssToken('--c-modis');
export const VIIRS_ERA = cssToken('--c-viirs');

/** Cortes por cuantiles para repartir los valores en la rampa. */
export function quantileBreaks(values: number[], quantiles = [0.3, 0.5, 0.7, 0.85, 0.95]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return quantiles.map((q) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0);
}

export function rampIndex(value: number, breaks: number[]): number {
  let index = 0;
  while (index < breaks.length && value > breaks[index]!) index += 1;
  return index;
}
