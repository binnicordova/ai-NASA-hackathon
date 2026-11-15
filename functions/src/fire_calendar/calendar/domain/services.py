"""Servicios de dominio del Calendario: reglas puras sobre una HarmonizedSeries."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from fire_calendar.shared.kernel import DateRange, YearMonth

from .model import (
    MIN_YEARS_FOR_ANOMALY,
    VIIRS_START_YEAR,
    ActivityLevels,
    Anomaly,
    AnomalyCategory,
    HarmonizedSeries,
    HistoricalMedian,
    MonthFrequency,
    PeakSeason,
    RangeSummary,
    YearlyTotal,
)

LEVEL_QUANTILES = (0.50, 0.75, 0.90)
PEAK_SEASON_SHARE = 0.66


def quantile(values: Sequence[float], q: float) -> float:
    """Cuantil con interpolación lineal (misma definición que numpy por defecto)."""
    if not values:
        raise ValueError("No se puede calcular un cuantil sin valores")
    ordered = sorted(values)
    position = q * (len(ordered) - 1)
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def _percentile_of(value: float, reference: Sequence[float]) -> int:
    return round(100 * sum(1 for r in reference if r < value) / len(reference))


def categorize(percentile: int) -> AnomalyCategory:
    if percentile >= 90:
        return AnomalyCategory.WELL_ABOVE
    if percentile >= 75:
        return AnomalyCategory.ABOVE
    if percentile >= 25:
        return AnomalyCategory.NORMAL
    return AnomalyCategory.BELOW


def historical_medians(series: HarmonizedSeries) -> tuple[HistoricalMedian, ...]:
    out = []
    for month in range(1, 13):
        ref = series.reference_values(month)
        if ref:
            out.append(HistoricalMedian(month, quantile(ref, 0.5), quantile(ref, 0.1), quantile(ref, 0.9), len(ref)))
        else:
            out.append(HistoricalMedian(month, 0.0, 0.0, 0.0, 0))
    return tuple(out)


def anomaly(
    series: HarmonizedSeries,
    period: YearMonth,
    month_to_date_by_year: Mapping[int, float] | None = None,
) -> Anomaly:
    """Anomalía de un mes frente a su mediana histórica.

    El mes en curso está incompleto: compararlo con meses completos lo haría parecer
    siempre "por debajo de lo normal". Si se entrega `month_to_date_by_year`
    (actividad de los mismos días del mes, por año), la comparación es de igual a igual.
    """
    current = series.get(period)
    if current is None:
        raise ValueError(f"{period} está fuera de la serie")

    days = None
    if series.is_month_to_date(period) and month_to_date_by_year is not None:
        value = float(month_to_date_by_year.get(period.year, 0.0))
        reference = [float(month_to_date_by_year.get(y, 0.0)) for y in series.reference_years]
        days = series.last_day
    else:
        value = current.harmonized
        reference = series.reference_values(period.month)

    if len(reference) < MIN_YEARS_FOR_ANOMALY:
        return Anomaly(period, value, None, None, None, days, current.low_confidence, valid=False)

    median = quantile(reference, 0.5)
    ratio = value / median if median > 0 else None
    percentile = _percentile_of(value, reference)
    return Anomaly(
        period, value, median, ratio, percentile, days, current.low_confidence,
        valid=ratio is not None,
        category=categorize(percentile) if ratio is not None else None,
    )


def activity_levels(series: HarmonizedSeries) -> ActivityLevels:
    """Frecuencia histórica: en cuántos años cada mes del calendario alcanzó cada nivel.

    Es una descripción del pasado, no un pronóstico.
    """
    years = series.reference_years
    reference = [m.harmonized for m in series.months if m.period.year in years]
    if not reference:
        return ActivityLevels((0.0, 0.0, 0.0), tuple(MonthFrequency(m, (0, 0, 0, 0), 0) for m in range(1, 13)))
    t50, t75, t90 = (quantile(reference, q) for q in LEVEL_QUANTILES)

    def level(value: float) -> int:
        return 3 if value > t90 else 2 if value > t75 else 1 if value > t50 else 0

    months = []
    for month in range(1, 13):
        counts = [0, 0, 0, 0]
        values = series.reference_values(month)
        for value in values:
            counts[level(value)] += 1
        months.append(MonthFrequency(month, (counts[0], counts[1], counts[2], counts[3]), len(values)))
    return ActivityLevels((t50, t75, t90), tuple(months))


def yearly_totals(series: HarmonizedSeries) -> tuple[YearlyTotal, ...]:
    by_year: dict[int, list] = {}
    for m in series.months:
        by_year.setdefault(m.period.year, []).append(m)
    has_events = any(m.events is not None for m in series.months)

    totals = {
        year: (
            sum(m.harmonized for m in ms), sum(m.low for m in ms), sum(m.high for m in ms),
            sum(m.hotspots for m in ms),
            sum(m.events or 0 for m in ms) if has_events else None,
            sum(m.events_modis or 0 for m in ms) if has_events else None,
        )
        for year, ms in by_year.items()
    }
    complete = sorted((y for y in totals if not series.is_partial_year(y)), key=lambda y: -totals[y][0])
    rank = {year: position + 1 for position, year in enumerate(complete)}
    return tuple(
        YearlyTotal(year, *totals[year], partial=series.is_partial_year(year), rank=rank.get(year))
        for year in sorted(totals)
    )


def peak_season(series: HarmonizedSeries) -> PeakSeason:
    """Meses que, en un año típico, concentran al menos dos tercios de la actividad."""
    medians = {m.month: m.median for m in historical_medians(series)}
    total = sum(medians.values())
    if total <= 0:
        return PeakSeason((), 0.0)
    chosen: list[int] = []
    accumulated = 0.0
    for month in sorted(medians, key=lambda k: -medians[k]):
        chosen.append(month)
        accumulated += medians[month]
        if accumulated / total >= PEAK_SEASON_SHARE:
            break
    return PeakSeason(tuple(sorted(chosen)), accumulated / total)


def range_summary(series: HarmonizedSeries, date_range: DateRange) -> RangeSummary:
    months = series.within(date_range)
    has_events = any(m.events is not None for m in months)
    return RangeSummary(
        date_range=date_range,
        hotspots=sum(m.hotspots for m in months),
        events=sum(m.events or 0 for m in months) if has_events else None,
        events_modis=sum(m.events_modis or 0 for m in months) if has_events else None,
        harmonized=sum(m.harmonized for m in months),
        mixes_sensor_eras=date_range.start.year < VIIRS_START_YEAR <= date_range.end.year,
    )
