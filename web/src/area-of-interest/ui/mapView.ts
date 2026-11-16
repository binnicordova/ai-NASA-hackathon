import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { BUFFER_M, groupDailyEvents, type DailyEvents, type FireEvent } from '../../calendar/domain/fireEvents';
import type { BufferMode } from '../../calendar/application/calendarController';
import type { CellCollection, CellProperties, PointRow, PointSample } from '../../calendar/domain/types';
import { escapeHtml } from '../../shared/dom';
import { dayLabel, fmt } from '../../shared/format';
import { t } from '../../shared/i18n';
import { ACCENT, POINT_FILL, RAMP, quantileBreaks, rampIndex } from '../../shared/palette';
import { PERU_BOUNDS, simplifyRing, type AreaOfInterest, type BoundingBox, type LonLat } from '../domain/area';

const toLatLngBounds = (b: BoundingBox): L.LatLngBounds => L.latLngBounds([b.south, b.west], [b.north, b.east]);

/**
 * Transparencia de los hexágonos por paso de la rampa: los pasos bajos dejan ver más el terreno y los altos
 * pesan más, así la intensidad se lee dos veces (color y opacidad) y el satélite sigue visible debajo.
 */
export const hexOpacity = (level: number): number => 0.5 + 0.07 * level;
/** Opacidad de un buffer en el modo superpuesto: donde se solapan varios, el rojo se acumula. */
const BUFFER_ALPHA = 0.28;
/** Opacidad del relleno de cada día en el modo disuelto: los días que repiten fuego en un lugar se apilan. */
const DAY_ALPHA = 0.3;
/** Grosor del contorno de las figuras disueltas, en píxeles. */
const OUTLINE_PX = 1.5;
/** Radio mínimo en pantalla para que un buffer siga viéndose a escala país. */
const MIN_BUFFER_PX = 2;
/** El foco en sí: un punto sólido en el centro de su buffer. */
const DOT_PX = 1.6;


/**
 * Capa de focos crudos en un lienzo: cada detección es un punto con su buffer (375 m VIIRS, 1 km MODIS).
 *  - overlap: cada buffer translúcido; los solapes se acumulan.
 *  - dissolve: los buffers que se tocan se funden en una sola figura, como un "dissolve" de SIG, sin bordes internos.
 *    Se disuelve por día, la misma regla que cuenta los eventos del panel: cada día se pinta como una figura plana
 *    translúcida (los días que repiten fuego en un lugar se apilan) y el conjunto lleva un contorno nítido.
 * La unión no se calcula como geometría (miles de círculos serían lentos): se compone en un lienzo auxiliar.
 */
class BufferLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private readonly scratch = document.createElement('canvas');
  private rows: PointRow[] = [];
  private grouping: DailyEvents | null = null;
  private mode: BufferMode = 'dissolve';

  setRows(rows: PointRow[]): void {
    this.rows = rows;
    this.grouping = null; // se agrupa al pedirlo: en el modo superpuesto no hace falta
    this.redraw();
  }

  setMode(mode: BufferMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.redraw();
  }

  /** Eventos de fuego por día de los focos cargados (misma regla que el panel). */
  events(): DailyEvents {
    return (this.grouping ??= groupDailyEvents(this.rows));
  }

  override onAdd(map: L.Map): this {
    this.canvas = L.DomUtil.create('canvas', 'squares-layer') as HTMLCanvasElement;
    map.getPane('hotspots')!.appendChild(this.canvas);
    map.on('moveend zoomend viewreset resize', this.redraw, this);
    // Se oculta solo durante la animación del zoom (siempre la sigue un zoomend); un zoomstart sin cambio de nivel
    // (por ejemplo, rueda en el zoom mínimo) dejaría la capa oculta.
    map.on('zoomanim', this.hide, this);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off('moveend zoomend viewreset resize', this.redraw, this);
    map.off('zoomanim', this.hide, this);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private hide(): void {
    if (this.canvas) this.canvas.style.visibility = 'hidden';
  }

  /** Radio en píxeles de pantalla del buffer de un foco a esta latitud y zoom. */
  radius(row: PointRow, zoom: number): number {
    const metersPerPx = (156543.03392 * Math.cos((row[1] * Math.PI) / 180)) / 2 ** zoom;
    return Math.max(MIN_BUFFER_PX, BUFFER_M[row[2]] / metersPerPx);
  }

  redraw(): void {
    const map = this._map;
    if (!map || !this.canvas) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    canvas.style.visibility = 'visible';
    for (const c of [canvas, this.scratch]) {
      c.width = size.x * ratio;
      c.height = size.y * ratio;
    }
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = POINT_FILL;
    const zoom = map.getZoom();
    // Un margen de un buffer: una figura que asoma desde fuera de la vista se dibuja completa por su lado visible.
    const bounds = map.getBounds().pad(0.05);
    const visible: { p: L.Point; r: number; day: string }[] = [];
    for (const row of this.rows) {
      if (bounds.contains([row[1], row[0]])) visible.push({ p: map.latLngToContainerPoint([row[1], row[0]]), r: this.radius(row, zoom), day: row[4] });
    }
    if (this.mode === 'overlap') {
      // Cada buffer aparte, translúcido: los solapes se acumulan.
      ctx.globalAlpha = BUFFER_ALPHA;
      for (const { p, r } of visible) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      this.paintDissolved(ctx, visible, ratio);
    }
    // Encima, el foco: un punto sólido que no se pierde aunque su buffer se funda con otros.
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const { p } of visible) {
      ctx.moveTo(p.x + DOT_PX, p.y);
      ctx.arc(p.x, p.y, DOT_PX, 0, Math.PI * 2);
    }
    ctx.fill();
    if (this.mode === 'dissolve') {
      // De cerca, el punto lleva un halo claro para distinguirse sobre el relleno rojo de su figura. De lejos, el buffer
      // mide pocos píxeles y el halo solo lo aclararía: se omite.
      ctx.beginPath();
      for (const { p, r } of visible) {
        if (r < 5) continue;
        ctx.moveTo(p.x + DOT_PX, p.y);
        ctx.arc(p.x, p.y, DOT_PX, 0, Math.PI * 2);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  /**
   * Unión de los buffers sin geometría: en un lienzo auxiliar los círculos se rellenan opacos (la unión es "cualquier
   * píxel cubierto") y el resultado se compone una sola vez con su transparencia, así los solapes no se acumulan.
   */
  private paintDissolved(ctx: CanvasRenderingContext2D, visible: { p: L.Point; r: number; day: string }[], ratio: number): void {
    const off = this.scratch.getContext('2d')!;
    const { width, height } = this.scratch;
    const circles = (items: typeof visible, grow: number): void => {
      off.beginPath();
      for (const { p, r } of items) {
        off.moveTo(p.x + r + grow, p.y);
        off.arc(p.x, p.y, r + grow, 0, Math.PI * 2);
      }
      off.fill(); // regla nonzero: los círculos de un mismo trazo se unen sin dejar huecos
    };
    const stamp = (alpha: number): void => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.drawImage(this.scratch, 0, 0);
      ctx.restore();
    };
    off.setTransform(ratio, 0, 0, ratio, 0, 0);
    off.fillStyle = POINT_FILL;

    // 1. Relleno: una figura plana por día. Los días se apilan; dentro de un día, los solapes no.
    const byDay = new Map<string, typeof visible>();
    for (const item of visible) (byDay.get(item.day) ?? byDay.set(item.day, []).get(item.day)!).push(item);
    for (const items of byDay.values()) {
      off.clearRect(0, 0, width, height);
      circles(items, 0);
      stamp(DAY_ALPHA);
    }

    // 2. Contorno de la unión de todo el rango: la unión agrandada menos la unión. Sin bordes internos.
    off.clearRect(0, 0, width, height);
    circles(visible, OUTLINE_PX);
    off.globalCompositeOperation = 'destination-out';
    circles(visible, 0);
    off.globalCompositeOperation = 'source-over';
    stamp(1);
  }

  /** Encuadre de todos los focos, o `null` si no hay. */
  bounds(): L.LatLngBounds | null {
    if (!this.rows.length) return null;
    const lats = this.rows.map((r) => r[1]);
    const lons = this.rows.map((r) => r[0]);
    return L.latLngBounds([Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]);
  }

  /** El foco bajo el puntero (dentro de su buffer), si lo hay; el más cercano a su centro. */
  hit(point: L.Point): { row: PointRow; index: number } | null {
    const map = this._map;
    if (!map) return null;
    const zoom = map.getZoom();
    let best: { row: PointRow; index: number } | null = null;
    let bestDistance = Infinity;
    this.rows.forEach((row, index) => {
      const p = map.latLngToContainerPoint([row[1], row[0]]);
      const reach = Math.max(6, this.radius(row, zoom));
      const distance = Math.hypot(p.x - point.x, p.y - point.y);
      if (distance <= reach && distance < bestDistance) [best, bestDistance] = [{ row, index }, distance];
    });
    return best;
  }
}

export type DrawMode = 'box' | 'polygon' | 'freehand';

const INEI_WMS = 'https://geoespacial.inei.gob.pe/geoserver/Interoperabilidad/wms';
const OUTLINE = (): L.PathOptions => ({ color: ACCENT, weight: 2.5, dashArray: '6 4', fill: false, interactive: false });
const PREVIEW = (): L.PolylineOptions => ({ color: ACCENT, weight: 2, dashArray: '4 4', fillColor: ACCENT, fillOpacity: 0.08, interactive: false });

export class MapView {
  private readonly map: L.Map;
  private cellsLayer: L.GeoJSON | null = null;
  private readonly squares = new BufferLayer();
  private areaLayer: L.Layer | null = null;
  private mode: DrawMode | null = null;
  private drawStart: L.LatLng | null = null;
  private vertices: L.LatLng[] = [];
  private freehandActive = false;
  private drawPreview: L.Rectangle | L.Polygon | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onAreaDrawn: (area: AreaOfInterest) => void,
    private readonly onDrawingChange: (mode: DrawMode | null) => void,
  ) {
    this.map = L.map(container, { preferCanvas: true, zoomControl: true, minZoom: 4, maxZoom: 14 });
    // Los focos van en su propio panel, por encima de los hexágonos y sin capturar el puntero.
    this.map.createPane('hotspots').style.zIndex = '450';
    const blueMarble = L.tileLayer(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
      { maxNativeZoom: 8, attribution: 'Imagery: NASA GIBS, Blue Marble', className: 'basemap-satellite' },
    );
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      className: 'basemap-streets',
    });
    // Límites oficiales del INEI como capas de referencia opcionales (WMS público del Geoservidor).
    const inei = (layer: string): L.TileLayer.WMS =>
      L.tileLayer.wms(INEI_WMS, { layers: `Interoperabilidad:${layer}`, format: 'image/png', transparent: true, attribution: 'Límites: INEI', className: 'inei-limits' });
    // Por defecto, satélite de NASA: el mapa de calles queda como alternativa. (Las capas de referencia de GIBS
    // en Web Mercator, nombres y fronteras, llegan opacas en negro y tapan el satélite: no se usan.)
    blueMarble.addTo(this.map);
    L.control
      .layers(
        { [t('map.base.satellite')]: blueMarble, [t('map.base.streets')]: streets },
        { [t('map.inei.departments')]: inei('ig_departamento'), [t('map.inei.districts')]: inei('ig_distrito') },
        { position: 'topright' },
      )
      .addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);
    this.map.attributionControl.addAttribution('Fire data: NASA FIRMS');
    this.map.fitBounds(toLatLngBounds(PERU_BOUNDS));

    // Eventos de puntero: el mismo código sirve para ratón, lápiz y dedo.
    container.addEventListener('pointerdown', (event) => this.onDown(event));
    container.addEventListener('pointermove', (event) => this.onMove(event));
    container.addEventListener('pointerup', (event) => this.onUp(event));
    container.addEventListener('dblclick', (event) => {
      if (this.mode === 'polygon') {
        event.preventDefault();
        this.finishPolygon();
      }
    });
    container.addEventListener('pointercancel', () => this.mode && this.stopDrawing());
    document.addEventListener('keydown', (event) => {
      if (!this.mode) return;
      if (event.key === 'Escape') this.stopDrawing();
      else if (event.key === 'Enter' && this.mode === 'polygon') {
        event.preventDefault(); // sin esto, Enter también "pulsa" el botón enfocado y vuelve a abrir el modo
        this.finishPolygon();
      }
      else if (event.key === 'Backspace' && this.mode === 'polygon' && this.vertices.length) {
        event.preventDefault();
        this.vertices.pop();
        this.paintPolygonPreview(null);
      }
    });
    // Clic sobre un foco: su ficha. Se comprueba antes que el hexágono de debajo.
    this.map.on('click', (event: L.LeafletMouseEvent) => {
      if (this.mode || !this.map.hasLayer(this.squares)) return;
      const hit = this.squares.hit(event.containerPoint);
      if (!hit) return;
      // Ficha del foco y, debajo, la del evento del día al que pertenece (los buffers que se tocan ese día).
      const { eventOf, events } = this.squares.events();
      L.popup().setLatLng([hit.row[1], hit.row[0]]).setContent(pointPopup(hit.row) + eventPopup(events[eventOf[hit.index]!]!)).openOn(this.map);
    });
  }

  /** Centro y zoom actuales: la intro del globo termina justo en este encuadre. */
  view(): { lat: number; lng: number; zoom: number } {
    const { lat, lng } = this.map.getCenter();
    return { lat, lng, zoom: this.map.getZoom() };
  }

  /** Centra el mapa en un punto, de cerca: para ir a un evento concreto. */
  flyTo(lat: number, lon: number): void {
    this.map.flyTo([lat, lon], 12, { duration: 0.8 });
  }

  /** El contenedor cambió de tamaño (por ejemplo al girar el teléfono). */
  resize(): void {
    this.map.invalidateSize();
  }

  /**
   * Hexágonos armonizados con la misma rampa de fuego que el calendario (amarillo pálido → rojo oscuro), translúcidos.
   * Los cortes son cuantiles de las celdas visibles: la escala se adapta al área y al rango elegidos.
   */
  showCells(cells: CellCollection | null, rangeText: string): { count: number; low: number; high: number } | null {
    this.cellsLayer?.remove();
    this.cellsLayer = null;
    // Una celda con actividad armonizada 0 solo tuvo focos del sensor secundario (MODIS en la era VIIRS):
    // en la vista armonizada no cuenta, y pintarla con el color más bajo la haría pasar por actividad.
    const active = cells?.features.filter((f) => f.properties.harmonized > 0) ?? [];
    if (!active.length) return null;
    const values = active.map((f) => f.properties.harmonized);
    const breaks = quantileBreaks(values);
    const shown: CellCollection = { ...cells!, features: active };
    this.cellsLayer = L.geoJSON(shown, {
      style: (feature) => {
        const level = rampIndex((feature!.properties as CellProperties).harmonized, breaks);
        const color = RAMP[level]!;
        // El borde, del mismo color y más opaco: a escala país la celda mide pocos píxeles y así sigue viéndose.
        return { fillColor: color, fillOpacity: hexOpacity(level), color, opacity: 0.9, weight: 1 };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties as CellProperties;
        layer.bindPopup(
          `<strong>${escapeHtml(p.department)}</strong> · ${escapeHtml(rangeText)}<br>` +
            `${t('map.popup.harmonized')}: ${p.harmonized.toFixed(1)}<br>` +
            `${t('map.popup.raw')}: ${fmt(p.hotspots)}<br>${t('map.popup.days')}: ${p.activeDays}<br>` +
            `<small>${t('map.popup.cell')}</small>`,
        );
      },
    }).addTo(this.map);
    return { count: active.length, low: Math.min(...values), high: Math.max(...values) };
  }

  /** Superponer los buffers o disolverlos por día. */
  setBufferMode(mode: BufferMode): void {
    this.squares.setMode(mode);
  }

  /** Focos crudos como puntos con su buffer. `null` quita la capa. */
  showPoints(sample: PointSample | null): void {
    if (!sample) {
      this.squares.remove();
      return;
    }
    if (!this.map.hasLayer(this.squares)) this.squares.addTo(this.map);
    this.squares.setRows(sample.points);
  }

  /** Encuadre de lo pintado, para centrar el mapa al cambiar de departamento. */
  private paintedBounds(): L.LatLngBounds | null {
    if (this.cellsLayer?.getBounds().isValid()) return this.cellsLayer.getBounds();
    return this.map.hasLayer(this.squares) ? this.squares.bounds() : null;
  }

  /**
   * Marca el área elegida y encuadra el mapa en ella. Departamentos y distritos llevan su contorno oficial del INEI;
   * cajas y polígonos, el trazo del usuario.
   */
  focusArea(area: AreaOfInterest, boundary: GeoJSON.Geometry | null = null): void {
    this.map.invalidateSize(); // al cargar, el contenedor puede haber cambiado de tamaño después de crear el mapa
    this.areaLayer?.remove();
    this.areaLayer = null;
    let bounds: L.LatLngBounds | null = null;
    if (area.kind === 'bbox') {
      this.areaLayer = L.rectangle(toLatLngBounds(area.bbox), OUTLINE());
      bounds = toLatLngBounds(area.bbox);
    } else if (area.kind === 'polygon') {
      const polygon = L.polygon(area.ring.map(([lon, lat]) => [lat, lon] as L.LatLngTuple), OUTLINE());
      this.areaLayer = polygon;
      bounds = polygon.getBounds();
    } else if (boundary) {
      const shape = L.geoJSON(boundary as GeoJSON.GeoJsonObject, { style: OUTLINE, interactive: false });
      this.areaLayer = shape;
      bounds = shape.getBounds();
    } else if (area.kind !== 'country') {
      bounds = this.paintedBounds();
    }
    this.areaLayer?.addTo(this.map);
    this.map.fitBounds(bounds?.isValid() ? bounds : toLatLngBounds(PERU_BOUNDS), { padding: [24, 24] });
  }

  // --- dibujo del área: caja, polígono o a mano alzada ------------------------------

  /** Activa un modo de dibujo; el mismo botón otra vez lo cancela. */
  toggleDrawing(mode: DrawMode): void {
    const same = this.mode === mode;
    if (this.mode) this.stopDrawing();
    if (!same) this.startDrawing(mode);
  }

  private startDrawing(mode: DrawMode): void {
    this.mode = mode;
    this.map.dragging.disable();
    this.map.touchZoom.disable();
    this.map.doubleClickZoom.disable();
    this.container.classList.add('drawing');
    this.onDrawingChange(mode);
  }

  private stopDrawing(): void {
    this.mode = null;
    this.drawStart = null;
    this.vertices = [];
    this.freehandActive = false;
    this.drawPreview?.remove();
    this.drawPreview = null;
    this.map.dragging.enable();
    this.map.touchZoom.enable();
    this.map.doubleClickZoom.enable();
    this.container.classList.remove('drawing');
    this.onDrawingChange(null);
  }

  private onDown(event: PointerEvent): void {
    if (!this.mode || (event.target as HTMLElement).closest('.leaflet-control')) return;
    event.preventDefault();
    const at = this.map.mouseEventToLatLng(event);
    if (this.mode === 'polygon') {
      // Un clic cerca del primer vértice cierra el polígono.
      const first = this.vertices[0];
      if (first && this.vertices.length >= 3 && this.map.latLngToContainerPoint(first).distanceTo(this.map.mouseEventToContainerPoint(event)) < 12) {
        this.finishPolygon();
        return;
      }
      this.vertices.push(at);
      this.paintPolygonPreview(at);
      return;
    }
    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      /* puntero ya liberado: el trazo sigue sin captura */
    }
    if (this.mode === 'box') {
      this.drawStart = at;
      this.drawPreview = L.rectangle(L.latLngBounds(at, at), PREVIEW()).addTo(this.map);
    } else {
      this.freehandActive = true;
      this.vertices = [at];
      this.drawPreview = L.polygon([at], PREVIEW()).addTo(this.map);
    }
  }

  private onMove(event: PointerEvent): void {
    if (!this.mode) return;
    const at = this.map.mouseEventToLatLng(event);
    if (this.mode === 'box' && this.drawStart && this.drawPreview instanceof L.Rectangle) {
      this.drawPreview.setBounds(L.latLngBounds(this.drawStart, at));
    } else if (this.mode === 'freehand' && this.freehandActive) {
      // Un vértice nuevo cada 3 píxeles: el trazo sigue la mano sin llenarse de puntos.
      const last = this.vertices[this.vertices.length - 1]!;
      if (this.map.latLngToContainerPoint(last).distanceTo(this.map.mouseEventToContainerPoint(event)) >= 3) {
        this.vertices.push(at);
        (this.drawPreview as L.Polygon).setLatLngs(this.vertices);
      }
    } else if (this.mode === 'polygon' && this.vertices.length) {
      this.paintPolygonPreview(at);
    }
  }

  private onUp(event: PointerEvent): void {
    if (this.mode === 'box' && this.drawStart) {
      const bounds = L.latLngBounds(this.drawStart, this.map.mouseEventToLatLng(event));
      this.stopDrawing();
      // Un clic sin arrastrar no define un área.
      if (bounds.getNorth() - bounds.getSouth() < 0.01 || bounds.getEast() - bounds.getWest() < 0.01) return;
      this.onAreaDrawn({ kind: 'bbox', bbox: { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() } });
    } else if (this.mode === 'freehand' && this.freehandActive) {
      this.emitPolygon(this.vertices);
    }
  }

  /** Vista previa del polígono: los lados ya fijados y el último hasta el puntero. */
  private paintPolygonPreview(cursor: L.LatLng | null): void {
    const points = cursor ? [...this.vertices, cursor] : this.vertices;
    if (!this.drawPreview) this.drawPreview = L.polygon(points, PREVIEW()).addTo(this.map);
    else (this.drawPreview as L.Polygon).setLatLngs(points);
  }

  private finishPolygon(): void {
    // El doble clic añade dos vértices iguales al final: se descartan los repetidos.
    const unique = this.vertices.filter((p, i, all) => i === 0 || !p.equals(all[i - 1]!));
    this.emitPolygon(unique);
  }

  /** Cierra el trazo, lo simplifica y lo entrega como área. Un trazo diminuto se descarta. */
  private emitPolygon(points: L.LatLng[]): void {
    const zoom = this.map.getZoom();
    this.stopDrawing();
    if (points.length < 3) return;
    const box = L.latLngBounds(points);
    if (box.getNorth() - box.getSouth() < 0.01 && box.getEast() - box.getWest() < 0.01) return;
    // Tolerancia de unos 2 píxeles al zoom del dibujo.
    const ring = simplifyRing(points.map((p) => [p.lng, p.lat] as LonLat), (2 * 360) / (256 * 2 ** zoom));
    if (ring.length >= 3) this.onAreaDrawn({ kind: 'polygon', ring });
  }
}

function pointPopup(row: PointRow): string {
  const [, , instrument, satellite, date, time, confidence, frp, daynight] = row;
  const hhmm = `${time.padStart(4, '0').slice(0, 2)}:${time.padStart(4, '0').slice(2)}`;
  return (
    `<strong>${escapeHtml(instrument)} · ${escapeHtml(satellite)}</strong><br>` +
    `${escapeHtml(dayLabel(date))} · ${hhmm} UTC · ${escapeHtml(t(daynight === 'N' ? 'map.point.night' : 'map.point.day'))}<br>` +
    `${t('map.point.frp')}: ${frp === null ? '—' : `${frp.toFixed(1)} MW`} · ${t('map.point.conf')}: ${escapeHtml(confidence)}<br>` +
    `<small>${t(instrument === 'VIIRS' ? 'map.point.viirs' : 'map.point.modis')}</small>`
  );
}

function eventPopup(event: FireEvent): string {
  return (
    `<hr class="popup-rule"><strong>${t('map.event.title', { day: dayLabel(event.day) })}</strong><br>` +
    `${t('map.event.body', { n: fmt(event.hotspots), v: fmt(event.viirs), m: fmt(event.modis), frp: fmt(event.frp) })}<br>` +
    `<small>${t('map.event.note')}</small>`
  );
}
