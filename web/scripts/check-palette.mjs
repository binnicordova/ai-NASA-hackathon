/**
 * Comprueba la rampa de fuego declarada en `src/styles.css`: contraste de la tinta (WCAG 2),
 * separación entre pasos contiguos (ΔE en OKLab) y lo mismo bajo daltonismo simulado
 * (Machado, Oliveira y Fernandes, 2009, severidad 1.0). Es una simulación, no una prueba con personas.
 *
 * Uso: npm run check:palette
 */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const declared = Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].reverse().map((m) => [m[1], m[2].trim()]));
/** Valor de un token del tema base, siguiendo las referencias `var(--…)`. */
const token = (name) => {
  const value = declared[name];
  if (!value) throw new Error(`Falta el token ${name}`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? token(ref[1]) : value;
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const lightness = (color) => 116 * Math.cbrt(luminance(color)) - 16;
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const deltaE = (a, b) => 100 * Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));

const VISION = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const seenAs = (color, matrix) => matrix.map((row) => Math.min(1, Math.max(0, row.reduce((sum, k, i) => sum + k * color[i], 0))));

const STEPS = [1, 2, 3, 4, 5, 6];
const fire = STEPS.map((step) => rgb(token(`--fire-${step}`)).map(linear));
const ink = STEPS.map((step) => rgb(token(`--fire-ink-${step}`)).map(linear));
let ok = true;

console.log('Tinta sobre cada paso (mínimo 4.5:1)');
STEPS.forEach((step, i) => {
  const ratio = contrast(fire[i], ink[i]);
  ok &&= ratio >= 4.5;
  console.log(`  --fire-${step} ${token(`--fire-${step}`)}  ${ratio.toFixed(1)}:1`);
});

console.log('\nPasos contiguos: luminosidad L* (debe crecer) y ΔE OKLab');
for (const [name, matrix] of Object.entries(VISION)) {
  const seen = fire.map((color) => seenAs(color, matrix));
  const steps = seen.slice(1).map((color, i) => deltaE(color, seen[i]));
  const monotonic = seen.slice(1).every((color, i) => lightness(color) > lightness(seen[i]));
  ok &&= monotonic;
  console.log(`  ${name.padEnd(13)} L* ${seen.map((c) => lightness(c).toFixed(0)).join(' ')} · ΔE ${steps.map((d) => d.toFixed(1)).join(' ')} · mínimo ${Math.min(...steps).toFixed(1)}${monotonic ? '' : ' · NO MONÓTONA'}`);
}

if (!ok) {
  console.error('\nLa rampa no cumple.');
  process.exit(1);
}
console.log('\nLa rampa cumple.');
