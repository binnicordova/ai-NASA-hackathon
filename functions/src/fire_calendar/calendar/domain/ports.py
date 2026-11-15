"""Puertos del Calendario: lo que el dominio necesita del mundo exterior."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Protocol

from fire_calendar.shared.kernel import AreaOfInterest, DateRange, YearMonth

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
class DepartmentTotal:
    department: str
    harmonized: float
    hotspots: int
    events: int | None


class HarmonizedSeriesGateway(Protocol):
    """Acceso a la serie armonizada que produce data/ (src/etl/harmonize_firms.py)."""

    def monthly_series(self, area: AreaOfInterest) -> HarmonizedSeries: ...

    def month_to_date_by_year(self, area: AreaOfInterest, month: int, last_day: int) -> Mapping[int, float]: ...

    def active_cells(self, area: AreaOfInterest, period: YearMonth) -> list[ActiveCell]: ...

    def department_totals(self, date_range: DateRange) -> list[DepartmentTotal]: ...

    def departments(self) -> list[str]: ...

    def date_span(self) -> tuple[str, str]: ...

    def validation(self) -> dict | None: ...

    def export_rows(self, area: AreaOfInterest, date_range: DateRange) -> Iterator[tuple]: ...

    def has_hotspot_points(self) -> bool: ...

    def export_hotspot_rows(self, area: AreaOfInterest, date_range: DateRange) -> Iterator[tuple]: ...
