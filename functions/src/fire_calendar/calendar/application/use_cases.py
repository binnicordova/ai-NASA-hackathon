"""Casos de uso del Calendario. Orquestan el dominio; no contienen reglas de negocio."""

from __future__ import annotations

from dataclasses import dataclass

from fire_calendar.shared.kernel import AreaOfInterest, DateRange, DayRange, DomainError, YearMonth

from ..domain import services
from ..domain.model import (
    REFERENCE_START_YEAR,
    ActivityLevels,
    Anomaly,
    HarmonizedSeries,
    HistoricalMedian,
    ForecastMap,
    MonthForecast,
    PeakSeason,
    RangeSummary,
    UnitForecast,
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


LEVELS = ("department", "province", "district")
# Prueba fuera de muestra: los mismos años de prueba que la validación de la armonización (desde 2021).
CHECK_TEST_START = 2021


class GetFireForecast:
    """Predicción de fuego por mes: eventos esperados (λ), probabilidad de al menos uno y rango del 80 %.

    Modelo de Poisson sobre los eventos MODIS del mismo mes en años anteriores (Poisson-Gamma cuando los años varían
    más de lo que admite un Poisson). Es estacional: no usa clima ni lo que va del año. La prueba fuera de muestra
    dice cuánto se cumplió en años que no se usaron para ajustarlo.
    """

    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway
        self._maps: dict[str, ForecastMap] = {}

    def _years(self) -> tuple[int, int]:
        # Años completos con Terra y Aqua: de 2003 al año pasado.
        last_year = int(self._gateway.date_span()[1][:4])
        return REFERENCE_START_YEAR, last_year - 1

    def by_unit(self, level: str) -> ForecastMap:
        if level not in LEVELS:
            raise DomainError(f"Nivel desconocido: {level}. Usa department, province o district")
        if level not in self._maps:
            first, last = self._years()
            years = list(range(first, last + 1))
            totals = self._gateway.unit_month_events(level)
            units = tuple(
                UnitForecast(key, name, parent, services.forecast_months(totals.get(key, {}), years))
                for key, name, parent in self._gateway.units(level)
            )
            check = services.forecast_check(totals, [u.key for u in units], (first, CHECK_TEST_START - 1), (CHECK_TEST_START, last))
            self._maps[level] = ForecastMap(level, (first, last), units, check)
        return self._maps[level]

    def for_area(self, area: AreaOfInterest) -> tuple[tuple[int, int], tuple[MonthForecast, ...]]:
        series = self._gateway.monthly_series(area)
        first, last = self._years()
        counts = {(m.period.year, m.period.month): m.events_modis or 0 for m in series.months}
        return (first, last), services.forecast_months(counts, list(range(first, last + 1)))
