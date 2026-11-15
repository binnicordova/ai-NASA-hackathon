import { areaLabel, type AreaOfInterest } from '../../area-of-interest/domain/area';
import { byId, el } from '../../shared/dom';
import { compact, fmt, monthLabel, parseMonthKey } from '../../shared/format';
import { monthNames, t, type Key } from '../../shared/i18n';
import { LEVEL_COLORS } from '../../shared/palette';
import { metricLabel, type Anomaly, type BurnCalendar, type Meta, type Metric, type RankingRow } from '../domain/types';

const setText = (id: string, text: string): void => {
  byId(id).textContent = text;
};

function showNote(id: string, text: string | null): void {
  const note = byId(id);
  note.hidden = !text;
  note.textContent = text ?? '';
}

/** Tarjeta "en el rango elegido": focos, eventos de fuego y actividad armonizada. */
export function renderRangeCard(calendar: BurnCalendar, area: AreaOfInterest, metric: Metric): void {
  const summary = calendar.rangeSummary;
  const from = parseMonthKey(calendar.range.from)!;
  const to = parseMonthKey(calendar.range.to)!;
  setText('scopeLabel', areaLabel(area));
  setText('rangeLabel', t('range.label', { from: monthLabel(from.year, from.month), to: monthLabel(to.year, to.month), n: calendar.range.months }));
  setText('unitChip', metricLabel(metric));
  setText('rangeHotspots', fmt(summary.hotspots));
  setText('rangeEvents', summary.events === null ? t('na') : fmt(summary.events));
  setText('rangeHarmonized', fmt(summary.harmonized));
  showNote(
    'rangeNote',
    summary.mixesSensorEras
      ? t('range.mixed') + (summary.eventsModis !== null ? t('range.mixed.modis', { n: fmt(summary.eventsModis) }) : '') + t('range.mixed.ok')
      : null,
  );
  const peak = calendar.peakSeason;
  setText(
    'peakSeason',
    peak.months.length
      ? t('peak', { months: peak.months.map((m) => monthNames()[m - 1]).join(', '), pct: Math.round(peak.share * 100) })
      : t('peak.none'),
  );
}

/** Indicadores del mes elegido: una lectura en palabras, el valor, la razón frente a la mediana y el percentil. */
export function renderMonthCard(
  calendar: BurnCalendar,
  anomaly: Anomaly | null,
  metric: Metric,
  selected: { year: number; month: number },
): void {
  const point = calendar.series.find((p) => p.year === selected.year && p.month === selected.month);
  const fresh = anomaly && anomaly.year === selected.year && anomaly.month === selected.month ? anomaly : null;
  const toDate = fresh?.monthToDateDays ?? null;
  setText('monthLabel', monthLabel(selected.year, selected.month) + (toDate ? t('month.toDate', { d: toDate }) : ''));
  setText('monthValueLabel', metric === 'harmonized' ? t('kpi.activity') : metric === 'hotspots' ? t('kpi.hotspots') : t('kpi.events'));
  const shown = metric === 'harmonized' ? (fresh?.value ?? point?.harmonized ?? 0) : metric === 'hotspots' ? (point?.hotspots ?? 0) : (point?.events ?? 0);
  setText('monthValue', fmt(shown));

  const verdict = byId('verdict');
  verdict.hidden = true;
  if (metric !== 'harmonized') {
    setText('monthRatio', '—');
    setText('monthPercentile', '—');
    showNote('monthNote', t('note.notComparable', { metric: metricLabel(metric) }));
    return;
  }
  if (!fresh) {
    setText('monthRatio', '…');
    setText('monthPercentile', '…');
    showNote('monthNote', null);
    return;
  }
  setText('monthRatio', fresh.ratio === null ? '—' : `${fresh.ratio.toFixed(1)}×`);
  // Sin una mediana válida el percentil no dice nada: se muestra vacío igual que la razón.
  setText('monthPercentile', !fresh.valid || fresh.percentile === null ? '—' : `p${fresh.percentile}`);
  if (fresh.valid && fresh.category) {
    // La lectura se da con texto y un signo, nunca solo con color.
    const sign = { below: '↓', normal: '≈', above: '↑', well_above: '⇈' }[fresh.category];
    verdict.hidden = false;
    verdict.dataset.category = fresh.category;
    verdict.textContent = `${sign} ${t(`verdict.${fresh.category}` as Key, { month: monthNames()[selected.month - 1]! })}`;
  }
  const [refFrom, refTo] = calendar.referenceYears;
  showNote(
    'monthNote',
    !fresh.valid ? t('note.invalid') : toDate ? t('note.toDate', { d: toDate, a: refFrom, b: refTo }) : fresh.lowConfidence ? t('note.lowConf') : null,
  );
}

export function renderLevelLegend(calendar: BurnCalendar): void {
  const [low, , veryHigh] = calendar.levels.thresholds;
  byId('levelLegend').replaceChildren(
    ...LEVEL_COLORS.map((color, index) =>
      el('span', { className: 'row' },
        el('span', { style: `width:10px;height:10px;border-radius:2px;background:${color}${index === 0 ? ';border:1px solid var(--bd)' : ''}` }),
        t(`level.${index}` as Key) + (index === 0 ? t('level.under', { v: compact(low ?? 0) }) : index === 3 ? t('level.over', { v: compact(veryHigh ?? 0) }) : ''),
      ),
    ),
  );
}

export function renderRanking(rows: RankingRow[], metric: Metric, area: AreaOfInterest, onPick: (department: string) => void): void {
  const value = (r: RankingRow): number => (metric === 'events' ? (r.events ?? 0) : r[metric]);
  const sorted = [...rows].sort((a, b) => value(b) - value(a)).slice(0, 8);
  byId('rankingBody').replaceChildren(
    ...sorted.map((row, index) => {
      const pick = el('button', { type: 'button', className: 'link', textContent: row.department });
      if (area.kind === 'department' && area.department === row.department) pick.setAttribute('aria-current', 'true');
      pick.addEventListener('click', () => onPick(row.department));
      return el('tr', {},
        el('td', { textContent: String(index + 1) }),
        el('td', {}, pick),
        el('td', { textContent: fmt(row.hotspots) }),
        el('td', { textContent: row.events === null ? t('na') : fmt(row.events) }),
        el('td', { textContent: fmt(row.harmonized) }),
      );
    }),
  );
  setText('rankingSort', t('rank.sort', { metric: metricLabel(metric).toLowerCase() }));
}

/** Textos que dependen de los metadatos: validación antes/después, límites y fuente. */
export function renderAbout(meta: Meta | null): void {
  const monthly = meta?.validation?.['holdout_2021_2024_monthly'];
  const before = monthly?.['before_unharmonized_cells']?.mape_pct;
  const after = monthly?.['after_harmonized_oos']?.mape_pct;
  setText('validationText', t('ba.text') + (before !== undefined && after !== undefined ? t('ba.validation', { b: before, a: after }) : ''));
  byId('caveats').replaceChildren(...[1, 2, 3, 4, 5, 6].map((n) => el('li', { textContent: t(`caveat.${n}` as Key) })));
  if (meta) setText('source', t('source', { a: meta.firstDate, b: meta.lastDate }));
}

export function renderStatus(loading: boolean, error: string | null): void {
  const status = byId('status');
  status.hidden = !loading && !error;
  status.textContent = error ?? t('status.loading');
  status.classList.toggle('error', Boolean(error));
}
