"""Casos de uso del Calendario. Orquestan el dominio; no contienen reglas de negocio."""

from __future__ import annotations

from dataclasses import dataclass

from fire_calendar.shared.kernel import AreaOfInterest, DateRange, DayRange, DomainError, YearMonth

from ..domain import services
from ..domain.model import (
    ActivityLevels,
    Anomaly,
    HarmonizedSeries,
    HistoricalMedian,
    PeakSeason,
    RangeSummary,
    YearlyTotal,
)
from ..domain.ports import ActiveCell, DailyActivity, DepartmentTotal, HarmonizedSeriesGateway, HotspotSample


@dataclass(frozen=True)
class BurnCalendar:
    """Todo lo que una vista necesita para un área y un rango: el calendario y sus lecturas."""

    area: AreaOfInterest
    series: HarmonizedSeries
    date_range: DateRange
    range_summary: RangeSummary
    years: tuple[YearlyTotal, ...]
    medians: tuple[HistoricalMedian, ...]
    levels: ActivityLevels
    peak_season: PeakSeason


def _clamp(series: HarmonizedSeries, start: YearMonth | None, end: YearMonth | None) -> DateRange:
    full = series.full_range
    return DateRange(max(start or full.start, full.start), min(end or full.end, full.end))


class GetBurnCalendar:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest, start: YearMonth | None = None, end: YearMonth | None = None) -> BurnCalendar:
        series = self._gateway.monthly_series(area)
        date_range = _clamp(series, start, end)
        return BurnCalendar(
            area=area,
            series=series,
            date_range=date_range,
            range_summary=services.range_summary(series, date_range),
            years=services.yearly_totals(series),
            medians=services.historical_medians(series),
            levels=services.activity_levels(series),
            peak_season=services.peak_season(series),
        )


class GetAnomaly:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest, period: YearMonth | None = None) -> Anomaly:
        series = self._gateway.monthly_series(area)
        period = period or series.last.period
        if series.get(period) is None:
            raise DomainError(f"{period} está fuera de los datos disponibles")
        month_to_date = None
        if series.is_month_to_date(period):
            month_to_date = self._gateway.month_to_date_by_year(area, period.month, series.last_day)
        return services.anomaly(series, period, month_to_date)


class GetActiveCells:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest, days: DayRange) -> list[ActiveCell]:
        return self._gateway.active_cells(area, days)


class GetDailyActivity:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest) -> DailyActivity:
        return self._gateway.daily_activity(area)


class GetHotspotPoints:
    """Focos sin armonizar, uno por detección, para la vista cruda del mapa. Con tope para no saturar al cliente."""

    MAX_LIMIT = 50_000

    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest, days: DayRange, limit: int) -> HotspotSample:
        if not 1 <= limit <= self.MAX_LIMIT:
            raise DomainError(f"El límite debe estar entre 1 y {self.MAX_LIMIT}")
        return self._gateway.hotspot_points(area, days, limit)


class GetDepartmentRanking:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, days: DayRange) -> list[DepartmentTotal]:
        return sorted(self._gateway.department_totals(days), key=lambda d: -d.harmonized)
