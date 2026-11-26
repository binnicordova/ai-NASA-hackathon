"""Ficha del distrito: una página que un gestor de riesgos imprime, adjunta o reenvía por WhatsApp.

No calcula nada nuevo: junta lo que ya dicen el Calendario (serie armonizada) y la Alerta temprana (predicción
estacional) para un distrito oficial del INEI, con su nombre y la fecha de los datos.
"""

from __future__ import annotations

from dataclasses import dataclass

from fire_calendar.calendar.domain.model import HarmonizedSeries, MonthForecast, PeakSeason

# Por debajo de esta probabilidad de fuego, un mes no se vigila (el mismo umbral que "casi nula" en la web).
WATCH_FLOOR = 0.05
# Cuántos meses a vigilar se nombran: los de más probabilidad, en el orden del calendario.
WATCH_COUNT = 3


@dataclass(frozen=True)
class DistrictName:
    """Un distrito oficial del INEI, con su provincia y su departamento (de arriba abajo)."""

    ubigeo: str
    name: str
    province: str
    department: str

    @property
    def parents(self) -> str:
        return f"{self.department} › {self.province}"


@dataclass(frozen=True)
class DistrictSheet:
    district: DistrictName
    series: HarmonizedSeries
    peak_season: PeakSeason
    forecast_year: int  # el año siguiente al último dato, como en la Alerta temprana
    watch: tuple[MonthForecast, ...]  # hasta WATCH_COUNT meses, de enero a diciembre
    last_date: str  # último día con datos (AAAA-MM-DD)
    first_date: str = ""  # primer día con datos
    bounds: tuple[float, float, float, float] | None = None  # caja del contorno: oeste, sur, este, norte
