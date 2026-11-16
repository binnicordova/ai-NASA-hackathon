import { areaLabel, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { byId, el } from '../../shared/dom';
import { fmt } from '../../shared/format';
import { lang, locale, t, type Key } from '../../shared/i18n';
import { RAMP, RAMP_INK } from '../../shared/palette';
import type { AreaForecast, BurnCalendar, Forecast, RiskLevel } from '../domain/types';

/**
 * Alerta temprana: predicción de fuego por mes. Los eventos esperados (λ) salen de un Poisson sobre los eventos
 * MODIS del mismo mes en años anteriores (Poisson-Gamma si los años varían más); la verificación fuera de muestra
 * se muestra junto a la cifra.
 */

export type ForecastUnit = Forecast['units'][number];

const TOP = 5;

/** Nombre del mes: en español va en minúscula dentro de las frases (el título lo capitaliza con CSS). */
export function monthName(month: number): string {
  const name = new Date(2000, month - 1, 1).toLocaleString(locale(), { month: 'long' });
  return lang() === 'es' ? name.toLocaleLowerCase('es') : name;
}

export const percent = (p: number): string => `${Math.round(p * 100)} %`;

/** "diciembre de 2027" / "December 2027": el mes con el año que se predice, dentro de una frase. */
export const monthOfYear = (month: number, year: number): string => t('risk.when', { month: monthName(month), year });

const capitalize = (text: string): string => text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);

/**
 * Eventos esperados como número entero: un evento se cuenta, no se fracciona. Por debajo de medio evento se muestra 0;
 * que aun así pueda haber fuego lo dice la probabilidad de al menos uno, que va al lado.
 */
export const events = (lambda: number): string => fmt(Math.round(lambda));

/** Unidades del nivel del mapa que caen dentro del área elegida (un distrito se ve entre los de su provincia). */
export function unitsWithin(fc: Forecast, area: AreaOfInterest): ForecastUnit[] {
  if (area.kind === 'department') return fc.units.filter((u) => u.parent === area.department);
  if (area.kind === 'province') return fc.units.filter((u) => u.key.startsWith(area.code));
  if (area.kind === 'district') return fc.units.filter((u) => u.key.startsWith(area.ubigeo.slice(0, 4)));
  return fc.units;
}

/**
 * Nivel de probabilidad de ocurrencia: la probabilidad de al menos un evento ese mes (Poisson / Poisson-Gamma).
 * Franjas fijas, iguales en todos los niveles y meses, para que "alta" signifique lo mismo en un distrito y en un
 * departamento. Lo usan la etiqueta de la tarjeta, las barras de los meses, la lista y el mapa.
 */
export type ProbabilityLevel = 'high' | 'mid' | 'low' | 'none';
export const PROBABILITY_LEVELS: { level: ProbabilityLevel; from: number }[] = [
  { level: 'high', from: 0.67 },
  { level: 'mid', from: 0.33 },
  { level: 'low', from: 0.05 },
  { level: 'none', from: 0 },
];
export const probabilityLevel = (p: number): ProbabilityLevel => PROBABILITY_LEVELS.find((l) => p >= l.from)!.level;

/** Paso de la rampa de fuego de cada nivel; "casi nula" no se pinta. */
const LEVEL_STEP: Record<ProbabilityLevel, number | null> = { high: 5, mid: 3, low: 1, none: null };
/**
 * Impacto: cuántos eventos se esperan ese mes (λ redondeado). Un fuego aislado no es lo mismo que cien: el mapa se
 * pinta por impacto y la probabilidad dice qué tan seguro es que haya alguno. Juntos son la matriz de riesgo.
 * Sin color si la probabilidad de al menos un evento es casi nula.
 */
export type ImpactLevel = 'low' | 'mid' | 'high' | 'critical';
export const IMPACT_LEVELS: { level: ImpactLevel; from: number; to: number | null; step: number }[] = [
  { level: 'low', from: 0, to: 20, step: 1 },
  { level: 'mid', from: 21, to: 50, step: 3 },
  { level: 'high', from: 51, to: 100, step: 4 },
  { level: 'critical', from: 101, to: null, step: 5 },
];
export function impactLevel(lambda: number, pAny: number): ImpactLevel | null {
  if (probabilityLevel(pAny) === 'none') return null;
  const n = Math.round(lambda);
  return [...IMPACT_LEVELS].reverse().find((l) => n >= l.from)!.level;
}
const impactStep = (level: ImpactLevel): number => IMPACT_LEVELS.find((l) => l.level === level)!.step;
export const impactColor = (lambda: number, pAny: number): string | null => {
  const level = impactLevel(lambda, pAny);
  return level ? RAMP[impactStep(level)]! : null;
};

export const probabilityColor = (p: number): string | null => {
  const step = LEVEL_STEP[probabilityLevel(p)];
  return step === null ? null : RAMP[step]!;
};

/** El mismo mes del último año completo, con lo que de verdad pasó (eventos MODIS, la misma base que la predicción). */
function lastObserved(calendar: BurnCalendar | null, month: number): { year: number; events: number } | null {
  if (!calendar) return null;
  const last = calendar.series.at(-1);
  // El mes en curso está incompleto: no sirve para comparar con lo esperado en un mes entero.
  const point = [...calendar.series].reverse().find((p) => p.month === month && p !== last);
  return point && point.eventsModis !== null ? { year: point.year, events: point.eventsModis } : null;
}

export interface RiskHandlers {
  onMonth: (month: number) => void;
  onPick: (unit: ForecastUnit) => void;
}

const LEVEL_KEY: Record<RiskLevel, Key> = { department: 'risk.level.department', province: 'risk.level.province', district: 'risk.level.district' };

/**
 * Año que se predice: el siguiente al último dato. El modelo es estacional (cada mes, según el mismo mes de años
 * anteriores), así que la cifra de un mes vale para su próxima vez; la tarjeta lo presenta como el año que viene.
 */
export interface ForecastWhen {
  year: number;
  /** Último mes con datos (en curso): los meses posteriores de este año aún no empiezan. */
  lastYear: number;
  lastMonth: number;
}

export function renderRiskCard(
  area: AreaOfInterest, areaFc: AreaForecast | null, fc: Forecast | null, calendar: BurnCalendar | null, month: number, when: ForecastWhen,
  handlers: RiskHandlers,
): void {
  const { year } = when;
  const whenText = monthOfYear(month, year);
  byId('riskTitle').textContent = t('risk.title', { year });
  byId('riskIntro').textContent = t('risk.intro', { year, area: areaLabel(area) });
  byId('riskMonthLabel').textContent = capitalize(`${monthName(month)} ${year}`);
  // Lo que queda de este año (p. ej. diciembre, si los datos llegan a noviembre) tiene la misma predicción.
  const also = byId('riskAlso');
  also.hidden = month <= when.lastMonth;
  if (!also.hidden) also.textContent = t('risk.also', { when: monthOfYear(month, when.lastYear) });
  const point = areaFc?.months[month - 1];
  const peak = Math.max(...(areaFc?.months.map((m) => m.expected) ?? [0]), 0);
  const level = point ? probabilityLevel(point.pAny) : 'none';
  byId('riskHero').dataset.level = level;
  byId('riskLevelBadge').textContent = t(`risk.prob.${level}` as Key);
  const impact = point ? impactLevel(point.expected, point.pAny) : null;
  const impactBadge = byId('riskImpactBadge');
  impactBadge.hidden = !impact;
  if (impact) {
    impactBadge.textContent = t(`risk.impact.${impact}` as Key);
    impactBadge.style.cssText = `background:${RAMP[impactStep(impact)]!};color:${RAMP_INK[impactStep(impact)]!}`;
  }
  // La cifra grande es la que más informa: los eventos esperados si son al menos uno; si redondean a 0, la
  // probabilidad de que haya alguno.
  const rare = !!point && Math.round(point.expected) === 0;
  byId('riskExpected').textContent = !point ? '–' : rare ? percent(point.pAny) : events(point.expected);
  byId('riskExpectedLabel').textContent = t(rare ? 'risk.any.long' : 'risk.expected');
  byId('riskSecondLabel').textContent = t(rare ? 'risk.expected.short' : 'risk.any');
  byId('riskSecond').title = t(rare ? 'risk.expected.tip' : 'risk.any.tip');
  // Una frase que se lee sola: lo esperado y lo que pasa 8 de cada 10 años.
  const summaryKey: Key = !point ? 'risk.summary' : point.expected === 0 || point.pAny < 0.05 ? 'risk.summary.none' : rare ? 'risk.summary.rare' : 'risk.summary';
  byId('riskSummary').textContent = point
    ? t(summaryKey, { when: whenText, area: areaLabel(area), e: events(point.expected), lo: fmt(point.low), hi: fmt(point.high), p: percent(point.pAny) })
    : '';
  // Contraste con la realidad: el último mes igual que ya terminó, dentro o fuera del rango esperado.
  const observed = point ? lastObserved(calendar, month) : null;
  const lastLine = byId('riskLast');
  lastLine.hidden = !observed;
  if (observed && point) {
    const where = observed.events < point.low ? 'below' : observed.events > point.high ? 'above' : 'within';
    lastLine.dataset.where = where;
    lastLine.textContent = t(`risk.last.${where}` as Key, {
      month: monthName(month), year: observed.year, n: fmt(observed.events), ev: t(observed.events === 1 ? 'risk.event.one' : 'risk.event.many'),
    });
  }
  byId('riskAny').textContent = !point ? '–' : rare ? events(point.expected) : percent(point.pAny);
  byId('riskRange').textContent = point ? `${fmt(point.low)}–${fmt(point.high)}` : '–';
  byId('riskHits').textContent = point ? `${point.yearsWithEvents}/${point.years}` : '–';

  // El año entero de un vistazo: total esperado, el mes más activo y el más tranquilo.
  byId('riskYearTitle').textContent = t('risk.year.title', { year });
  const months = areaFc?.months ?? [];
  if (months.length) {
    const busiest = months.reduce((a, b) => (b.expected > a.expected ? b : a));
    const quietest = months.reduce((a, b) => (b.expected < a.expected ? b : a));
    byId('riskYearSummary').textContent = t('risk.year.summary', {
      total: events(months.reduce((sum, m) => sum + m.expected, 0)),
      peak: monthName(busiest.month), pe: events(busiest.expected), low: monthName(quietest.month), le: events(quietest.expected),
    });
  } else byId('riskYearSummary').textContent = '';

  // Los doce meses del área: el alto son los eventos esperados; el seleccionado se marca.
  const top = Math.max(peak, 1e-9);
  byId('riskMonths').replaceChildren(
    ...(areaFc?.months ?? []).map((m) => {
      const tip = `${capitalize(monthOfYear(m.month, year))} · ${t(`risk.prob.${probabilityLevel(m.pAny)}` as Key)} · ${t('risk.tip', { e: events(m.expected), p: percent(m.pAny) })}`;
      const button = el('button', { type: 'button', className: 'risk-month-bar', title: tip });
      button.setAttribute('aria-pressed', String(m.month === month));
      button.dataset.level = probabilityLevel(m.pAny);
      button.setAttribute('aria-label', tip);
      button.append(
        el('span', { className: 'risk-month-fill', style: `height:${Math.max((m.expected / top) * 100, m.expected ? 3 : 0)}%` }),
        el('span', { className: 'risk-month-name', textContent: monthName(m.month).slice(0, 1).toUpperCase() }),
      );
      button.addEventListener('click', () => handlers.onMonth(m.month));
      return button;
    }),
  );

  // Las unidades que muestra el mapa, de mayor a menor impacto (eventos esperados; a igualdad, más probabilidad).
  const block = byId('riskTopBlock');
  const units = fc ? unitsWithin(fc, area) : [];
  block.hidden = !fc || units.length < 2;
  if (fc && units.length >= 2) {
    byId('riskTopTitle').textContent = t('risk.top', { level: t(LEVEL_KEY[fc.level]), when: whenText });
    const i = month - 1;
    const top = [...units].sort((a, b) => b.expected[i]! - a.expected[i]! || b.pAny[i]! - a.pAny[i]! || a.name.localeCompare(b.name, 'es')).slice(0, TOP);
    // En todo el Perú hace falta la jerarquía (departamento › provincia); dentro de un área ya está en el encabezado.
    const showParent = area.kind === 'country' || area.kind === 'bbox' || area.kind === 'polygon';
    byId('riskTop').replaceChildren(
      ...top.map((u) => {
        const lambda = u.expected[i]!;
        const p = u.pAny[i]!;
        const impact = impactLevel(lambda, p);
        const step = impact ? impactStep(impact) : null;
        const go = el('button', { type: 'button', className: 'link', textContent: u.name });
        go.addEventListener('click', () => handlers.onPick(u));
        return el('li', {},
          go,
          el('span', { className: 'muted small', textContent: showParent && u.parent ? ` · ${u.parent}` : '' }),
          el('span', { className: 'muted small risk-any', textContent: percent(p) }),
          el('b', {
            className: 'risk-pill',
            title: `${impact ? `${t(`risk.impact.${impact}` as Key)} · ` : ''}${t(`risk.prob.${probabilityLevel(p)}` as Key)} · ${t('risk.tip', { e: events(lambda), p: percent(p) })}`,
            textContent: t('risk.top.events', { e: events(lambda) }),
            style: step === null ? '' : `background:${RAMP[step]!};color:${RAMP_INK[step]!}`,
          }),
        );
      }),
    );
  }

  const check = fc?.check;
  byId('riskCheck').textContent = check
    ? t('risk.check', {
      level: t(LEVEL_KEY[fc!.level]).toLowerCase(), a: check.train[0], b: check.train[1], c: check.test[0], d: check.test[1],
      skill: Math.round(check.skill * 100), cov: Math.round(check.coverage * 100), pcov: Math.round(check.poissonCoverage * 100),
      disp: check.dispersion.toFixed(1).replace('.', lang() === 'es' ? ',' : '.'),
    })
    : '';
}

/** Leyenda del mapa: el impacto (eventos esperados) por categoría, de más a menos. */
export function renderRiskLegend(month: number, year: number): void {
  byId('legendRiskTitle').textContent = t('map.key.risk', { when: monthOfYear(month, year) });
  byId('riskSteps').replaceChildren(
    ...[...IMPACT_LEVELS].reverse().map((l) =>
      el('span', { className: 'row risk-legend-item' },
        el('span', { className: 'risk-swatch', style: `background:${RAMP[l.step]!}` }),
        el('span', { className: 'small', textContent: `${t(`risk.impact.${l.level}` as Key)} (${l.to === null ? `> ${l.from - 1}` : `${l.from}–${l.to}`})` }))),
  );
}
