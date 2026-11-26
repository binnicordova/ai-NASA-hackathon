import { areaLabel, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { byId, el } from '../../shared/dom';
import { fmt } from '../../shared/format';
import { lang, locale, t, type Key } from '../../shared/i18n';
import { RAMP, RAMP_INK } from '../../shared/palette';
import type { AreaForecast, BurnCalendar, Forecast, MonthForecast, RiskLevel } from '../domain/types';

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

/** "48 %" con espacio que no se parte: el número y el signo van siempre en la misma línea. */
export const percent = (p: number): string => `${Math.round(p * 100)}\u00a0%`;

/** "diciembre de 2027" / "December 2027": el mes con el año que se predice, dentro de una frase. */
export const monthOfYear = (month: number, year: number): string => t('risk.when', { month: monthName(month), year });

const capitalize = (text: string): string => text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);

/**
 * Eventos esperados como número entero: un evento se cuenta, no se fracciona. Por debajo de medio evento se muestra 0;
 * que aun así pueda haber fuego lo dice la probabilidad de al menos uno, que va al lado.
 */
export const events = (lambda: number): string => fmt(Math.round(lambda));

/**
 * Un solo evento puede darse en cualquier parte. Si el rango del 80 % incluye el cero (puede no haber fuego), lo que
 * informa es la probabilidad de que haya y cuántos eventos serían si lo hay; "1 evento esperado" diría poco y, en los
 * distritos, más de la mitad de esos meses no tuvo ninguno (2021–2025). Si el rango no incluye el cero, habrá fuego
 * casi seguro: entonces sí, cuántos eventos.
 */
export const countIsTheNews = (low: number): boolean => low >= 1;

/** Lo que se dice de un mes en las ventanas y la lista: eventos esperados si habrá fuego, si no, su probabilidad. */
export const forecastTip = (lambda: number, p: number, low: number): string =>
  countIsTheNews(low) ? t('risk.tip', { e: events(lambda), p: percent(p) }) : t('risk.tip.maybe', { p: percent(p) });

/** "1 evento", "3 eventos" o "de 1 a 2 eventos". */
function countRange(a: number, b: number): string {
  return a === b ? `${fmt(a)} ${t(a === 1 ? 'risk.event.one' : 'risk.event.many')}` : t('risk.count.range', { a: fmt(a), b: fmt(b) });
}

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

/**
 * La historia detrás de la cifra: los eventos de ese mes en cada año del ajuste y, aparte y con contorno, el último
 * año, que no se usó para ajustar. La franja es el rango del 80 %: se ve cuántos años cayeron dentro sin leer cifras.
 */
function renderHistory(point: MonthForecast, from: number, observed: { year: number; events: number } | null, month: number): void {
  const years = point.history.map((n, i) => ({ year: from + i, n, latest: false }));
  const lastFitted = from + point.history.length - 1;
  if (observed && observed.year > lastFitted) years.push({ year: observed.year, n: observed.events, latest: true });
  if (!years.length) return;
  // Un poco de aire sobre la franja, para que se vea dónde termina el rango.
  const top = Math.max(point.high * 1.25, ...years.map((y) => y.n), 1);
  const share = (n: number): string => `${Math.min((n / top) * 100, 100).toFixed(1)}%`;
  const name = capitalize(monthName(month));
  byId('riskHistoryBars').replaceChildren(
    el('span', { className: 'risk-history-band', style: `bottom:${share(point.low)};height:${share(point.high - point.low)}` }),
    ...years.map((y) => {
      const bar = el('span', { className: 'risk-history-bar', title: `${name} ${y.year}: ${fmt(y.n)} ${t(y.n === 1 ? 'risk.event.one' : 'risk.event.many')}` });
      bar.dataset.where = y.n < point.low ? 'below' : y.n > point.high ? 'above' : 'within';
      if (y.latest) bar.dataset.latest = '';
      bar.append(el('span', { className: 'risk-history-fill', style: `height:${y.n ? share(y.n) : '0'}` }));
      return bar;
    }),
  );
  const first = years[0]!.year;
  const last = years.at(-1)!.year;
  byId('riskHistoryFrom').textContent = String(first);
  byId('riskHistoryTo').textContent = String(last);
  byId('riskHistoryLabel').textContent = t('risk.history', { month: name });
  byId('riskHistory').setAttribute('aria-label', t('risk.history.aria', { month: name, a: first, b: last }));
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
  // La cifra grande es la que más informa (ver `countIsTheNews`): los eventos esperados si habrá fuego casi seguro;
  // si puede no haberlo, la probabilidad de que haya.
  const counted = !!point && countIsTheNews(point.low);
  byId('riskExpected').textContent = !point ? '–' : counted ? events(point.expected) : percent(point.pAny);
  byId('riskExpectedLabel').textContent = t(counted ? 'risk.expected' : 'risk.any.long');
  const from = areaFc?.years.from ?? 0;
  byId('riskSummary').textContent = !point
    ? ''
    : level === 'none'
      ? t('risk.summary.none', { when: whenText, area: areaLabel(area) })
      : counted
        ? t('risk.summary', {
          when: whenText, area: areaLabel(area), e: events(point.expected), lo: fmt(point.low), hi: fmt(point.high), k: point.inRange, n: point.years, from,
        })
        : t('risk.summary.maybe', { when: whenText, area: areaLabel(area), n: countRange(point.ifAny[0], point.ifAny[1]) });
  // Contraste con la realidad: el último mes igual que ya terminó, dentro o fuera del rango esperado.
  const observed = point ? lastObserved(calendar, month) : null;
  const historyBox = byId('riskHistory');
  historyBox.hidden = !point;
  if (point) renderHistory(point, from, observed, month);
  const lastLine = byId('riskLast');
  lastLine.hidden = !observed;
  if (observed && point) {
    const where = observed.events < point.low ? 'below' : observed.events > point.high ? 'above' : 'within';
    lastLine.dataset.where = where;
    lastLine.textContent = t(`risk.last.${where}` as Key, {
      month: monthName(month), year: observed.year, n: fmt(observed.events), ev: t(observed.events === 1 ? 'risk.event.one' : 'risk.event.many'),
    });
  }
  byId('riskRange').textContent = !point ? '–' : point.low === point.high ? fmt(point.low) : `${fmt(point.low)}–${fmt(point.high)}`;
  byId('riskHits').textContent = point ? `${point.yearsWithEvents}/${point.years}` : '–';
  // La misma prueba fuera de muestra del modelo, hecha solo en esta área: cuántos meses cayeron en el rango.
  const tested = areaFc?.check;
  byId('riskTestedValue').textContent = tested ? `${tested.inside}/${tested.cases}` : '–';
  byId('riskTested').title = tested
    ? t('risk.tested.tip', { a: tested.train[0], b: tested.train[1], c: tested.test[0], d: tested.test[1], k: tested.inside, n: tested.cases })
    : '';

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
      const tip = `${capitalize(monthOfYear(m.month, year))} · ${t(`risk.prob.${probabilityLevel(m.pAny)}` as Key)} · ${forecastTip(m.expected, m.pAny, m.low)}`;
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
    // Primero donde habrá fuego casi seguro, por eventos esperados; después, donde puede haberlo, por probabilidad:
    // es lo que muestra cada fila (la píldora de eventos o el porcentaje).
    const counted = (u: ForecastUnit): boolean => countIsTheNews(u.low[i]!);
    const top = [...units].sort((a, b) =>
      Number(counted(b)) - Number(counted(a))
      || (counted(a) ? b.expected[i]! - a.expected[i]! : 0)
      || b.pAny[i]! - a.pAny[i]!
      || b.expected[i]! - a.expected[i]!
      || a.name.localeCompare(b.name, 'es')).slice(0, TOP);
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
        const title = `${impact ? `${t(`risk.impact.${impact}` as Key)} · ` : ''}${t(`risk.prob.${probabilityLevel(p)}` as Key)} · ${forecastTip(lambda, p, u.low[i]!)}`;
        // La píldora cuenta eventos solo si habrá fuego casi seguro; si puede no haberlo, basta la probabilidad.
        return el('li', { title },
          go,
          el('span', { className: 'muted small', textContent: showParent && u.parent ? ` · ${u.parent}` : '' }),
          el('span', { className: countIsTheNews(u.low[i]!) ? 'muted small risk-any' : 'small risk-any', textContent: percent(p) }),
          countIsTheNews(u.low[i]!)
            ? el('b', { className: 'risk-pill', textContent: t('risk.top.events', { e: events(lambda) }), style: step === null ? '' : `background:${RAMP[step]!};color:${RAMP_INK[step]!}` })
            : '',
        );
      }),
    );
  }

  // ¿Es confiable? La prueba fuera de muestra del nivel del mapa y, para la franja de la etiqueta, cuántas veces hubo
  // fuego cuando el modelo dijo esa probabilidad: así se ve que "casi nula" no es "puede pasar en cualquier parte".
  const check = fc?.check;
  const band = check?.bands.find((b) => b.from === PROBABILITY_LEVELS.find((l) => l.level === level)!.from);
  const nearZero = check?.bands.find((b) => b.from === 0);
  byId('riskCheck').textContent = check
    ? [
      t('risk.check', { a: check.train[0], b: check.train[1], c: check.test[0], d: check.test[1] }),
      band
        ? t(nearZero && level !== 'none' ? 'risk.check.band' : 'risk.check.band.alone', {
          level: t(LEVEL_KEY[fc!.level]).toLowerCase(), band: t(`risk.prob.${level}` as Key).toLowerCase(), obs: percent(band.observed),
          zero: t('risk.prob.none').toLowerCase(), none: percent(nearZero?.observed ?? 0),
        })
        : '',
      t('risk.check.rest', { cov: Math.round(check.coverage * 100), skill: Math.round(check.skill * 100) }),
    ].filter(Boolean).join(' ')
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
