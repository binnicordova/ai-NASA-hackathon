/** Rampa secuencial de un solo tono (clara → oscura): legible con daltonismo. */
export const RAMP = ['#FAEEDA', '#FAC775', '#EF9F27', '#BA7517', '#854F0B', '#633806'] as const;
export const RAMP_INK = ['#633806', '#633806', '#412402', '#FAEEDA', '#FAEEDA', '#FAEEDA'] as const;
export const LEVEL_COLORS = ['#FAEEDA', '#FAC775', '#BA7517', '#633806'] as const;
export const ACCENT = '#185FA5';
export const NEUTRAL = '#B4B2A9';
export const NEUTRAL_LINE = '#888780';
export const MODIS_ERA = '#FAC775';
export const VIIRS_ERA = '#BA7517';

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
