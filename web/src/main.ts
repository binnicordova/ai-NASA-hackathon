import './styles.css';

import { COUNTRY, makeBoundingBox, type AreaOfInterest } from './area-of-interest/domain/area';
import { MapView, type DrawMode } from './area-of-interest/ui/mapView';
import { CalendarController, type BufferMode, type Changes, type Selection, type ViewData } from './calendar/application/calendarController';
import { metricLabel, metricValue, type BurnCalendar, type CellCollection, type Measure, type Metric, type PointSample, type Forecast, type RiskLevel } from './calendar/domain/types';
import { forecastTip, impactColor, impactLevel, monthOfYear, probabilityLevel, renderRiskCard, renderRiskLegend, unitsWithin } from './calendar/ui/riskPanel';
import { renderBeforeAfter, renderFrequencyChart, renderYearDetail, renderYearsChart } from './calendar/ui/charts';
import { renderFullCalendar, renderHeatmap } from './calendar/ui/heatmap';
import { renderAbout, renderLevelLegend, renderMonthCard, renderRangeCard, renderRanking, renderRawCard, renderScope, renderStatus, type RankingKey } from './calendar/ui/panels';
import { RangeBrush } from './calendar/ui/rangeBrush';
import { byId, el } from './shared/dom';
import { downloadCalendarPng, downloadSvgAsPng, safeFilename, type CalendarImage } from './shared/exportPng';
import { addDays, compact, fmt, monthEnd, monthKey, rangeLabel } from './shared/format';
import { lang, monthNames, setLang, t, translateDocument, type Key } from './shared/i18n';
import { areaLabel } from './area-of-interest/domain/area';
import { HIGH_TONE, LOW_TONE, RAMP, RAMP_INK, quantileBreaks, rampIndex } from './shared/palette';
import { hexOpacity } from './area-of-interest/ui/mapView';
import { readUrlState, writeUrlState } from './shared/urlState';
import type { TourHost } from './sample-case/ui/caseTour';

const controller = new CalendarController();
// La pestaña del enlace decide el ancho del mapa (Focos crudos no tiene panel): se aplica antes de crear el mapa,
// para que Leaflet arranque con su tamaño real y no haya que corregirlo después.
{
  const linked = readUrlState();
  document.querySelector('.app')!.classList.toggle('tab-raw', linked.metric === 'hotspots' && !linked.risk);
}
const svg = (id: string): SVGElement => document.getElementById(id) as unknown as SVGElement;

const drawButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-draw]')];
const map = new MapView(
  byId('map'),
  (area) => void controller.setArea(area),
  (mode) => {
    drawButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.draw === mode)));
    const hint = byId('drawHint');
    hint.hidden = !mode;
    if (mode) hint.textContent = t(`draw.hint.${mode}`);
  },
);
const brush = new RangeBrush(byId('brush'), byId('rangeText'), byId('brushView'), {
  onRange: (from, to) => void controller.setRange(from, to),
});
byId('zoomIn').addEventListener('click', () => brush.zoomBy(0.5));
// Llevar el mapa al mayor evento del rango, el día en que ocurrió.
byId('evLargestGo').addEventListener('click', () => {
  const largest = controller.data.points?.events?.largest;
  if (!largest) return;
  // Primero el día del evento; cuando sus focos ya están cargados, el vuelo: así nada vuelve a mover el mapa después.
  void controller.setRange(largest.day, largest.day).then(() => map.flyTo(largest.lat, largest.lon));
});
byId('zoomOut').addEventListener('click', () => brush.zoomBy(2));
byId('zoomFit').addEventListener('click', () => brush.fitSelection());
byId('zoomAll').addEventListener('click', () => brush.showAll());

/** Un mes completo como rango: lo usan el calendario y los atajos. */
const monthRange = (year: number, month: number): [string, string] => [`${monthKey(year, month)}-01`, monthEnd(monthKey(year, month))];

// --- área ------------------------------------------------------------------

const department = byId<HTMLSelectElement>('department');
const province = byId<HTMLSelectElement>('province');
const district = byId<HTMLSelectElement>('district');
department.addEventListener('change', () => {
  void controller.setArea(department.value ? { kind: 'department', department: department.value } : COUNTRY);
});
/** El área de la provincia elegida o, sin provincia, la del departamento. */
function provinceOrDepartment(): AreaOfInterest {
  const found = controller.data.limits?.provinces.find((p) => p.code === province.value);
  if (found) return { kind: 'province', code: found.code, name: found.name, department: found.department };
  return department.value ? { kind: 'department', department: department.value } : COUNTRY;
}
province.addEventListener('change', () => void controller.setArea(provinceOrDepartment()));
district.addEventListener('change', () => {
  const found = controller.data.limits?.districts.find((d) => d.ubigeo === district.value);
  void controller.setArea(found ? { kind: 'district', ubigeo: found.ubigeo, name: found.name, department: found.department, province: found.province } : provinceOrDepartment());
});
drawButtons.forEach((button) => button.addEventListener('click', () => map.toggleDrawing(button.dataset.draw as DrawMode)));

/** Provincias oficiales del departamento elegido y distritos de la provincia elegida (o de todo el departamento, por provincia). */
let selectsFor = '';
function fillAreaSelects(dept: string, prov: string): void {
  const key = `${dept}|${prov}|${lang()}`;
  if (key === selectsFor) return;
  selectsFor = key;
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'es');
  const provinces = (controller.data.limits?.provinces ?? []).filter((p) => p.department === dept).sort(byName);
  province.replaceChildren(el('option', { value: '', textContent: t('area.wholeDept') }), ...provinces.map((p) => el('option', { value: p.code, textContent: p.name })));
  province.disabled = !provinces.length;
  const rows = (controller.data.limits?.districts ?? []).filter((d) => d.department === dept && (!prov || d.ubigeo.startsWith(prov)));
  const groups = provinces.filter((p) => rows.some((d) => d.ubigeo.startsWith(p.code)));
  district.replaceChildren(
    el('option', { value: '', textContent: t(prov ? 'area.wholeProv' : 'area.wholeDept') }),
    ...(prov
      ? rows.sort(byName).map((d) => el('option', { value: d.ubigeo, textContent: d.name }))
      : groups.map((p) => el('optgroup', { label: p.name },
        ...rows.filter((d) => d.ubigeo.startsWith(p.code)).sort(byName).map((d) => el('option', { value: d.ubigeo, textContent: d.name }))))),
  );
  district.disabled = !rows.length;
}

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
  const dept = area.kind === 'department' || area.kind === 'district' || area.kind === 'province' ? area.department : '';
  // La provincia de un distrito son los 4 primeros dígitos de su ubigeo.
  const prov = area.kind === 'province' ? area.code : area.kind === 'district' ? area.ubigeo.slice(0, 4) : '';
  department.value = dept;
  fillAreaSelects(dept, prov);
  province.value = prov;
  district.value = area.kind === 'district' ? area.ubigeo : '';
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
from.addEventListener('change', () => {
  if (from.value) void controller.setRange(from.value, controller.selection.to).then(() => brush.fitSelection());
});
to.addEventListener('change', () => {
  if (to.value) void controller.setRange(controller.selection.from, to.value).then(() => brush.fitSelection());
});

document.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach((button) =>
  button.addEventListener('click', () => {
    const meta = controller.data.meta;
    if (!meta) return;
    const end = meta.lastDate;
    const year = Number(end.slice(0, 4));
    const quick = button.dataset.quick;
    const start =
      quick === '7' ? addDays(end, -6)
      : quick === '30' ? addDays(end, -29)
      : quick === '1' ? `${year}-01-01`
      : quick === '5' ? `${year - 4}-01-01`
      : quick === 'viirs' ? '2012-01-20'
      : meta.firstDate;
    void controller.setRange(start, end);
    if (quick === 'all') brush.showAll();
    else setTimeout(() => brush.fitSelection());
  }),
);

// --- medida, año inspeccionado, calendario ampliado ---------------------------

const metricButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-metric]')];
metricButtons.forEach((button) => button.addEventListener('click', () => void controller.setMetric(button.dataset.metric as Metric)));
const riskTab = document.querySelector<HTMLButtonElement>('[data-tab="risk"]')!;
riskTab.addEventListener('click', () => void controller.setRisk());
const shiftRiskMonth = (step: number): void => controller.setRiskMonth(((controller.riskMonth() - 1 + step + 12) % 12) + 1);
// Limpiar filtros: todo el Perú, todo el rango, sin capas extra; la pestaña se mantiene.
byId('resetFilters').addEventListener('click', () => {
  map.cancelDrawing();
  coordInputs.forEach((input) => (input.value = ''));
  void controller.reset().then(() => brush.showAll());
});
byId('riskPrev').addEventListener('click', () => shiftRiskMonth(-1));
byId('riskNext').addEventListener('click', () => shiftRiskMonth(1));

/** Elegir una unidad del mapa o de la lista: pasa a ser el área (departamento, provincia o distrito oficial). */
function pickUnit(level: RiskLevel, key: string): void {
  const limits = controller.data.limits;
  if (level === 'department') void controller.setArea({ kind: 'department', department: key });
  else if (level === 'province') {
    const p = limits?.provinces.find((x) => x.code === key);
    if (p) void controller.setArea({ kind: 'province', code: p.code, name: p.name, department: p.department });
  } else {
    const d = limits?.districts.find((x) => x.ubigeo === key);
    if (d) void controller.setArea({ kind: 'district', ubigeo: d.ubigeo, name: d.name, department: d.department, province: d.province });
  }
}
const bufferButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-buffers]')];
bufferButtons.forEach((button) => button.addEventListener('click', () => controller.setBuffers(button.dataset.buffers as BufferMode)));
const overlay = byId<HTMLInputElement>('overlay');
overlay.addEventListener('change', () => void controller.setOverlay(overlay.checked));
byId('yearPrev').addEventListener('click', () => controller.inspectYear((controller.selection.inspectedYear ?? 0) - 1));
byId('yearNext').addEventListener('click', () => controller.inspectYear((controller.selection.inspectedYear ?? 0) + 1));

/** Lo que cuentan los gráficos: en la pestaña de focos crudos, los eventos (buffers disueltos por día). */
function measure(): Measure {
  const { metric } = controller.selection;
  return metric === 'hotspots' && controller.data.calendar?.series.some((p) => p.events !== null) ? 'events' : metric;
}

const dialog = byId<HTMLDialogElement>('calendarDialog');
function openCalendarDialog(): void {
  const { calendar } = controller.data;
  if (!calendar) return;
  renderFullCalendar(byId<HTMLTableElement>('fullCalendar'), calendar, measure());
  byId('calendarDialogTitle').textContent = t('cal.dialog.title', { metric: metricLabel(measure()).toLowerCase() });
  byId('calendarDialogNote').textContent = t('cal.dialog.note');
  if (!dialog.open) dialog.showModal();
}
byId('expand').addEventListener('click', openCalendarDialog);

// --- descargas en PNG ------------------------------------------------------------

const scopeText = (): string => `${areaLabel(controller.selection.area)} · ${metricLabel(measure())}`;

document.querySelectorAll<HTMLButtonElement>('[data-png]').forEach((button) =>
  button.addEventListener('click', () => {
    const title = button.dataset.pngTitleId ? byId(button.dataset.pngTitleId).textContent ?? '' : t(button.dataset.pngTitle as Key);
    // Las instrucciones de uso ("haz clic…") no tienen sentido en una imagen suelta.
    const caption = (byId(button.dataset.pngText!).textContent ?? '').replace(t('years.click'), '');
    void downloadSvgAsPng(svg(button.dataset.png!), `${title} · ${areaLabel(controller.selection.area)}`, caption, t('png.footer'), `${safeFilename(`${title}-${areaLabel(controller.selection.area)}`)}.png`);
  }),
);

function calendarImage(calendar: BurnCalendar, metric: Measure): CalendarImage {
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
    if (calendar) downloadCalendarPng(calendarImage(calendar, measure()), `${safeFilename(`${t('cal.title')}-${scopeText()}`)}.png`);
  });
}

// --- ranking de departamentos: columna de orden y "ver todos" ----------------------

// Los eventos (focos disueltos por día) son la cifra que se destaca del ranking.
let rankingSort: RankingKey = 'events';
let rankingAll = false;
document.querySelectorAll<HTMLButtonElement>('.ranking button.sort').forEach((button) =>
  button.addEventListener('click', () => {
    rankingSort = button.dataset.sortKey as RankingKey;
    controller.refresh();
  }),
);
byId('rankingMore').addEventListener('click', () => {
  rankingAll = !rankingAll;
  controller.refresh();
});

// --- vista: ocultar secciones o dejar solo el mapa --------------------------------
// Es una preferencia de quien mira: se guarda en su navegador, no en el enlace compartido.
// El encabezado y sus pestañas no se ocultan nunca: son la identidad del proyecto y el cambio de vista.

type Section = 'filters' | 'stats' | 'range';
const SECTIONS: Section[] = ['filters', 'stats', 'range'];
const VIEW_KEY = 'nasat-hidden-sections';
const hiddenSections = new Set<Section>(((): Section[] => {
  try {
    return (JSON.parse(localStorage.getItem(VIEW_KEY) ?? '[]') as Section[]).filter((s) => SECTIONS.includes(s));
  } catch {
    return [];
  }
})());
const viewMenu = byId('viewMenu');
const viewMenuButton = byId('viewMenuButton');

function applyView(): void {
  const app = document.querySelector<HTMLElement>('.app')!;
  for (const section of SECTIONS) app.classList.toggle(`hide-${section}`, hiddenSections.has(section));
  document.querySelectorAll<HTMLInputElement>('[data-view]').forEach((box) => (box.checked = !hiddenSections.has(box.dataset.view as Section)));
  const mapOnly = hiddenSections.size === SECTIONS.length;
  byId('viewMapOnly').setAttribute('aria-pressed', String(mapOnly));
  byId('exitMapOnly').hidden = !mapOnly;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify([...hiddenSections]));
  } catch {
    /* sin almacenamiento: la vista vale solo para esta visita */
  }
  requestAnimationFrame(() => map.resize());
}

function setMapOnly(on: boolean): void {
  hiddenSections.clear();
  if (on) SECTIONS.forEach((s) => hiddenSections.add(s));
  viewMenu.hidden = true;
  viewMenuButton.setAttribute('aria-expanded', 'false');
  applyView();
}

byId('viewMapOnly').addEventListener('click', () => setMapOnly(hiddenSections.size !== SECTIONS.length));
byId('exitMapOnly').addEventListener('click', () => setMapOnly(false));
viewMenuButton.addEventListener('click', () => {
  viewMenu.hidden = !viewMenu.hidden;
  viewMenuButton.setAttribute('aria-expanded', String(!viewMenu.hidden));
});
document.querySelectorAll<HTMLInputElement>('[data-view]').forEach((box) =>
  box.addEventListener('change', () => {
    const section = box.dataset.view as Section;
    if (box.checked) hiddenSections.delete(section);
    else hiddenSections.add(section);
    applyView();
  }),
);
document.addEventListener('keydown', (event) => {
  // Esc sale del modo solo mapa (si no se está dibujando un área, que usa Esc para cancelar).
  if (event.key !== 'Escape' || document.querySelector('#map.drawing')) return;
  if (!viewMenu.hidden) {
    viewMenu.hidden = true;
    viewMenuButton.setAttribute('aria-expanded', 'false');
  } else if (hiddenSections.size === SECTIONS.length) setMapOnly(false);
});
applyView();

// --- idioma ---------------------------------------------------------------------

/** Cambia el idioma sin recargar: el botón del encabezado y el de la bienvenida del recorrido. */
function switchLang(): void {
  setLang(lang() === 'es' ? 'en' : 'es');
  translateDocument();
  paintedCells = null; // la leyenda y las ventanas del mapa llevan texto: se repintan
  paintedPoints = null;
  paintedRisk = '';
  renderAbout(controller.data.meta);
  paintThemeButton();
  controller.refresh();
  if (dialog.open) openCalendarDialog();
}
byId('langSwitch').addEventListener('click', switchLang);

byId('ramp').append(...RAMP.map((color) => el('span', { style: `background:${color}` })));
// Leyenda de los hexágonos: los seis pasos de la rampa, con la misma transparencia que en el mapa.
byId('hexSteps').append(...RAMP.map((color, level) => el('span', { className: 'hex-step', style: `background:${color};opacity:${hexOpacity(level)}` })));

// --- pintar -------------------------------------------------------------------

let paintedCells: CellCollection | null | undefined = null;
let hexExtent: { count: number; low: number; high: number } | null = null;
let paintedPoints: PointSample | null | undefined = null;
let metaShown = false;
/** Qué capa de alerta temprana está pintada (nivel, mes e idioma): solo se repinta si cambia. */
let paintedRisk = '';

/** Pinta los límites del nivel que toca dentro del área elegida, coloreados por su nivel de probabilidad. */
function paintRisk(fc: Forecast | null, shapes: GeoJSON.FeatureCollection | null, area: AreaOfInterest, month: number, year: number): void {
  const shown = fc ? unitsWithin(fc, area) : [];
  const key = fc && shapes ? `${fc.level}|${JSON.stringify(area)}|${month}|${year}|${lang()}` : '';
  if (key === paintedRisk) return;
  paintedRisk = key;
  if (!fc || !shapes) {
    map.showRisk(null, () => false, () => null, () => '', () => undefined);
    return;
  }
  // Los departamentos se identifican por nombre en la API y en los contornos: la misma clave.
  const units = new Map(shown.map((u) => [u.key, u]));
  map.showRisk(
    shapes,
    (k) => units.has(k),
    (k) => {
      const u = units.get(k);
      return u ? impactColor(u.expected[month - 1]!, u.pAny[month - 1]!) : null;
    },
    (k) => {
      const u = units.get(k);
      if (!u) return k;
      const p = u.pAny[month - 1]!;
      const impact = impactLevel(u.expected[month - 1]!, p);
      return t('risk.tooltip', {
        when: monthOfYear(month, year), name: u.name, parent: u.parent ? `${u.parent} · ` : '',
        impact: impact ? t(`risk.impact.${impact}` as Key) : t('risk.prob.none'), level: t(`risk.prob.${probabilityLevel(p)}` as Key).toLowerCase(),
        tip: forecastTip(u.expected[month - 1]!, p, u.low[month - 1]!),
      });
    },
    (k) => pickUnit(fc.level, k),
  );
}

/** Leyenda del mapa: qué se ve, para qué rango y, en focos, si se muestran todos o solo los más recientes. */
function mapLegend(selection: Selection, data: ViewData, text: string): string {
  // Los totales ya están en el panel: la leyenda solo avisa de lo que no se ve (vacío o recortado).
  const parts: string[] = [];
  if (selection.risk) return '';
  if (selection.metric === 'harmonized' && !hexExtent?.count) parts.push(t('map.empty', { range: text }));
  const points = data.points;
  if ((selection.metric === 'hotspots' || selection.overlay) && points) {
    if (points.total === 0) parts.push(t('map.legend.noPoints', { range: text }));
    else if (points.truncated) parts.push(t('map.legend.pointsSome', { shown: fmt(points.shown), total: fmt(points.total) }));
  }
  return parts.join(' ');
}

function render(selection: Selection, data: ViewData, changed: Changes): void {
  renderStatus(data.loading || data.mapLoading, data.error);
  const { calendar, meta, daily } = data;

  if (meta && !metaShown) {
    metaShown = true;
    department.append(...meta.departments.map((name) => el('option', { value: name, textContent: name })));
    byId('limitsNote').hidden = !data.limits;
    from.min = to.min = meta.firstDate;
    from.max = to.max = meta.lastDate;
    renderAbout(meta);
    byId<HTMLAnchorElement>('dlHotspots').hidden = !meta.hasHotspotPoints;
  }
  // La ficha imprimible existe para los distritos oficiales: el enlace corto que se comparte.
  const sheetOpen = byId<HTMLAnchorElement>('sheetOpen');
  sheetOpen.hidden = selection.area.kind !== 'district';
  if (selection.area.kind === 'district') sheetOpen.href = `/d/${selection.area.ubigeo}${lang() === 'en' ? '?lang=en' : ''}`;
  if (!calendar || !daily) return;
  const range = controller.range();

  const risk = selection.risk;
  document.querySelector('.app')!.classList.toggle('tab-risk', risk);
  metricButtons.forEach((button) => button.setAttribute('aria-pressed', String(!risk && button.dataset.metric === selection.metric)));
  riskTab.setAttribute('aria-pressed', String(risk));
  overlay.checked = selection.overlay;
  byId('overlayToggle').hidden = risk || selection.metric !== 'harmonized';
  syncAreaInputs(selection.area);
  from.value = range.from;
  to.value = range.to;
  byId<HTMLAnchorElement>('dlHotspots').href = controller.downloadUrl('hotspots.csv');
  byId<HTMLAnchorElement>('dlCells').href = controller.downloadUrl('export.csv');
  byId<HTMLAnchorElement>('dlSeries').href = controller.downloadUrl('calendar.csv');

  const points = !selection.risk && (selection.metric === 'hotspots' || selection.overlay) && controller.mapIsCurrent('points') ? data.points : undefined;
  renderScope(range, selection.area);
  const riskMonth = controller.riskMonth();
  // Se predice el año siguiente al último dato (hoy, 2027).
  const lastDate = meta?.lastDate ?? range.to;
  const when = { year: Number(lastDate.slice(0, 4)) + 1, lastYear: Number(lastDate.slice(0, 4)), lastMonth: Number(lastDate.slice(5, 7)) };
  if (risk) {
    const years = data.areaForecast?.years ?? data.forecast?.years;
    if (years) byId('scopeRange').textContent = t('risk.scope', { y: when.year, a: years.from, b: years.to, n: years.count });
    renderRiskCard(selection.area, data.areaForecast, data.forecast, calendar, riskMonth, when, {
      onMonth: (m) => controller.setRiskMonth(m),
      onPick: (u) => pickUnit(data.forecast!.level, u.key),
    });
  }
  // Hexágonos con actividad armonizada en el rango: los mismos que pinta el mapa.
  const shownCells = selection.metric === 'harmonized' && controller.mapIsCurrent('cells') ? data.cells : null;
  const hexagons = shownCells ? shownCells.features.filter((f) => f.properties.harmonized > 0).length : null;
  renderRangeCard(calendar, daily, range, hexagons, selection.metric === 'harmonized');
  // Con focos crudos a la vista (pestaña cruda o superpuestos), su tarjeta va primero en el panel.
  renderRawCard(points?.summary ?? null, points?.events ?? null, daily, range);
  renderMonthCard(calendar, data.anomaly);
  renderLevelLegend(calendar);
  const counted = measure();
  // Focos crudos no tiene panel de estadísticas: al entrar o salir, el mapa cambia de ancho y hay que avisarle.
  const app = document.querySelector('.app')!;
  const rawTab = !risk && selection.metric === 'hotspots';
  if (app.classList.contains('tab-raw') !== rawTab) {
    app.classList.toggle('tab-raw', rawTab);
    // En el acto (no en el siguiente cuadro): así el encuadre del área, más abajo, ya usa el ancho nuevo.
    map.resize();
  }
  brush.render(daily, range, counted);
  renderHeatmap(byId('heatmap'), calendar, counted, range, {
    onSelect: (year, month) => {
      void controller.setRange(...monthRange(year, month));
      setTimeout(() => brush.fitSelection());
    },
    onYear: (year) => controller.inspectYear(year),
  });

  const year = selection.inspectedYear ?? calendar.years.at(-1)!.year;
  const currentMonth = data.anomaly?.month ?? calendar.series.at(-1)!.month;
  byId('frequencyText').textContent = renderFrequencyChart(svg('frequencyChart'), calendar, currentMonth);
  byId('yearsUnit').textContent = `· ${metricLabel(counted).toLowerCase()}`;
  byId('yearsText').textContent = `${renderYearsChart(svg('yearsChart'), calendar, counted, year, (y) => controller.inspectYear(y))}${t('years.click')}`;
  byId('yearDetailTitle').textContent = t('detail.title', { year });
  byId('yearDetailText').textContent = renderYearDetail(svg('yearDetailChart'), calendar, year, counted);
  renderBeforeAfter(svg('beforeAfterChart'), calendar);
  renderRanking(data.ranking, rankingSort, rankingAll, selection.area, (name) => void controller.setArea({ kind: 'department', department: name }));

  // Capas del mapa: hexágonos en la pestaña armonizada; focos en la cruda o superpuestos. Solo se repinta lo que cambió.
  const text = rangeLabel(range.from, range.to);
  const cells = !risk && selection.metric === 'harmonized' && controller.mapIsCurrent('cells') ? data.cells : undefined;
  paintRisk(risk ? data.forecast : null, risk ? data.shapes : null, selection.area, riskMonth, when.year);
  if (risk) renderRiskLegend(riskMonth, when.year);
  if (cells !== paintedCells) {
    hexExtent = map.showCells(cells ?? null, text);
    paintedCells = cells;
  }
  // Disueltos o superpuestos: se elige en el mapa y solo cambia el dibujo.
  map.setBufferMode(selection.buffers);
  bufferButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.buffers === selection.buffers)));
  byId('bufferToggle').hidden = !points?.points.length;
  byId('legendPointText').textContent = t(selection.buffers === 'dissolve' ? 'map.key.point.dissolve' : 'map.key.point');
  if (points !== paintedPoints) {
    map.showPoints(points ?? null);
    paintedPoints = points;
  }
  const legend = byId('mapLegend');
  legend.hidden = data.mapLoading || (!cells && !points && !(risk && data.forecast));
  byId('legendRisk').hidden = !risk;
  const legendText = byId('mapLegendText');
  legendText.textContent = mapLegend(selection, data, text);
  legendText.hidden = !legendText.textContent;
  byId('legendHex').hidden = risk || !hexExtent;
  if (hexExtent) {
    byId('hexLow').textContent = `${compact(hexExtent.low)} (${t(`tone.${LOW_TONE}`)})`;
    byId('hexHigh').textContent = `${compact(hexExtent.high)} (${t(`tone.${HIGH_TONE}`)})`;
  }
  byId('legendPoint').hidden = !points?.points.length;
  if (changed.area && changed.map) map.focusArea(selection.area, data.boundary?.geometry ?? null);
  writeUrlState(selection);
}

translateDocument();
controller.subscribe(render);
// Los colores se leen del tema activo al cargar: al cambiar de tema se recarga (la vista está en la URL).
// Si la persona eligió un tema, manda su elección; si no, el del sistema.
const THEME_KEY = 'nasat-theme';
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const currentTheme = (): 'light' | 'dark' =>
  (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? (systemDark.matches ? 'dark' : 'light');
systemDark.addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) location.reload();
});
const themeButton = byId('themeSwitch');
function paintThemeButton(): void {
  const theme = currentTheme();
  themeButton.dataset.current = theme;
  themeButton.setAttribute('aria-pressed', String(theme === 'dark'));
  themeButton.setAttribute('aria-label', t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark'));
  themeButton.title = themeButton.getAttribute('aria-label')!;
}
themeButton.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* sin almacenamiento: el tema vale solo para esta carga */
  }
  document.documentElement.dataset.theme = next;
  location.reload();
});
paintThemeButton();
window.addEventListener('resize', () => map.resize());
// Un enlace compartido pegado en la misma pestaña cambia solo el fragmento: se aplica sin recargar.
window.addEventListener('hashchange', () => void controller.restore(readUrlState()));
const initialState = readUrlState();
const started = controller.start(initialState);

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
let introDone: Promise<unknown> = Promise.resolve();
if (!initialState.area && !introSeen() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  try {
    sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* sin almacenamiento: la intro puede repetirse, no pasa nada */
  }
  introDone = import('./area-of-interest/ui/globeIntro')
    .then(({ playGlobeIntro }) => playGlobeIntro(document.querySelector<HTMLElement>('.map-wrap')!, map.view()))
    .catch(() => document.querySelector('.globe-intro')?.remove()); // sin la intro, el mapa ya está listo debajo
}

// --- caso de muestra: el video de 30 s y el recorrido por el incendio de Sicuani ----------
// Se abre solo en la primera visita a la portada (sin área ni fechas en el enlace), después de la intro del globo:
// quien llega con un enlace compartido ve esa vista. El botón "Caso Sicuani" del encabezado lo vuelve a abrir.
const TOUR_KEY = 'nasat-tour-seen';
function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === '1';
  } catch {
    return true; // sin almacenamiento no se puede recordar: mejor no abrirlo en cada visita
  }
}
const tourHost: TourHost = {
  controller,
  revealSections: () => {
    // El recorrido señala el panel de área y fechas, las estadísticas y la línea de tiempo: se muestran mientras dura.
    const hidden = [...hiddenSections];
    const filters = byId<HTMLDetailsElement>('filters');
    const wasOpen = filters.open;
    filters.open = true;
    viewMenu.hidden = true;
    viewMenuButton.setAttribute('aria-expanded', 'false');
    if (hidden.length) {
      hiddenSections.clear();
      applyView();
    }
    return () => {
      filters.open = wasOpen;
      if (!hidden.length) return;
      hidden.forEach((section) => hiddenSections.add(section));
      applyView();
    };
  },
  frameTimeline: (all) => (all ? brush.showAll() : brush.fitSelection()),
  switchLang,
};
function openTour(): void {
  try {
    localStorage.setItem(TOUR_KEY, '1');
  } catch {
    /* sin almacenamiento: no se recuerda, y tampoco se abre solo */
  }
  import('./sample-case/ui/caseTour')
    .then(({ startCaseTour }) => startCaseTour(tourHost))
    .catch(() => undefined); // sin el recorrido la app sigue igual
}
byId('tourOpen').addEventListener('click', openTour);
if (!initialState.area && !initialState.from && !initialState.to && !tourSeen()) {
  void Promise.all([started, introDone]).then(() => {
    // Si mientras tanto la persona ya eligió un área o una pestaña, no se le interrumpe.
    const { area, metric, risk } = controller.selection;
    if (area.kind === 'country' && metric === 'harmonized' && !risk && !dialog.open) openTour();
  });
}
