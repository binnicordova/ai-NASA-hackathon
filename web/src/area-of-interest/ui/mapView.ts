import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { CellCollection, CellProperties, Metric } from '../../calendar/domain/types';
import { escapeHtml } from '../../shared/dom';
import { fmt } from '../../shared/format';
import { t } from '../../shared/i18n';
import { ACCENT, RAMP, quantileBreaks, rampIndex } from '../../shared/palette';
import { PERU_BOUNDS, type AreaOfInterest, type BoundingBox } from '../domain/area';

const toLatLngBounds = (b: BoundingBox): L.LatLngBounds => L.latLngBounds([b.south, b.west], [b.north, b.east]);

/** Mapa: celdas armonizadas del mes elegido y selección del área de interés dibujando una caja. */
export class MapView {
  private readonly map: L.Map;
  private cellsLayer: L.GeoJSON | null = null;
  private areaLayer: L.Rectangle | null = null;
  private drawStart: L.LatLng | null = null;
  private drawPreview: L.Rectangle | null = null;
  private drawing = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onBoxDrawn: (bbox: BoundingBox) => void,
    private readonly onDrawingChange: (active: boolean) => void,
  ) {
    this.map = L.map(container, { preferCanvas: true, zoomControl: true, minZoom: 4, maxZoom: 11 });
    const blueMarble = L.tileLayer(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg',
      { maxNativeZoom: 8, attribution: 'Imagery: NASA GIBS, Blue Marble', className: 'basemap-satellite' },
    );
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      className: 'basemap-streets',
    });
    // Por defecto, satélite de NASA: el mapa de calles queda como alternativa. (Las capas de referencia de GIBS
    // en Web Mercator, nombres y fronteras, llegan opacas en negro y tapan el satélite: no se usan.)
    blueMarble.addTo(this.map);
    L.control.layers({ [t('map.base.satellite')]: blueMarble, [t('map.base.streets')]: streets }, {}, { position: 'topright' }).addTo(this.map);
    L.control.scale({ imperial: false }).addTo(this.map);
    this.map.attributionControl.addAttribution('Fire data: NASA FIRMS');
    this.map.fitBounds(toLatLngBounds(PERU_BOUNDS));

    // Eventos de puntero: el mismo código sirve para ratón, lápiz y dedo.
    container.addEventListener('pointerdown', (event) => this.onDown(event));
    container.addEventListener('pointermove', (event) => this.onMove(event));
    container.addEventListener('pointerup', (event) => this.onUp(event));
    container.addEventListener('pointercancel', () => this.drawing && this.stopDrawing());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.drawing) this.stopDrawing();
    });
  }

  /** Centro y zoom actuales: la intro del globo termina justo en este encuadre. */
  view(): { lat: number; lng: number; zoom: number } {
    const { lat, lng } = this.map.getCenter();
    return { lat, lng, zoom: this.map.getZoom() };
  }

  /** El contenedor cambió de tamaño (por ejemplo al girar el teléfono). */
  resize(): void {
    this.map.invalidateSize();
  }

  showCells(cells: CellCollection, metric: Metric, monthText: string): { low: number; high: number } | null {
    this.cellsLayer?.remove();
    this.cellsLayer = null;
    if (!cells.features.length) return null;
    // Las celdas no tienen eventos: con esa medida se pintan por focos crudos.
    const value = (p: CellProperties): number => (metric === 'harmonized' ? p.harmonized : p.hotspots);
    const values = cells.features.map((f) => value(f.properties));
    const breaks = quantileBreaks(values);
    this.cellsLayer = L.geoJSON(cells, {
      style: (feature) => {
        // El borde lleva el mismo color que el relleno: a escala país la celda mide pocos píxeles y así sigue viéndose.
        const color = RAMP[rampIndex(value(feature!.properties as CellProperties), breaks)];
        return { fillColor: color, fillOpacity: 0.85, color, weight: 1.5 };
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties as CellProperties;
        layer.bindPopup(
          `<strong>${escapeHtml(p.department)}</strong> · ${escapeHtml(monthText)}<br>` +
            `${t('map.popup.harmonized')}: ${p.harmonized.toFixed(1)}<br>` +
            `${t('map.popup.raw')}: ${fmt(p.hotspots)}<br>${t('map.popup.days')}: ${p.activeDays}<br>` +
            `<small>${t('map.popup.cell')}</small>`,
        );
      },
    }).addTo(this.map);
    return { low: Math.min(...values), high: Math.max(...values) };
  }

  /** Marca el área elegida y encuadra el mapa en ella. */
  focusArea(area: AreaOfInterest): void {
    this.areaLayer?.remove();
    this.areaLayer = null;
    if (area.kind === 'bbox') {
      this.areaLayer = L.rectangle(toLatLngBounds(area.bbox), { color: ACCENT, weight: 2, dashArray: '6 4', fill: false, interactive: false }).addTo(this.map);
      this.map.fitBounds(toLatLngBounds(area.bbox), { padding: [24, 24] });
    } else if (area.kind === 'department' && this.cellsLayer && this.cellsLayer.getBounds().isValid()) {
      this.map.fitBounds(this.cellsLayer.getBounds(), { padding: [24, 24] });
    } else {
      this.map.fitBounds(toLatLngBounds(PERU_BOUNDS));
    }
  }

  // --- dibujo de la caja -------------------------------------------------

  toggleDrawing(): void {
    if (this.drawing) this.stopDrawing();
    else this.startDrawing();
  }

  private startDrawing(): void {
    this.drawing = true;
    this.map.dragging.disable();
    this.map.touchZoom.disable();
    this.container.classList.add('drawing');
    this.onDrawingChange(true);
  }

  private stopDrawing(): void {
    this.drawing = false;
    this.drawStart = null;
    this.drawPreview?.remove();
    this.drawPreview = null;
    this.map.dragging.enable();
    this.map.touchZoom.enable();
    this.container.classList.remove('drawing');
    this.onDrawingChange(false);
  }

  private onDown(event: PointerEvent): void {
    if (!this.drawing || (event.target as HTMLElement).closest('.leaflet-control')) return;
    event.preventDefault();
    this.container.setPointerCapture(event.pointerId);
    const start = this.map.mouseEventToLatLng(event);
    this.drawStart = start;
    this.drawPreview = L.rectangle(L.latLngBounds(start, start), { color: ACCENT, weight: 2, dashArray: '6 4' }).addTo(this.map);
  }

  private onMove(event: PointerEvent): void {
    if (this.drawing && this.drawStart && this.drawPreview) {
      this.drawPreview.setBounds(L.latLngBounds(this.drawStart, this.map.mouseEventToLatLng(event)));
    }
  }

  private onUp(event: PointerEvent): void {
    if (!this.drawing || !this.drawStart) return;
    const bounds = L.latLngBounds(this.drawStart, this.map.mouseEventToLatLng(event));
    this.stopDrawing();
    // Un clic sin arrastrar no define un área.
    if (bounds.getNorth() - bounds.getSouth() < 0.01 || bounds.getEast() - bounds.getWest() < 0.01) return;
    this.onBoxDrawn({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
  }
}
