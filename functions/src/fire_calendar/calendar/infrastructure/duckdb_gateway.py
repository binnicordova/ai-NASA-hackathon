"""Adaptador: lee data/processed/harmonized_fires.parquet con DuckDB e implementa el puerto del Calendario.

Es el único lugar que conoce las columnas del parquet. De aquí hacia dentro todo usa el modelo del dominio.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from collections.abc import Iterator, Mapping
from pathlib import Path

import duckdb
import h3

from fire_calendar.shared.kernel import AreaOfInterest, DateRange, DomainError, YearMonth

from ..domain.model import HarmonizedSeries, MonthlyActivity
from ..domain.ports import ActiveCell, DepartmentTotal

_SERIES_CACHE_SIZE = 64

_EXPORT_SQL = """
    select acq_date, h3_res6, round(lat_center, 5), round(lon_center, 5), department, natural_region,
           instrument, raw_hotspots_count, round(harmonized_fire_activity, 4),
           round(harmonized_uncertainty_low, 4), round(harmonized_uncertainty_high, 4), max_frp,
           is_primary_series, calibration_regime, quality_flag
    from activity
    where {area} and year * 100 + month between ? and ?
    order by acq_date, h3_res6, instrument
"""


_HOTSPOTS_SQL = """
    select acq_date, acq_time, latitude, longitude, satellite, instrument, confidence, frp, daynight,
           source, cell_id, department
    from read_parquet(?)
    where {area} and acq_date between ? and ?
    order by acq_date, acq_time
"""


class DuckDbHarmonizedSeriesGateway:
    def __init__(
        self,
        harmonized_parquet: Path,
        events_parquet: Path | None = None,
        summary_json: Path | None = None,
        hotspots_parquet: Path | None = None,
    ) -> None:
        if not harmonized_parquet.exists():
            raise FileNotFoundError(f"No existe la serie armonizada: {harmonized_parquet}")
        self._con = duckdb.connect()
        self._con.execute(
            """create table activity as
               select acq_date, h3_res6, lat_center, lon_center, department, natural_region, instrument,
                      raw_hotspots_count, harmonized_fire_activity, harmonized_uncertainty_low,
                      harmonized_uncertainty_high, max_frp, is_primary_series, calibration_regime, quality_flag,
                      cast(year as integer) as year, cast(month as integer) as month,
                      cast(substr(acq_date, 9, 2) as integer) as day
               from read_parquet(?)""",  # solo las columnas que se usan: menos memoria en el servidor
            [str(harmonized_parquet)],
        )
        self._has_events = bool(events_parquet and events_parquet.exists())
        if self._has_events:
            self._con.execute(
                """create table events as
                   select sensor_set, lat, lon, department,
                          cast(substr(acq_date, 1, 4) as integer) as year,
                          cast(substr(acq_date, 6, 2) as integer) as month
                   from read_parquet(?) where sensor_set in ('all', 'modis')""",
                [str(events_parquet)],
            )
        first, last = self._con.execute("select min(acq_date), max(acq_date) from activity").fetchone()
        self._first_date, self._last_date = str(first), str(last)
        self._departments = [r[0] for r in self._con.execute("select distinct department from activity order by 1").fetchall()]
        self._summary_json = summary_json
        # Los focos individuales no se cargan en memoria: se leen del parquet solo al exportar.
        self._hotspots_parquet = hotspots_parquet if hotspots_parquet and hotspots_parquet.exists() else None
        self._series_cache: OrderedDict[AreaOfInterest, HarmonizedSeries] = OrderedDict()
        self._boundaries: dict[str, tuple[tuple[float, float], ...]] = {}

    # --- filtros de área -------------------------------------------------

    def _area_sql(self, area: AreaOfInterest, lon: str = "lon_center", lat: str = "lat_center") -> tuple[str, list]:
        if area.kind == "department":
            if area.department not in self._departments:
                raise DomainError(f"Departamento desconocido: {area.department}")
            return "department = ?", [area.department]
        if area.kind == "bbox" and area.bbox:
            b = area.bbox
            return f"{lon} between ? and ? and {lat} between ? and ?", [b.west, b.east, b.south, b.north]
        return "true", []

    def _query(self, sql: str, params: list) -> list[tuple]:
        return self._con.cursor().execute(sql, params).fetchall()

    # --- puerto ----------------------------------------------------------

    def monthly_series(self, area: AreaOfInterest) -> HarmonizedSeries:
        if area in self._series_cache:
            self._series_cache.move_to_end(area)
            return self._series_cache[area]

        where, params = self._area_sql(area)
        activity = {
            (y, m): (h or 0.0, lo or 0.0, hi or 0.0, raw or 0)
            for y, m, h, lo, hi, raw in self._query(
                f"""select year, month,
                           sum(harmonized_fire_activity) filter (where is_primary_series),
                           sum(harmonized_uncertainty_low) filter (where is_primary_series),
                           sum(harmonized_uncertainty_high) filter (where is_primary_series),
                           sum(raw_hotspots_count)
                    from activity where {where} group by 1, 2""",
                params,
            )
        }
        events: dict[tuple[int, int], tuple[int, int]] = {}
        if self._has_events:
            ewhere, eparams = self._area_sql(area, lon="lon", lat="lat")
            events = {
                (y, m): (a, mo)
                for y, m, a, mo in self._query(
                    f"""select year, month, count(*) filter (where sensor_set = 'all'),
                               count(*) filter (where sensor_set = 'modis')
                        from events where {ewhere} group by 1, 2""",
                    eparams,
                )
            }

        months = []
        year, month = int(self._first_date[:4]), int(self._first_date[5:7])
        end = (int(self._last_date[:4]), int(self._last_date[5:7]))
        while (year, month) <= end:
            h, lo, hi, raw = activity.get((year, month), (0.0, 0.0, 0.0, 0))
            ev = events.get((year, month), (0, 0)) if self._has_events else (None, None)
            months.append(MonthlyActivity(YearMonth(year, month), float(h), float(lo), float(hi), int(raw), ev[0], ev[1]))
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)

        series = HarmonizedSeries(tuple(months), last_day=int(self._last_date[8:10]))
        self._series_cache[area] = series
        if len(self._series_cache) > _SERIES_CACHE_SIZE:
            self._series_cache.popitem(last=False)
        return series

    def month_to_date_by_year(self, area: AreaOfInterest, month: int, last_day: int) -> Mapping[int, float]:
        where, params = self._area_sql(area)
        rows = self._query(
            f"""select year, sum(harmonized_fire_activity) from activity
                where {where} and is_primary_series and month = ? and day <= ? group by 1""",
            [*params, month, last_day],
        )
        return {int(y): float(v or 0.0) for y, v in rows}

    def active_cells(self, area: AreaOfInterest, period: YearMonth) -> list[ActiveCell]:
        where, params = self._area_sql(area)
        rows = self._query(
            f"""select h3_res6, any_value(department),
                       coalesce(sum(harmonized_fire_activity) filter (where is_primary_series), 0),
                       sum(raw_hotspots_count), count(distinct acq_date)
                from activity where {where} and year = ? and month = ? group by 1""",
            [*params, period.year, period.month],
        )
        return [ActiveCell(c, self._boundary(c), d, float(h), int(raw), int(days)) for c, d, h, raw, days in rows]

    def _boundary(self, cell: str) -> tuple[tuple[float, float], ...]:
        if cell not in self._boundaries:
            self._boundaries[cell] = tuple((round(lng, 5), round(lat, 5)) for lat, lng in h3.cell_to_boundary(cell))
        return self._boundaries[cell]

    def department_totals(self, date_range: DateRange) -> list[DepartmentTotal]:
        span = [date_range.start.year * 100 + date_range.start.month, date_range.end.year * 100 + date_range.end.month]
        events = {}
        if self._has_events:
            events = dict(
                self._query(
                    "select department, count(*) from events where sensor_set = 'all' and year * 100 + month between ? and ? group by 1",
                    span,
                )
            )
        rows = self._query(
            """select department, coalesce(sum(harmonized_fire_activity) filter (where is_primary_series), 0),
                      sum(raw_hotspots_count)
               from activity where year * 100 + month between ? and ? group by 1""",
            span,
        )
        return [
            DepartmentTotal(d, float(h), int(raw), int(events.get(d, 0)) if self._has_events else None)
            for d, h, raw in rows
        ]

    def departments(self) -> list[str]:
        return list(self._departments)

    def date_span(self) -> tuple[str, str]:
        return self._first_date, self._last_date

    def validation(self) -> dict | None:
        """Métricas antes/después calculadas por el pipeline de armonización (no se recalculan aquí)."""
        if not self._summary_json or not self._summary_json.exists():
            return None
        return json.loads(self._summary_json.read_text()).get("validation_metrics")

    def has_hotspot_points(self) -> bool:
        return self._hotspots_parquet is not None

    def export_hotspot_rows(self, area: AreaOfInterest, date_range: DateRange) -> Iterator[tuple]:
        if self._hotspots_parquet is None:
            raise DomainError("Los focos individuales no están disponibles en este despliegue")
        where, params = self._area_sql(area, lon="longitude", lat="latitude")
        end = date_range.end
        cursor = self._con.cursor().execute(
            _HOTSPOTS_SQL.format(area=where),
            [str(self._hotspots_parquet), *params, f"{date_range.start}-01", f"{end}-31"],
        )
        while batch := cursor.fetchmany(5000):
            yield from batch

    def export_rows(self, area: AreaOfInterest, date_range: DateRange) -> Iterator[tuple]:
        where, params = self._area_sql(area)
        cursor = self._con.cursor().execute(
            _EXPORT_SQL.format(area=where),
            [*params, date_range.start.year * 100 + date_range.start.month, date_range.end.year * 100 + date_range.end.month],
        )
        while batch := cursor.fetchmany(5000):
            yield from batch
