/** Descarga de visualizaciones como PNG, hechas en el navegador (sin enviar nada a un servidor). */

import { cssToken } from './dom';

const SCALE = 3; // resolución suficiente para pegar la imagen en un informe o una diapositiva
// La imagen lleva los colores del tema activo: lo que se descarga es lo que se ve.
const SURFACE = cssToken('--s2');
const INK = cssToken('--tx');
const MUTED = cssToken('--tx2');
const GRID = cssToken('--bd');
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function save(canvas: HTMLCanvasElement, filename: string): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
}

export const safeFilename = (text: string): string =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Convierte una gráfica SVG de la página en PNG con título y pie.
 * Los estilos que en pantalla vienen de CSS se copian al SVG, porque una imagen suelta no ve la hoja de estilos.
 */
export async function downloadSvgAsPng(svg: SVGElement, title: string, caption: string, footer: string, filename: string): Promise<void> {
  const [, , width = 324, height = 150] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.querySelectorAll('text').forEach((node) => {
    node.setAttribute('font-size', '10');
    node.setAttribute('font-family', FONT);
    if (!node.getAttribute('style')?.includes('fill')) node.setAttribute('fill', MUTED);
  });
  clone.querySelectorAll('.grid').forEach((node) => node.setAttribute('stroke', GRID));
  clone.querySelectorAll('.hit').forEach((node) => node.remove());
  // Las variables de tema no existen fuera de la página: se sustituyen por su valor.
  const markup = new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_, name: string) => cssToken(name));

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se pudo generar la imagen'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });

  const pad = 14;
  const captionLines = wrap(caption, width, `10px ${FONT}`);
  const footerLines = wrap(footer, width, `9px ${FONT}`);
  const top = 30;
  const bottom = 14 + captionLines.length * 12 + footerLines.length * 11 + 8;
  const canvas = document.createElement('canvas');
  canvas.width = (width + pad * 2) * SCALE;
  canvas.height = (top + height + bottom) * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, width + pad * 2, top + height + bottom);
  ctx.fillStyle = INK;
  ctx.font = `600 13px ${FONT}`;
  ctx.fillText(title, pad, 20);
  ctx.drawImage(image, pad, top, width, height);
  ctx.fillStyle = MUTED;
  ctx.font = `10px ${FONT}`;
  captionLines.forEach((line, index) => ctx.fillText(line, pad, top + height + 14 + index * 12));
  ctx.font = `9px ${FONT}`;
  footerLines.forEach((line, index) => ctx.fillText(line, pad, top + height + 14 + captionLines.length * 12 + 6 + index * 11));
  save(canvas, filename);
}

/** Parte un texto en líneas que caben en `maxWidth` píxeles con la fuente indicada. */
function wrap(text: string, maxWidth: number, font: string): string[] {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && measure.measureText(`${line} ${word}`).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface CalendarImage {
  title: string;
  note: string;
  footer: string;
  columns: string[]; // encabezados: año, doce meses, total
  rows: { label: string; cells: ({ text: string; fill: string; ink: string; italic: boolean } | null)[]; total: string }[];
}

/** Dibuja el calendario de quema completo, con el número en cada celda. */
export function downloadCalendarPng(data: CalendarImage, filename: string): void {
  const cellW = 52;
  const cellH = 20;
  const labelW = 54;
  const pad = 16;
  const top = 58;
  const width = pad * 2 + labelW + cellW * 13;
  const noteLines = wrap(data.note, width - pad * 2, `11px ${FONT}`);
  const height = top + cellH * (data.rows.length + 1) + 18 + noteLines.length * 13 + 18;
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = INK;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(data.title, pad, 28);

  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  data.columns.forEach((name, index) => {
    const x = index === 0 ? pad + labelW - 8 : pad + labelW + cellW * index - 8;
    ctx.fillText(name, x, top + 14);
  });
  data.rows.forEach((row, r) => {
    const y = top + cellH * (r + 1);
    ctx.fillStyle = MUTED;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(row.label, pad + labelW - 8, y + 14);
    row.cells.forEach((cell, c) => {
      const x = pad + labelW + cellW * c;
      if (!cell) return;
      ctx.fillStyle = cell.fill;
      ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
      ctx.fillStyle = cell.ink;
      ctx.font = `${cell.italic ? 'italic ' : ''}11px ${FONT}`;
      ctx.fillText(cell.text, x + cellW - 8, y + 14);
    });
    ctx.fillStyle = INK;
    ctx.font = `600 11px ${FONT}`;
    ctx.fillText(row.total, pad + labelW + cellW * 13 - 8, y + 14);
  });
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = `11px ${FONT}`;
  const noteTop = top + cellH * (data.rows.length + 1) + 18;
  noteLines.forEach((line, index) => ctx.fillText(line, pad, noteTop + index * 13));
  ctx.font = `10px ${FONT}`;
  ctx.fillText(data.footer, pad, height - 8);
  save(canvas, filename);
}
