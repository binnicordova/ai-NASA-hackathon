import { driver, type Alignment, type DriveStep, type Driver, type PopoverDOM, type Side } from 'driver.js';
import 'driver.js/dist/driver.css';

import type { CalendarController } from '../../calendar/application/calendarController';
import { monthName, percent } from '../../calendar/ui/riskPanel';
import { cssToken, el, escapeHtml } from '../../shared/dom';
import { fmt } from '../../shared/format';
import { lang, locale, t } from '../../shared/i18n';
import { addDays } from '../../shared/format';
import { activeDays, latestDays, latestDetection, monthRank, peakMonth, rawVersusHarmonized, sensorCounts, SICUANI, watchMonths } from '../domain/sicuani';

/** Lo que el recorrido necesita de la app: el caso de uso de la vista y dos ajustes de la interfaz. */
export interface TourHost {
  controller: CalendarController;
  /** Muestra las secciones ocultas mientras dura el recorrido; devuelve cómo dejarlas como estaban. */
  revealSections(): () => void;
  /** Encuadra la línea de tiempo: en el rango elegido o, con `all`, en todo el periodo. */
  frameTimeline(all: boolean): void;
  /** Cambia el idioma de toda la app, igual que el botón del encabezado (que el velo del recorrido tapa). */
  switchLang(): void;
}

type Tab = 'harmonized' | 'hotspots' | 'risk';

interface CaseStep {
  /** Lo que se ilumina; sin elemento, el paso va centrado (la bienvenida). */
  element?: string;
  side?: Side;
  align?: Alignment;
  /** El mapa no deja sitio a su lado: el popover va dentro, en su esquina inferior derecha. */
  inMap?: boolean;
  /** Lleva la app al estado de este paso (área, fechas y pestaña) antes de mostrarlo. */
  enter?: () => Promise<void>;
  title: () => string;
  /** HTML: los textos son de `i18n.ts` y las cifras, números ya formateados. */
  body: () => string;
}

const CASE_YEAR = Number(SICUANI.from.slice(0, 4));
const CASE_MONTH = Number(SICUANI.from.slice(5, 7));
/** El popover va dentro del mapa solo con la disposición de escritorio: en el teléfono cabe debajo. */
const DESKTOP = '(min-width: 1024px)';

let active: Driver | null = null;

const link = (href: string, text: string): string => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`;

/** "agosto y septiembre" / "August and September". */
const listOf = (items: string[]): string => new Intl.ListFormat(locale(), { type: 'conjunction' }).format(items);

/** "4.º" / "4th". */
function ordinal(n: number): string {
  if (lang() === 'es') return `${n}.º`;
  const suffix = { one: 'st', two: 'nd', few: 'rd', other: 'th', zero: 'th', many: 'th' }[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n)];
  return `${n}${suffix}`;
}

const dayOf = (iso: string): number => Number(iso.slice(8, 10));

/** La hora de los satélites se cuenta en hora de Perú, para todos: es donde está el fuego. */
const PERU_TZ = 'America/Lima';

/** "hoy a las 01:09 (hora de Perú)", "ayer a las…" o "el 24 de noviembre a las…". */
function whenInPeru(at: Date): string {
  const dayIn = (d: Date): string => d.toLocaleDateString('en-CA', { timeZone: PERU_TZ }); // AAAA-MM-DD
  const today = dayIn(new Date());
  const seen = dayIn(at);
  const key = seen === today ? 'tour.time.today' : seen === addDays(today, -1) ? 'tour.time.yesterday' : 'tour.time.date';
  const time = at.toLocaleTimeString(locale(), { timeZone: PERU_TZ, hour: '2-digit', minute: '2-digit' });
  const date = at.toLocaleDateString(locale(), { timeZone: PERU_TZ, day: 'numeric', month: 'long' });
  return `${t(key, { time, date })} (${t('tour.time.peru')})`;
}

/** "Del 25 al 26 de noviembre" / "From November 25 to 26": el mes se dice una vez si es el mismo. */
function dayPair(from: string, to: string): { a: string; b: string } {
  const label = (iso: string, day = false): string =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), day ? { timeZone: 'UTC', day: 'numeric' } : { timeZone: 'UTC', day: 'numeric', month: 'long' });
  if (from.slice(0, 7) !== to.slice(0, 7)) return { a: label(from), b: label(to) };
  return lang() === 'es' ? { a: label(from, true), b: label(to) } : { a: label(from), b: label(to, true) };
}

/**
 * Bienvenida: la portada del video (una imagen local) y el reproductor de YouTube solo al pulsarla. Así la página no
 * carga nada de YouTube ni deja cookies hasta que alguien decide ver el video.
 */
function videoFacade(): string {
  const id = SICUANI.video[lang()];
  return `<div class="tour-video" data-video="${id}">
    <button type="button" class="tour-video-play" aria-label="${escapeHtml(t('tour.video.play'))}">
      <img src="/tour/sicuani-${lang()}.jpg" alt="" width="960" height="540" decoding="async">
      <span class="tour-video-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      <span class="tour-video-time" aria-hidden="true">0:30</span>
    </button>
  </div>`;
}

/**
 * El video y el recorrido van en el idioma de la app; este botón cambia los tres a la vez. Su texto va en el otro
 * idioma ("Watch in English" / "Ver en español"), para que lo encuentre quien no lee el actual.
 */
function langButton(): string {
  const other = lang() === 'es' ? 'en' : 'es';
  // El nombre accesible es el texto visible (en el otro idioma, con su `lang`); la explicación va en el título.
  return `<p class="tour-lang-row"><button type="button" class="tour-lang" lang="${other}" title="${escapeHtml(t('tour.lang.tip'))}">${escapeHtml(t('tour.lang'))}</button></p>`;
}

function playVideo(box: HTMLElement): void {
  const id = box.dataset.video ?? '';
  // El video está hecho para repetirse sin corte: loop necesita la lista con el mismo video. hl pone el reproductor
  // en el idioma de la app.
  const src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&loop=1&playlist=${id}&hl=${lang()}`;
  const frame = el('iframe', { src, title: t('tour.video.title'), allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
  box.replaceChildren(frame);
}

function buildSteps(host: TourHost): CaseStep[] {
  const { controller } = host;
  const data = controller.data;

  /** Sicuani en sus días, en la pestaña pedida. Solo se vuelve a pedir lo que cambia. */
  const show = async (tab: Tab): Promise<void> => {
    const s = controller.selection;
    const here = s.area.kind === 'district' && s.area.ubigeo === SICUANI.area.ubigeo && s.from === SICUANI.from && s.to === SICUANI.to;
    if (!here) {
      await controller.restore({ area: { ...SICUANI.area }, from: SICUANI.from, to: SICUANI.to, metric: tab === 'hotspots' ? 'hotspots' : 'harmonized', risk: tab === 'risk' });
    } else if (tab === 'risk') {
      if (!s.risk) await controller.setRisk();
    } else if (s.risk || s.metric !== tab) {
      await controller.setMetric(tab);
    }
    if (tab === 'risk') {
      // La Alerta temprana abre en el mes de más probabilidad: el que la lista no decía.
      const peak = data.areaForecast && peakMonth(data.areaForecast);
      if (peak) controller.setRiskMonth(peak.month);
    } else host.frameTimeline(false);
  };

  // La bienvenida dice cuántos pasos siguen: se cuenta al pintarla, cuando la lista ya existe.
  const steps: CaseStep[] = [
    {
      title: () => t('tour.welcome.title', { month: monthName(CASE_MONTH), year: CASE_YEAR }),
      body: () => {
        // Desde el inicio se ve que esto no es solo el pasado: los datos de NASA siguen llegando, solos.
        const seen = latestDetection(data.meta);
        const live = seen ? `<p class="tour-live"><span class="tour-live-dot" aria-hidden="true"></span>${escapeHtml(t('tour.welcome.live', { when: whenInPeru(seen.at) }))}</p>` : '';
        return `${live}${videoFacade()}${langButton()}<p>${t('tour.welcome.body', { n: steps.length - 1 })}</p><p class="tour-credit">${t('tour.welcome.credit')}</p>`;
      },
    },
    {
      element: '#areaPicker',
      side: 'right',
      align: 'start',
      enter: () => show('harmonized'),
      title: () => t('tour.place.title'),
      body: () => t('tour.place.body', { list: link(SICUANI.riskList, t('tour.place.list')) }),
    },
    {
      element: '#timeline',
      side: 'top',
      align: 'start',
      enter: () => show('harmonized'),
      title: () => t('tour.days.title', { a: dayOf(SICUANI.from), b: dayOf(SICUANI.to), month: monthName(CASE_MONTH) }),
      body: () => {
        const days = data.daily ? activeDays(data.daily, SICUANI.from, SICUANI.to) : null;
        const fire = !days || !days.active ? '' : days.active === days.days ? t('tour.days.all', { n: days.days }) : t('tour.days.some', { n: days.active, total: days.days });
        return [fire, t('tour.days.how')].filter(Boolean).join(' ');
      },
    },
    {
      element: '.map-wrap',
      inMap: true,
      enter: () => show('hotspots'),
      title: () => t('tour.sensors.title'),
      body: () => {
        const counts = sensorCounts(data.points?.summary ?? null);
        return [counts ? t('tour.sensors.counts', { viirs: fmt(counts.viirs), modis: fmt(counts.modis) }) : '', t('tour.sensors.why')].filter(Boolean).join(' ');
      },
    },
    {
      element: '#beforeAfterCard',
      side: 'left',
      align: 'center',
      enter: () => show('harmonized'),
      title: () => t('tour.harmonized.title'),
      body: () => {
        const pair = data.calendar ? rawVersusHarmonized(data.calendar, CASE_YEAR) : null;
        // La frase solo vale si los focos crudos y la actividad armonizada dicen cosas opuestas.
        const flips = pair && pair.year.hotspots > pair.reference.hotspots && pair.reference.harmonized > pair.year.harmonized;
        return pair && flips
          ? t('tour.harmonized.flip', { year: pair.year.year, raw: fmt(pair.year.hotspots), ref: pair.reference.year, refRaw: fmt(pair.reference.hotspots) })
          : t('tour.harmonized.plain');
      },
    },
    {
      element: '#calendarCard',
      side: 'left',
      align: 'center',
      enter: () => show('harmonized'),
      title: () => t('tour.calendar.title'),
      body: () => {
        const calendar = data.calendar;
        const parts = [t('tour.calendar.lead')];
        const season = calendar?.peakSeason.months ?? [];
        if (season.length) parts.push(t('tour.calendar.season', { months: listOf(season.map(monthName)) }));
        const place = calendar ? monthRank(calendar, CASE_YEAR, CASE_MONTH) : null;
        if (place) parts.push(place.rank === 1 ? t('tour.calendar.top', { since: place.since }) : t('tour.calendar.rank', { rank: ordinal(place.rank), since: place.since }));
        parts.push(t('tour.calendar.tap'));
        return parts.join(' ');
      },
    },
    {
      element: '#riskCard',
      side: 'left',
      align: 'start',
      enter: () => show('risk'),
      title: () => t('tour.forecast.title', { year: Number((data.meta?.lastDate ?? SICUANI.to).slice(0, 4)) + 1 }),
      body: () => {
        const forecast = data.areaForecast;
        if (!forecast) return t('tour.forecast.honest');
        // "agosto 48 %" no se parte entre dos líneas.
        const months = watchMonths(forecast).map((m) => `${monthName(m.month)}\u00a0${percent(m.pAny)}`);
        const check = data.forecast?.check;
        return [
          months.length ? t('tour.forecast.months', { months: listOf(months) }) : '',
          check ? t('tour.forecast.tested', { n: forecast.years.count, a: check.test[0], b: check.test[1] }) : t('tour.forecast.based', { n: forecast.years.count }),
          t('tour.forecast.honest'),
        ].filter(Boolean).join(' ');
      },
    },
    {
      // Del caso al presente: lo último que vieron los satélites en todo el Perú, con la hora de la última detección.
      element: '.map-wrap',
      inMap: true,
      enter: async () => {
        const last = data.meta?.lastDate;
        if (!last) return;
        await controller.restore({ ...latestDays(last), metric: 'hotspots' });
        host.frameTimeline(false);
      },
      title: () => t(latestDetection(data.meta) ? 'tour.live.title' : 'tour.live.title.static'),
      body: () => {
        const last = data.meta?.lastDate;
        const seen = latestDetection(data.meta);
        const spots = data.points?.summary?.total;
        const fires = data.points?.events?.total;
        const counts = last && spots !== undefined && fires !== undefined
          ? t('tour.live.counts', { ...dayPair(latestDays(last).from, last), n: fmt(spots), e: fmt(fires) })
          : '';
        // Solo se habla de vigilancia en vivo si la API sirve los datos que se refrescan solos.
        const watch = seen
          ? `${t('tour.live.watch', { sat: seen.satellite, when: whenInPeru(seen.at) })} ${t('tour.live.why')}`
          : last ? t('tour.live.static', { date: dayPair(last, last).b }) : '';
        return [counts, watch].filter(Boolean).map((p) => `<p>${p}</p>`).join('') + `<p class="tour-credit">${t('tour.live.caveat')}</p>`;
      },
    },
    {
      element: '#areaPicker',
      side: 'right',
      align: 'start',
      // Termina donde empieza una visita normal: todo el Perú, todo el periodo, para elegir el distrito propio.
      enter: async () => {
        await controller.restore({});
        host.frameTimeline(true);
      },
      title: () => t('tour.yours.title'),
      body: () => {
        const districts = data.limits?.districts.length;
        const yours = districts ? t('tour.yours.count', { n: fmt(districts) }) : t('tour.yours.any');
        return `<p>${yours}</p><p>${t('tour.yours.pilot', { contact: link(SICUANI.contact, t('tour.yours.contact')) })}</p>`;
      },
    },
  ];
  return steps;
}

/**
 * Recorrido del caso Sicuani con driver.js: la bienvenida con el video de 30 s y siete pasos que llevan la app al
 * distrito, a los días del incendio y a cada pestaña. Las cifras de cada paso se leen de los datos ya cargados.
 */
export function startCaseTour(host: TourHost): void {
  if (active?.isActive()) return;
  const steps = buildSteps(host);
  const restoreSections = host.revealSections();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = matchMedia(DESKTOP);
  const total = steps.length - 1;
  let busy = false;

  /** Mientras carga el paso siguiente, el actual queda atenuado y sin botones. */
  const setWaiting = (on: boolean): void => {
    const dom = tour.getState('popover') as PopoverDOM | undefined;
    if (!dom) return;
    dom.wrapper.classList.toggle('driver-popover-waiting', on);
    dom.wrapper.setAttribute('aria-busy', String(on));
    dom.nextButton.disabled = on;
    dom.previousButton.disabled = on;
  };

  const go = async (index: number): Promise<void> => {
    if (busy || index < 0) return;
    if (index >= steps.length) {
      tour.destroy();
      return;
    }
    busy = true;
    setWaiting(true);
    try {
      await steps[index]!.enter?.();
    } catch {
      /* la app muestra su propio aviso de error; el paso se ve igual */
    }
    setWaiting(false);
    busy = false;
    if (active === tour && tour.isActive()) tour.moveTo(index);
  };

  /** Esquina inferior derecha del mapa, en píxeles desde el borde de la ventana (el popover es fijo). */
  const pinInMap = (): void => {
    const rect = document.querySelector('.map-wrap')?.getBoundingClientRect();
    if (!rect) return;
    document.documentElement.style.setProperty('--tour-right', `${Math.max(16, innerWidth - rect.right + 16)}px`);
    document.documentElement.style.setProperty('--tour-bottom', `${Math.max(16, innerHeight - rect.bottom + 30)}px`);
  };

  /** Textos de los botones en el idioma de ahora: driver.js los pinta con los de su configuración, del inicio. */
  const nextText = (index: number): string => (index === 0 ? t('tour.start') : index === total ? t('tour.done') : t('tour.next'));

  const render = (dom: PopoverDOM, step: CaseStep, index: number): void => {
    // driver.js vuelve a pintar el popover al moverse la ventana: el texto solo se escribe al cambiar de paso o de
    // idioma, para no cortar el video que esté sonando.
    const key = `${index}:${lang()}`;
    if (dom.wrapper.dataset.step !== key) {
      dom.wrapper.dataset.step = key;
      dom.title.textContent = step.title();
      dom.description.innerHTML = step.body();
    }
    dom.nextButton.textContent = nextText(index);
    dom.previousButton.textContent = t('tour.prev');
    dom.closeButton.setAttribute('aria-label', t('tour.close'));
    if (index > 0) dom.progress.textContent = t('tour.progress', { n: index, total });
    const inMap = Boolean(step.inMap && desktop.matches);
    dom.wrapper.classList.toggle('tour-in-map', inMap);
    if (inMap) pinInMap();
    const skip = dom.footerButtons.querySelector<HTMLButtonElement>('.tour-skip');
    if (index === 0 && !skip) {
      const button = el('button', { type: 'button', className: 'driver-popover-footer-btn tour-skip', textContent: t('tour.skip') });
      button.addEventListener('click', () => tour.destroy());
      dom.footerButtons.prepend(button);
    } else if (index === 0 && skip) skip.textContent = t('tour.skip');
    else skip?.remove();
  };

  /** Cambia el idioma de la app y vuelve a escribir el paso abierto; si el video sonaba, sigue en el otro idioma. */
  const switchLang = (): void => {
    const dom = tour.getState('popover') as PopoverDOM | undefined;
    const index = tour.getActiveIndex() ?? 0;
    const playing = !!dom?.description.querySelector('.tour-video iframe');
    host.switchLang();
    if (!dom) return;
    render(dom, steps[index]!, index);
    if (playing) {
      const box = dom.description.querySelector<HTMLElement>('.tour-video');
      if (box) playVideo(box);
    }
    dom.description.querySelector<HTMLElement>('.tour-lang')?.focus();
    tour.refresh();
  };

  const driveSteps: DriveStep[] = steps.map((step, index) => ({
    element: step.element,
    popover: {
      // El texto real lo escribe `render` con los datos ya cargados.
      title: ' ',
      description: ' ',
      side: step.side,
      align: step.align,
      popoverClass: index === 0 ? 'nasat-tour tour-welcome' : 'nasat-tour',
      showButtons: index === 0 ? ['next', 'close'] : ['next', 'previous', 'close'],
      showProgress: index > 0,
      progressText: t('tour.progress', { n: index, total }),
      // driver.js deja que el texto del paso gane al de "terminar": el último paso lleva el suyo.
      nextBtnText: nextText(index),
      doneBtnText: t('tour.done'),
      onPopoverRender: (dom) => render(dom, step, index),
    },
  }));

  const tour: Driver = driver({
    steps: driveSteps,
    animate: !reduced,
    smoothScroll: !reduced,
    overlayColor: cssToken('--tour-overlay'),
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 12,
    popoverOffset: 12,
    prevBtnText: t('tour.prev'),
    closeBtnLabel: t('tour.close'),
    onNextClick: () => void go((tour.getActiveIndex() ?? 0) + 1),
    onPrevClick: () => void go((tour.getActiveIndex() ?? 0) - 1),
    onDoneClick: () => {
      tour.destroy();
      document.getElementById('department')?.focus();
    },
    onDestroyed: () => {
      if (active === tour) active = null;
      document.removeEventListener('click', onPlay);
      restoreSections();
    },
  });
  active = tour;

  /** El video empieza solo cuando alguien pulsa la portada; el botón de idioma cambia la app, el video y el texto. */
  function onPlay(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('.driver-popover .tour-lang')) {
      switchLang();
      return;
    }
    const box = target.closest<HTMLElement>('.driver-popover .tour-video');
    if (box && target.closest('.tour-video-play')) playVideo(box);
  }
  document.addEventListener('click', onPlay);

  tour.drive(0);
}
