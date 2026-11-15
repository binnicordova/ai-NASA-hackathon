import { cssToken, el } from '../../shared/dom';
import { t } from '../../shared/i18n';
import { PERU_BOUNDS } from '../domain/area';

/** Imagen mundial de NASA GIBS (Blue Marble, relieve y batimetría) en lat/lon: es la textura del globo. */
const BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0' +
  '&LAYERS=BlueMarble_ShadedRelief_Bathymetry&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg';
const DURATION = 4200;
const FADE = 450;
const LOAD_TIMEOUT = 5000;
/** Resolución interna del render, en píxeles: se dibuja más pequeño y se escala (es un fondo que se mueve). */
const RENDER_PIXELS = 200_000;
const START = { lng: -28, lat: 14 }; // sobre el Atlántico, con África y América a la vista
const RAD = Math.PI / 180;

const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const clamp = (x: number): number => Math.min(1, Math.max(0, x));

function loadTexture(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT);
    image.onload = () => {
      window.clearTimeout(timer);
      const canvas = el('canvas', { width: image.naturalWidth, height: image.naturalHeight });
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('no image'));
    };
    image.src = BLUE_MARBLE;
  });
}

/**
 * Intro de la app: la Tierra en 3D con la imagen Blue Marble de NASA gira hasta Perú y se acerca hasta el
 * encuadre del mapa de Leaflet que espera debajo; luego se funde con él. Es decorativa: los datos cargan en paralelo.
 */
export async function playGlobeIntro(host: HTMLElement, target: { lat: number; lng: number; zoom: number }): Promise<void> {
  const canvas = el('canvas', { className: 'globe-canvas' });
  canvas.setAttribute('aria-hidden', 'true');
  const skip = el('button', { type: 'button', className: 'btn globe-skip', textContent: t('intro.skip') });
  const caption = el('p', { className: 'globe-caption', textContent: t('intro.caption') });
  const layer = el('div', { className: 'globe-intro' }, canvas, caption, skip);
  host.append(layer);

  let done = false;
  let frame = 0;
  let resolveDone: () => void = () => {};
  const finished = new Promise<void>((resolve) => (resolveDone = resolve));
  const finish = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', finish);
    window.removeEventListener('resize', size);
    layer.classList.add('leaving');
    window.setTimeout(() => {
      layer.remove();
      resolveDone();
    }, FADE);
  };
  layer.addEventListener('pointerdown', finish);
  skip.addEventListener('click', finish);
  window.addEventListener('keydown', finish);

  const ctx = canvas.getContext('2d')!;
  const buffer = el('canvas');
  const bufferCtx = buffer.getContext('2d')!;
  let width = 0;
  let height = 0;
  let k = 1; // píxeles del buffer por píxel CSS
  function size(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = host.clientWidth;
    height = host.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    k = Math.min(1, Math.sqrt(RENDER_PIXELS / Math.max(1, width * height)));
    buffer.width = Math.max(1, Math.round(width * k));
    buffer.height = Math.max(1, Math.round(height * k));
  }
  size();
  window.addEventListener('resize', size);

  let texture: ImageData;
  try {
    texture = await loadTexture();
  } catch {
    finish(); // sin imagen no hay intro: el mapa ya está listo debajo
    return finished;
  }
  if (done) return finished;

  const deepBlue = cssToken('--deep-blue');
  const accent = cssToken('--neon-yellow');
  const tex = texture.data;
  const tw = texture.width;
  const th = texture.height;
  // Leaflet a zoom z: 256·2^z píxeles por vuelta. La ortográfica: R píxeles por radián cerca del centro.
  const endRadius = (256 * 2 ** target.zoom) / (2 * Math.PI);
  const stars = Array.from({ length: 140 }, (_, i) => [((i * 9301 + 49297) % 233280) / 233280, ((i * 4096 + 150889) % 714025) / 714025, (i % 3) * 0.4 + 0.4] as const);

  /** Punto (lng, lat) en pantalla, o null si está en la cara oculta. */
  const project = (lng: number, lat: number, lng0: number, lat0: number, radius: number): [number, number] | null => {
    const [l, p, p0] = [(lng - lng0) * RAD, lat * RAD, lat0 * RAD];
    if (Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l) <= 0) return null;
    return [width / 2 + radius * Math.cos(p) * Math.sin(l), height / 2 - radius * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l))];
  };

  const draw = (progress: number): void => {
    const turn = ease(clamp(progress / 0.62));
    const lng0 = START.lng + (target.lng - START.lng) * turn;
    const lat0 = START.lat + (target.lat - START.lat) * turn;
    const startRadius = Math.min(width, height) * 0.4;
    const radius = startRadius * (endRadius / startRadius) ** ease(clamp((progress - 0.3) / 0.7));

    // Fondo: espacio con estrellas y halo de atmósfera.
    ctx.fillStyle = deepBlue;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, .7)';
    for (const [x, y, r] of stars) ctx.fillRect(x * width, y * height, r, r);
    const glow = ctx.createRadialGradient(width / 2, height / 2, radius * 0.98, width / 2, height / 2, radius * 1.12);
    glow.addColorStop(0, 'rgba(46, 150, 245, .5)');
    glow.addColorStop(1, 'rgba(46, 150, 245, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Esfera: proyección ortográfica inversa, píxel a píxel, sobre la textura Blue Marble.
    const bw = buffer.width;
    const bh = buffer.height;
    const out = bufferCtx.createImageData(bw, bh);
    const px = out.data;
    const r = radius * k;
    const cx = bw / 2;
    const cy = bh / 2;
    const sin0 = Math.sin(lat0 * RAD);
    const cos0 = Math.cos(lat0 * RAD);
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(bh, Math.ceil(cy + r));
    for (let y = y0; y < y1; y += 1) {
      const v = (cy - y - 0.5) / r;
      const span = Math.sqrt(Math.max(0, 1 - v * v)) * r;
      const x0 = Math.max(0, Math.floor(cx - span));
      const x1 = Math.min(bw, Math.ceil(cx + span));
      for (let x = x0; x < x1; x += 1) {
        const u = (x + 0.5 - cx) / r;
        const rho2 = u * u + v * v;
        if (rho2 > 1) continue;
        const z = Math.sqrt(1 - rho2);
        const lat = Math.asin(z * sin0 + v * cos0);
        const lng = lng0 * RAD + Math.atan2(u, z * cos0 - v * sin0);
        let tx = Math.floor(((lng / RAD + 180) / 360) * tw) % tw;
        if (tx < 0) tx += tw;
        const ty = Math.min(th - 1, Math.max(0, Math.floor(((90 - lat / RAD) / 180) * th)));
        const from = (ty * tw + tx) * 4;
        const to = (y * bw + x) * 4;
        const light = 0.45 + 0.55 * z; // borde más oscuro: se lee como esfera
        px[to] = tex[from]! * light;
        px[to + 1] = tex[from + 1]! * light;
        px[to + 2] = tex[from + 2]! * light;
        px[to + 3] = 255;
      }
    }
    bufferCtx.putImageData(out, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(buffer, 0, 0, width, height);

    // Perú: contorno del área de estudio y un pulso en su centro.
    const { west, east, south, north } = PERU_BOUNDS;
    const edge: [number, number][] = [];
    for (let i = 0; i <= 16; i += 1) edge.push([west + ((east - west) * i) / 16, north]);
    for (let i = 0; i <= 16; i += 1) edge.push([east, north - ((north - south) * i) / 16]);
    for (let i = 0; i <= 16; i += 1) edge.push([east - ((east - west) * i) / 16, south]);
    for (let i = 0; i <= 16; i += 1) edge.push([west, south + ((north - south) * i) / 16]);
    const points = edge.map(([lng, lat]) => project(lng, lat, lng0, lat0, radius));
    const reveal = clamp((progress - 0.2) / 0.3) * (1 - clamp((progress - 0.85) / 0.15));
    if (reveal > 0 && points.every(Boolean)) {
      ctx.globalAlpha = reveal;
      ctx.beginPath();
      points.forEach((p, i) => (i ? ctx.lineTo(p![0], p![1]) : ctx.moveTo(p![0], p![1])));
      ctx.closePath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      const center = project(target.lng, target.lat, lng0, lat0, radius);
      if (center) {
        const pulse = (progress * 3) % 1;
        ctx.beginPath();
        ctx.arc(center[0], center[1], 4 + pulse * 18, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(228, 55, 0, ${1 - pulse})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  };

  let start = 0;
  const tick = (now: number): void => {
    if (done) return;
    if (!start) start = now;
    const progress = clamp((now - start) / DURATION);
    draw(progress);
    if (progress >= 1) finish();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return finished;
}
