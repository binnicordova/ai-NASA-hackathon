"""Puertos del Calendario: lo que el dominio necesita del mundo exterior."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Protocol

from fire_calendar.shared.kernel import AreaOfInterest, DayRange

from .model import HarmonizedSeries


@dataclass(frozen=True)
class ActiveCell:
    """Celda de la grilla común con actividad en un mes."""

    cell_id: str
    boundary: tuple[tuple[float, float], ...]  # vértices (lon, lat)
    department: str
    harmonized: float
    hotspots: int
    active_days: int


@dataclass(frozen=True)
class HotspotPoint:
    """Un foco de calor tal como lo publica FIRMS: posición, sensor y momento. No está armonizado."""

    longitude: float
    latitude: float
    instrument: str  # MODIS | VIIRS
    satellite: str
    acq_date: str
    acq_time: str
    confidence: str
    frp: float | None
    daynight: str


@dataclass(frozen=True)
class HotspotSummary:
    """Resumen de TODOS los focos crudos del área y el rango (no solo de los que se dibujan). Sin armonizar."""

    total: int
    active_days: int
    hexagons: int  # celdas H3 res 6 (~36 km²) con al menos un foco
    by_sensor: dict[str, int]
    by_satellite: dict[str, int]
    by_daynight: dict[str, int]
    by_confidence: dict[str, int]
    frp_median: float | None
    frp_max: float | None
    busiest_day: str | None
    busiest_count: int


@dataclass(frozen=True)
class EventSummary:
    """Focos agrupados por día: buffer de 375 m (VIIRS) o 1 km (MODIS) y disolución de los que se tocan ese día.

    Cada grupo es un "evento de fuego" del día (src/etl/fire_events.py). Un incendio de varios días cuenta una vez por día.
    """

    total: int
    hotspots: int
    active_days: int
    busiest_day: str | None
    busiest_count: int
    sizes: dict[str, int]  # eventos con 1, 2–5, 6–20 y más de 20 focos
    largest_hotspots: int
    largest_day: str | None
    largest_frp: float | None
    largest_lat: float | None
    largest_lon: float | None


@dataclass(frozen=True)
class HotspotSample:
    """Focos de un área y un rango: los más recientes hasta un límite, y cuántos hay en total."""

    total: int
    points: list[HotspotPoint]
    summary: HotspotSummary | None = None
    events: EventSummary | None = None

    @property
    def truncated(self) -> bool:
        return self.total > len(self.points)


@dataclass(frozen=True)
class DailyActivity:
    """Serie diaria densa (un valor por día, ceros incluidos) desde `start`. Fondo de la línea de tiempo."""

    start: str  # AAAA-MM-DD del primer valor
    harmonized: tuple[float, ...]
    hotspots: tuple[int, ...]
    events: tuple[int, ...] | None


@dataclass(frozen=True)
class DepartmentTotal:
    department: str
    harmonized: float
    hotspots: int
    events: int | None
    hexagons: int = 0  # celdas H3 res 6 (~36 km²) con al menos un foco en el rango


class HarmonizedSeriesGateway(Protocol):
    """Acceso a la serie armonizada que produce data/ (src/etl/harmonize_firms.py)."""

    def monthly_series(self, area: AreaOfInterest) -> HarmonizedSeries: ...

    def month_to_date_by_year(self, area: AreaOfInterest, month: int, last_day: int) -> Mapping[int, float]: ...

    def daily_activity(self, area: AreaOfInterest) -> DailyActivity: ...

    def active_cells(self, area: AreaOfInterest, days: DayRange) -> list[ActiveCell]: ...

    def department_totals(self, days: DayRange) -> list[DepartmentTotal]: ...

    def departments(self) -> list[str]: ...

    def date_span(self) -> tuple[str, str]: ...

    def validation(self) -> dict | None: ...

    def export_rows(self, area: AreaOfInterest, days: DayRange) -> Iterator[tuple]: ...

    def has_hotspot_points(self) -> bool: ...

    def export_hotspot_rows(self, area: AreaOfInterest, days: DayRange) -> Iterator[tuple]: ...

    def hotspot_points(self, area: AreaOfInterest, days: DayRange, limit: int) -> HotspotSample: ...

    def limits(self) -> dict | None: ...

    def boundary(self, area: AreaOfInterest) -> dict | None: ...

    def units(self, level: str) -> list[tuple[str, str, str]]: ...

    def unit_month_events(self, level: str) -> Mapping[str, Mapping[tuple[int, int], int]]: ...

    def shapes(self, level: str) -> dict | None: ...
