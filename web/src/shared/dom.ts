export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Falta el elemento #${id}`);
  return node as T;
}

/**
 * Valor de un token de color de `styles.css`, ya resuelto para el tema activo.
 * Canvas y Leaflet necesitan el valor: no aceptan `var(--…)`.
 */
export function cssToken(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) throw new Error(`Falta el token ${name}`);
  return value;
}

type ElementProps<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & { style?: string };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElementProps<K>,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { style, ...rest } = (props ?? {}) as { style?: string } & Record<string, unknown>;
  Object.assign(node, rest);
  if (style) node.style.cssText = style;
  node.append(...children);
  return node;
}

/** Escapa texto que viene de datos antes de insertarlo como HTML. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
