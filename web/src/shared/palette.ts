import { cssToken } from './dom';

/**
 * Colores de datos del tema activo. Se declaran en `styles.css` y aquí solo se leen, una vez al cargar:
 * si el sistema cambia de tema, `main.ts` recarga la página.
 */
const FIRE_STEPS = [1, 2, 3, 4, 5, 6];

/** Rampa de calor secuencial de poco a mucho fuego (amarillo pálido → rojo oscuro), igual en los dos temas. */
export const RAMP: readonly string[] = FIRE_STEPS.map((step) => cssToken(`--fire-${step}`));
/** Cómo se ve cada extremo de la rampa, para describirla con palabras. */
export const LOW_TONE = 'light' as const;
export const HIGH_TONE = 'dark' as const;
/** Tinta legible sobre cada paso de la rampa. */
export const RAMP_INK: readonly string[] = FIRE_STEPS.map((step) => cssToken(`--fire-ink-${step}`));
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
