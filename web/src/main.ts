import './styles.css';

import { COUNTRY, makeBoundingBox, type AreaOfInterest } from './area-of-interest/domain/area';
import { MapView } from './area-of-interest/ui/mapView';
import { CalendarController, type Selection, type ViewData } from './calendar/application/calendarController';
import { metricLabel, metricValue, type BurnCalendar, type CellCollection, type Metric } from './calendar/domain/types';
import { renderBeforeAfter, renderFrequencyChart, renderYearDetail, renderYearsChart } from './calendar/ui/charts';
import { renderFullCalendar, renderHeatmap } from './calendar/ui/heatmap';
import { renderAbout, renderLevelLegend, renderMonthCard, renderRangeCard, renderRanking, renderStatus } from './calendar/ui/panels';
import { RangeBrush } from './calendar/ui/rangeBrush';
import { byId, el } from './shared/dom';
import { downloadCalendarPng, downloadSvgAsPng, safeFilename, type CalendarImage } from './shared/exportPng';
import { compact, monthKey, monthLabel } from './shared/format';
import { lang, monthNames, setLang, t, translateDocument, type Key } from './shared/i18n';
import { areaLabel } from './area-of-interest/domain/area';
import { HIGH_TONE, LOW_TONE, RAMP, RAMP_INK, quantileBreaks, rampIndex } from './shared/palette';
import { readUrlState, writeUrlState } from './shared/urlState';

const controller = new CalendarController();
const svg = (id: string): SVGElement => document.getElementById(id) as unknown as SVGElement;

const map = new MapView(
  byId('map'),
  (bbox) => void controller.setArea({ kind: 'bbox', bbox }),
  (active) => {
    byId('draw').setAttribute('aria-pressed', String(active));
    byId('drawHint').hidden = !active;
  },
);
const brush = new RangeBrush(byId('brush'), byId('rangeText'), {
  onRange: (from, to) => void controller.setRange(from, to),
  onSelect: (year, month) => void controller.selectMonth(year, month),
});

// --- área ------------------------------------------------------------------

const department = byId<HTMLSelectElement>('department');
department.addEventListener('change', () => {
  void controller.setArea(department.value ? { kind: 'department', department: department.value } : COUNTRY);
});
byId('draw').addEventListener('click', () => map.toggleDrawing());

const coordInputs = ['north', 'south', 'west', 'east'].map((id) => byId<HTMLInputElement>(id));
byId<HTMLFormElement>('coords').addEventListener('submit', (event) => {
  event.preventDefault();
  const [north, south, west, east] = coordInputs.map((input) => (input.value.trim() === '' ? NaN : Number(input.value.replace(',', '.'))));
  const result = makeBoundingBox(north!, south!, west!, east!);
  const error = byId('coordsError');
  error.hidden = result.ok;
  if (!result.ok) {
    error.textContent = result.error;
    return;
  }
  void controller.setArea({ kind: 'bbox', bbox: result.bbox });
});

function syncAreaInputs(area: AreaOfInterest): void {
  byId('coordsError').hidden = true; // un área válida deja sin efecto el último error de coordenadas
  department.value = area.kind === 'department' ? area.department : '';
  if (area.kind === 'bbox') {
    const { north, south, west, east } = area.bbox;
    [north, south, west, east].forEach((value, index) => (coordInputs[index]!.value = value.toFixed(3)));
  } else if (document.activeElement?.closest('#coords') === null) {
    coordInputs.forEach((input) => (input.value = ''));
  }
}

// --- fechas ----------------------------------------------------------------

const from = byId<HTMLInputElement>('from');
const to = byId<HTMLInputElement>('to');
from.addEventListener('change', () => from.value && void controller.setRange(from.value, controller.selection.to));
to.addEventListener('change', () => to.value && void controller.setRange(controller.selection.from, to.value));

document.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach((button) =>
  button.addEventListener('click', () => {
    const series = controller.data.calendar?.series;
    if (!series?.length) return;
    const last = series.at(-1)!;
    const end = monthKey(last.year, last.month);
    const quick = button.dataset.quick;
    const start =
      quick === '5' ? monthKey(last.year - 4, 1) : quick === '1' ? monthKey(last.year, 1) : quick === 'viirs' ? '2012-02' : monthKey(series[0]!.year, series[0]!.month);
    void controller.setRange(start, end);
  }),
);

// --- medida, año inspeccionado, calendario ampliado ---------------------------

const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-metric]')];
metricButtons.forEach((button) => button.addEventListener('click', () => controller.setMetric(button.dataset.metric as Metric)));
byId('yearPrev').addEventListener('click', () => controller.inspectYear((controller.selection.inspectedYear ?? 0) - 1));
byId('yearNext').addEventListener('click', () => controller.inspectYear((controller.selection.inspectedYear ?? 0) + 1));

const dialog = byId<HTMLDialogElement>('calendarDialog');
function openCalendarDialog(): void {
  const { calendar } = controller.data;
  if (!calendar) return;
  renderFullCalendar(byId<HTMLTableElement>('fullCalendar'), calendar, controller.selection.metric);
  byId('calendarDialogTitle').textContent = t('cal.dialog.title', { metric: metricLabel(controller.selection.metric).toLowerCase() });
  byId('calendarDialogNote').textContent = t('cal.dialog.note');
  if (!dialog.open) dialog.showModal();
}
byId('expand').addEventListener('click', openCalendarDialog);

// --- descargas en PNG ------------------------------------------------------------

const scopeText = (): string => `${areaLabel(controller.selection.area)} · ${metricLabel(controller.selection.metric)}`;

document.querySelectorAll<HTMLButtonElement>('[data-png]').forEach((button) =>
  button.addEventListener('click', () => {
    const title = button.dataset.pngTitleId ? byId(button.dataset.pngTitleId).textContent ?? '' : t(button.dataset.pngTitle as Key);
    // Las instrucciones de uso ("haz clic…") no tienen sentido en una imagen suelta.
    const caption = (byId(button.dataset.pngText!).textContent ?? '').replace(t('years.click'), '');
    void downloadSvgAsPng(svg(button.dataset.png!), `${title} · ${areaLabel(controller.selection.area)}`, caption, t('png.footer'), `${safeFilename(`${title}-${areaLabel(controller.selection.area)}`)}.png`);
  }),
);

function calendarImage(calendar: BurnCalendar, metric: Metric): CalendarImage {
  const breaks = quantileBreaks(calendar.series.map((p) => metricValue(p, metric)));
  return {
    title: `${t('cal.title')} · ${scopeText()}`,
    note: t('cal.dialog.note'),
    footer: t('png.footer'),
    columns: [t('cal.year'), ...monthNames(), t('cal.total')],
    rows: calendar.years.map((year) => ({
      label: `${year.year}${year.partial ? ' *' : ''}`,
      total: compact(metricValue(year, metric)),
      cells: Array.from({ length: 12 }, (_, index) => {
        const point = calendar.series.find((p) => p.year === year.year && p.month === index + 1);
        if (!point) return null;
        const level = rampIndex(metricValue(point, metric), breaks);
        return { text: compact(metricValue(point, metric)), fill: RAMP[level]!, ink: RAMP_INK[level]!, italic: point.sensor === 'MODIS' };
      }),
    })),
  };
}
for (const id of ['calendarPng', 'calendarPngDialog']) {
  byId(id).addEventListener('click', () => {
    const { calendar } = controller.data;
    if (calendar) downloadCalendarPng(calendarImage(calendar, controller.selection.metric), `${safeFilename(`${t('cal.title')}-${scopeText()}`)}.png`);
  });
}

// --- idioma ---------------------------------------------------------------------

byId('langSwitch').addEventListener('click', () => {
  setLang(lang() === 'es' ? 'en' : 'es');
  translateDocument();
  paintedCells = null; // la leyenda y las ventanas del mapa llevan texto: se repintan
  renderAbout(controller.data.meta);
  controller.refresh();
  if (dialog.open) openCalendarDialog();
});

byId('ramp').append(...RAMP.map((color) => el('span', { style: `background:${color}` })));

// --- pintar -------------------------------------------------------------------

let paintedCells: CellCollection | null = null;
let paintedMetric: Metric | null = null;
let metaShown = false;

function render(selection: Selection, data: ViewData, changed: { area: boolean; month: boolean }): void {
  renderStatus(data.loading, data.error);
  const { calendar, meta } = data;

  if (meta && !metaShown) {
    metaShown = true;
    department.append(...meta.departments.map((name) => el('option', { value: name, textContent: name })));
    from.min = to.min = meta.firstDate.slice(0, 7);
    from.max = to.max = meta.lastDate.slice(0, 7);
    renderAbout(meta);
    byId<HTMLAnchorElement>('dlHotspots').hidden = !meta.hasHotspotPoints;
  }
  if (!calendar || !selection.month) return;

  const hasEvents = calendar.rangeSummary.events !== null;
  metricButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.metric === selection.metric));
    if (button.dataset.metric === 'events') button.disabled = !hasEvents;
  });
  syncAreaInputs(selection.area);
  from.value = calendar.range.from;
  to.value = calendar.range.to;
  byId<HTMLAnchorElement>('dlHotspots').href = controller.downloadUrl('hotspots.csv');
  byId<HTMLAnchorElement>('dlCells').href = controller.downloadUrl('export.csv');
  byId<HTMLAnchorElement>('dlSeries').href = controller.downloadUrl('calendar.csv');

  renderRangeCard(calendar, selection.area, selection.metric);
  renderMonthCard(calendar, data.anomaly, selection.metric, selection.month);
  renderLevelLegend(calendar);
  brush.render(calendar, selection.metric, selection.month);
  renderHeatmap(byId('heatmap'), calendar, selection.metric, selection.month, {
    onSelect: (year, month) => void controller.selectMonth(year, month),
    onYear: (year) => controller.inspectYear(year),
  });

  const year = selection.inspectedYear ?? selection.month.year;
  byId('frequencyText').textContent = renderFrequencyChart(svg('frequencyChart'), calendar, selection.month.month, (month) => {
    if (calendar.series.some((p) => p.year === year && p.month === month)) void controller.selectMonth(year, month);
  });
  byId('yearsUnit').textContent = `· ${metricLabel(selection.metric).toLowerCase()}`;
  byId('yearsText').textContent = `${renderYearsChart(svg('yearsChart'), calendar, selection.metric, year, (y) => controller.inspectYear(y))}${t('years.click')}`;
  byId('yearDetailTitle').textContent = t('detail.title', { year });
  byId('yearDetailText').textContent = renderYearDetail(svg('yearDetailChart'), calendar, year);
  renderBeforeAfter(svg('beforeAfterChart'), calendar);
  renderRanking(data.ranking, selection.metric, selection.area, (name) => void controller.setArea({ kind: 'department', department: name }));

  // El mapa solo se repinta cuando llegan celdas nuevas o cambia la medida.
  if (data.cells && (data.cells !== paintedCells || selection.metric !== paintedMetric)) {
    paintedCells = data.cells;
    paintedMetric = selection.metric;
    const text = monthLabel(selection.month.year, selection.month.month);
    const extent = map.showCells(data.cells, selection.metric, text);
    const legend = byId('mapLegend');
    legend.hidden = false;
    legend.textContent = extent
      ? t('map.legend', { month: text, n: data.cells.features.length, what: t(selection.metric === 'harmonized' ? 'map.what.harmonized' : 'map.what.raw'), lo: compact(extent.low), hi: compact(extent.high), loTone: t(`tone.${LOW_TONE}`), hiTone: t(`tone.${HIGH_TONE}`) })
      : t('map.empty', { month: text });
  }
  if (changed.area && changed.month) map.focusArea(selection.area);
  writeUrlState(selection);
}

translateDocument();
controller.subscribe(render);
// Los colores se leen del tema activo al cargar: si el sistema cambia de tema, se recarga. La vista está en la URL.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
window.addEventListener('resize', () => map.resize());
// Un enlace compartido pegado en la misma pestaña cambia solo el fragmento: se aplica sin recargar.
window.addEventListener('hashchange', () => void controller.restore(readUrlState()));
const initialState = readUrlState();
void controller.start(initialState);

// --- intro: la Tierra en 3D gira y se acerca a Perú ------------------------------
// Solo en la primera visita de la sesión, sin un área concreta en el enlace y sin "reducir movimiento".
const INTRO_KEY = 'nasat-intro-seen';
function introSeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}
if (!initialState.area && !introSeen() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  try {
    sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* sin almacenamiento: la intro puede repetirse, no pasa nada */
  }
  import('./area-of-interest/ui/globeIntro')
    .then(({ playGlobeIntro }) => playGlobeIntro(document.querySelector<HTMLElement>('.map-wrap')!, map.view()))
    .catch(() => document.querySelector('.globe-intro')?.remove()); // sin la intro, el mapa ya está listo debajo
}
