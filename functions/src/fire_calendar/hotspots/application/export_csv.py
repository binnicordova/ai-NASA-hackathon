"""Casos de uso de Exportación: CSV de lo detectado en el área y el rango elegidos."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, Iterator

from fire_calendar.calendar.domain.ports import HarmonizedSeriesGateway
from fire_calendar.shared.kernel import AreaOfInterest, DayRange

# Un foco de calor por fila: lo que pide el enunciado ("CSV de los focos detectados en la búsqueda").
HOTSPOT_COLUMNS = (
    "acq_date", "acq_time_utc", "latitude", "longitude", "satellite", "instrument", "confidence",
    "frp_mw", "daynight", "source", "cell_id", "department",
)

# Una celda-día activa por fila: la unidad en la que MODIS y VIIRS son comparables.
CELL_DAY_COLUMNS = (
    "acq_date", "cell_id", "lat_center", "lon_center", "department", "natural_region", "instrument",
    "raw_hotspots_count", "harmonized_fire_activity", "harmonized_uncertainty_low",
    "harmonized_uncertainty_high", "max_frp", "is_primary_series", "calibration_regime", "quality_flag",
)


def stream_csv(header: Iterable[str], rows: Iterable[tuple]) -> Iterator[str]:
    """Escribe CSV por trozos para no cargar en memoria exportaciones de millones de filas."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
        if buffer.tell() > 64_000:
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
    yield buffer.getvalue()


class ExportHotspotsCsv:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    @property
    def available(self) -> bool:
        return self._gateway.has_hotspot_points()

    def __call__(self, area: AreaOfInterest, days: DayRange) -> Iterator[str]:
        return stream_csv(HOTSPOT_COLUMNS, self._gateway.export_hotspot_rows(area, days))


class ExportActivityCsv:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway

    def __call__(self, area: AreaOfInterest, days: DayRange) -> Iterator[str]:
        return stream_csv(CELL_DAY_COLUMNS, self._gateway.export_rows(area, days))
