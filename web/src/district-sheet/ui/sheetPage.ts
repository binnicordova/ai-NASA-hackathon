import qrcode from 'qrcode-generator';

import '../../styles.css';
import './sheet.css';
import type { AreaOfInterest } from '../../area-of-interest/domain/area';
import { mapPath } from '../../area-of-interest/domain/paths';
import { calendarApi } from '../../calendar/infrastructure/calendarApiClient';
import type { AreaForecast, BurnCalendar, Meta, PointSample } from '../../calendar/domain/types';
import { watchMonths } from '../../calendar/domain/watch';
import { renderHeatmap } from '../../calendar/ui/heatmap';
import { monthName, percent, probabilityColor } from '../../calendar/ui/riskPanel';
import { byId, el } from '../../shared/dom';
import { dayLabel, fmt } from '../../shared/format';
import { lang, locale, setLang, t, translateDocument } from '../../shared/i18n';
import { POINT_FILL, quantileBreaks, RAMP } from '../../shared/palette';
import { districtArea, latestSpot, recentRange, shareUrl, ubigeoFrom } from '../domain/sheet';

/** Todo lo que la hoja muestra; se pide una vez y se vuelve a pintar al cambiar de idioma. */
interface SheetData {
  area: Extract<AreaOfInterest, { kind: 'district' }>;
  meta: Meta;
  calendar: BurnCalendar;
  forecast: AreaForecast;
  boundary: GeoJSON.Feature | null;
  recent: PointSample;
  range: { from: string; to: string };
}

const listOf = (items: string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(items);

/**
 * El título que escribió functions/ es el que leen los buscadores ("Incendios en Sicuani (Canchis, Cusco): …"): se
 * conserva. Sin él (desarrollo), "Sicuani · NASAT · Ficha del distrito".
 */
const servedTitle = document.querySelector('meta[name="nasat-district"]') ? document.title : '';
function setTitle(name: string | null): void {
  document.title = servedTitle || (name ? `${name} · ${t('sheet.title')}` : t('sheet.title'));
}

function renderHeader(data: SheetData): void {
  const { area, meta } = data;
  byId('sheetName').removeAttribute('data-i18n');
  byId('sheetName').textContent = area.name;
  byId('sheetParents').textContent = `${area.department} › ${area.province ?? ''} · ${t('sheet.ubigeo', { code: area.ubigeo })}`;
  byId('sheetDate').textContent = t('sheet.data', { date: dayLabel(meta.lastDate) });
  setTitle(area.name);
}

function renderCalendar({ calendar }: SheetData): void {
  const season = calendar.peakSeason;
  // "Un año típico" es la mediana de cada mes: en un distrito con poco fuego los demás meses valen 0 y la cuota
  // saldría 100 %, que se lee como "nunca arde en otro mes" aunque el calendario muestre lo contrario. Ahí se omite.
  const share = Math.round(season.share * 100);
  const months = listOf(season.months.map(monthName));
  byId('sheetSeason').textContent = !season.months.length
    ? t('sheet.season.none')
    : share >= 100 ? t('sheet.season.only', { months }) : t('sheet.season', { months, share });
  const grid = byId('sheetHeatmap');
  // Cada mes abre la app en ese mes: la hoja es el resumen, el mapa el detalle.
  renderHeatmap(grid, calendar, 'harmonized', { from: calendar.range.from, to: `${calendar.range.to}-31` }, {
    onSelect: (year, month) => window.open(mapUrl(year, month), '_blank', 'noopener'),
    onYear: () => undefined,
  }, sheetBreaks(calendar));
  const first = calendar.series[0]!.year;
  const last = calendar.series.at(-1)!.year;
  grid.setAttribute('aria-label', t('sheet.calendar.note', { a: first, b: last }));
  byId('sheetCalNote').textContent = t('sheet.calendar.note', { a: first, b: last });
  byId('sheetLegend').replaceChildren(
    el('span', { className: 'sheet-swatch sheet-swatch-zero' }), el('span', { textContent: t('sheet.zero') }),
    el('span', { className: 'sheet-gap' }),
    el('span', { textContent: t('sheet.less') }),
    ...RAMP.map((color) => el('span', { className: 'sheet-swatch', style: `background:${color}` })),
    el('span', { textContent: t('sheet.more') }),
  );
}

/**
 * Cortes de la rampa solo con los meses que tuvieron fuego: los meses sin fuego ya van aparte ("sin fuego"). Con
 * todos los meses, en un distrito que casi no arde los cuantiles valen 0 y un mes con un solo foco saldría del color
 * más oscuro, que en papel se lee como "mucho fuego". La vista previa del enlace usa la misma regla.
 */
function sheetBreaks(calendar: BurnCalendar): number[] {
  return quantileBreaks(calendar.series.map((p) => p.harmonized).filter((v) => v > 0));
}

let currentArea: SheetData['area'] | null = null;
/** Un mes del calendario, abierto en la app: ese distrito y ese mes completo. */
function mapUrl(year: number, month: number): string {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  const lastDay = String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0');
  const [from, to] = lang() === 'en' ? ['from', 'to'] : ['desde', 'hasta'];
  return `${currentArea ? mapPath(currentArea, lang()) : '/'}?${from}=${key}-01&${to}=${key}-${lastDay}`;
}

function renderForecast({ meta, forecast }: SheetData): void {
  const year = Number(meta.lastDate.slice(0, 4)) + 1;
  byId('sheetForecastTitle').textContent = t('sheet.forecast.title', { year });
  const watch = watchMonths(forecast);
  byId('sheetWatch').textContent = watch.length
    ? t('sheet.watch', { months: listOf(watch.map((m) => `${monthName(m.month)} (${percent(m.pAny)})`)) })
    : t('sheet.watch.none');
  // Doce barras con su porcentaje escrito: en papel no hay ventana al pasar el ratón.
  const bars = byId('sheetMonths');
  bars.setAttribute('aria-label', `${t('sheet.months.aria', { year })}: ${forecast.months.map((m) => `${monthName(m.month)} ${percent(m.pAny)}`).join(', ')}`);
  bars.replaceChildren(
    ...forecast.months.map((m) => {
      const fill = probabilityColor(m.pAny);
      const watched = watch.some((w) => w.month === m.month);
      return el('div', { className: watched ? 'sheet-month watched' : 'sheet-month' },
        el('span', { className: 'sheet-month-p', textContent: m.pAny >= 0.05 ? String(Math.round(m.pAny * 100)) : '' }),
        el('span', { className: 'sheet-month-bar' },
          el('span', { className: 'sheet-month-fill', style: `height:${Math.max(m.pAny * 100, m.pAny > 0 ? 2 : 0)}%;${fill ? `background:${fill}` : ''}` })),
        el('span', { className: 'sheet-month-name', textContent: monthName(m.month).slice(0, 3) }),
      );
    }),
  );
  const check = forecast.check;
  byId('sheetTested').textContent = check
    ? t('sheet.tested', { a: check.train[0], b: check.train[1], c: check.test[0], d: check.test[1], k: check.inside, n: check.cases })
    : '';
}

/** Contorno del distrito y sus focos recientes, en una proyección equirrectangular corregida por la latitud. */
function renderMap({ boundary, recent }: SheetData): void {
  const svg = byId<SVGSVGElement & HTMLElement>('sheetMap');
  const rings: number[][][] = [];
  const geometry = boundary?.geometry;
  if (geometry?.type === 'Polygon') rings.push(...(geometry.coordinates as number[][][]));
  if (geometry?.type === 'MultiPolygon') for (const polygon of geometry.coordinates as number[][][][]) rings.push(...polygon);
  const coords = rings.flat();
  if (!coords.length) {
    svg.replaceChildren();
    return;
  }
  const lons = coords.map((c) => c[0]!);
  const lats = coords.map((c) => c[1]!);
  const [west, east, south, north] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const k = Math.cos((((north + south) / 2) * Math.PI) / 180);
  const width = (east - west) * k;
  const height = north - south;
  const pad = Math.max(width, height) * 0.04;
  const x = (lon: number): number => (lon - west) * k;
  const y = (lat: number): number => north - lat;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${width + 2 * pad} ${height + 2 * pad}`);
  const ns = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', rings.map((ring) => `M${ring.map((c) => `${x(c[0]!).toFixed(5)},${y(c[1]!).toFixed(5)}`).join('L')}Z`).join(''));
  path.setAttribute('class', 'sheet-outline');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  const radius = Math.max(width, height) * 0.012;
  const dots = recent.points.map((p) => {
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x(p[0]).toFixed(5));
    dot.setAttribute('cy', y(p[1]).toFixed(5));
    dot.setAttribute('r', radius.toFixed(5));
    dot.setAttribute('fill', POINT_FILL);
    return dot;
  });
  svg.replaceChildren(path, ...dots);
}

function renderRecent(data: SheetData): void {
  const { recent, range } = data;
  const summary = recent.summary;
  const total = summary?.total ?? 0;
  byId('sheetRecentRange').textContent = t('sheet.recent.range', { a: dayLabel(range.from), b: dayLabel(range.to) });
  const counts = byId('sheetCounts');
  if (!total) {
    counts.replaceChildren(el('dd', { textContent: t('sheet.recent.none') }));
    byId('sheetRecentLast').textContent = '';
  } else {
    const item = (label: string, value: string) => [el('dt', { textContent: label }), el('dd', { textContent: value })];
    counts.replaceChildren(
      ...item(t('sheet.recent.spots'), fmt(total)),
      ...item(t('sheet.recent.events'), recent.events ? fmt(recent.events.total) : '–'),
      ...item(t('sheet.recent.days'), `${summary?.activeDays ?? 0} / 30`),
    );
    const last = latestSpot(recent);
    byId('sheetRecentLast').textContent = last ? t('sheet.recent.last', { date: dayLabel(last) }) : '';
  }
  renderMap(data);
}

function renderFooter(data: SheetData): void {
  const url = shareUrl(location.origin, data.area, lang());
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  byId('sheetQr').innerHTML = code.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  byId('sheetQr').querySelector('svg')?.setAttribute('aria-hidden', 'true');
  byId('sheetUrl').textContent = url.replace(/^https?:\/\//, '');
  byId('sheetMade').textContent = t('sheet.made', { date: dayLabel(new Date().toLocaleDateString('en-CA')) });
  byId<HTMLAnchorElement>('sheetMapLink').href = mapPath(data.area, lang()) ?? '/';
}

function render(data: SheetData): void {
  translateDocument();
  renderHeader(data);
  renderCalendar(data);
  renderForecast(data);
  renderRecent(data);
  renderFooter(data);
  byId('sheet').setAttribute('aria-busy', 'false');
}

function showMessage(key: 'sheet.missing' | 'sheet.unknown' | 'api.unreachable', detail = ''): void {
  translateDocument();
  setTitle(null);
  byId('sheetName').removeAttribute('data-i18n');
  byId('sheetName').textContent = detail || t(key);
  // Sin distrito no hay nada que imprimir ni compartir: queda el aviso y el enlace al mapa.
  for (const id of ['sheetBody', 'sheetPrint', 'sheetShare', 'sheetLang']) byId(id).hidden = true;
  document.querySelector<HTMLElement>('.sheet-foot')!.hidden = true;
  byId('sheet').setAttribute('aria-busy', 'false');
}

/** La página que sirve functions/ ya viene en un idioma (por su dirección): la hoja lo sigue. */
const servedLang = document.querySelector('meta[name="nasat-district"]') ? document.documentElement.lang : '';
if (servedLang === 'es' || servedLang === 'en') setLang(servedLang);

/** Cada idioma tiene su dirección: cambiar de idioma es ir a la otra (así lo ve también un buscador). */
const alternate = (code: string): string | null =>
  document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${code}"]`)?.href ?? null;

async function load(): Promise<void> {
  translateDocument();
  setTitle(null);
  if (!byId('sheetName').textContent?.trim()) byId('sheetName').textContent = t('sheet.loading');
  const ubigeo = ubigeoFrom(document, location);
  if (!ubigeo) return showMessage('sheet.missing');
  const [meta, limits] = await Promise.all([calendarApi.meta(), calendarApi.limits()]);
  const area = districtArea(limits, ubigeo);
  if (!area) return showMessage('sheet.unknown');
  const range = recentRange(meta.lastDate);
  const [calendar, forecast, boundary, recent] = await Promise.all([
    calendarApi.calendar(area, { from: meta.firstDate, to: meta.lastDate }),
    calendarApi.areaForecast(area),
    calendarApi.boundary(area),
    calendarApi.points(area, range),
  ]);
  const data: SheetData = { area, meta, calendar, forecast, boundary, recent, range };
  currentArea = area;
  render(data);

  byId('sheetLang').addEventListener('click', () => {
    const next = lang() === 'es' ? 'en' : 'es';
    const there = alternate(next);
    if (there) {
      setLang(next);
      location.assign(there);
      return;
    }
    setLang(next);
    render(data);
  });
  sharedArea = area;
}

byId('sheetPrint').addEventListener('click', () => window.print());
let sharedArea: SheetData['area'] | null = null;
byId('sheetShare').addEventListener('click', async () => {
  if (!sharedArea) return;
  const url = shareUrl(location.origin, sharedArea, lang());
  // En el teléfono abre la hoja de compartir (WhatsApp, correo); en la computadora copia el enlace.
  if (navigator.share) {
    await navigator.share({ title: document.title, url }).catch(() => undefined);
    return;
  }
  await navigator.clipboard?.writeText(url).catch(() => undefined);
  const status = byId('sheetStatus');
  status.textContent = t('sheet.copied');
  setTimeout(() => (status.textContent = ''), 2500);
});

load().catch((error: unknown) => showMessage('api.unreachable', error instanceof Error ? error.message : ''));
