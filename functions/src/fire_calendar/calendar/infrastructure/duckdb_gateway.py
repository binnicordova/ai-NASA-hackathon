"""Adaptador: lee data/processed/harmonized_fires.parquet con DuckDB e implementa el puerto del Calendario.

Es el único lugar que conoce las columnas del parquet. De aquí hacia dentro todo usa el modelo del dominio.
"""

from __future__ import annotations

import json
import os
import unicodedata
from collections import OrderedDict
from collections.abc import Iterator, Mapping
from datetime import date
from functools import lru_cache
from pathlib import Path

import duckdb
import h3

from fire_calendar.shared.kernel import AreaOfInterest, DayRange, DomainError, YearMonth

from ..domain.model import HarmonizedSeries, MonthlyActivity
from ..domain.ports import ActiveCell, DailyActivity, DepartmentTotal, EventSummary, HotspotPoint, HotspotSample, HotspotSummary

_SERIES_CACHE_SIZE = 64

_EXPORT_SQL = """
    select acq_date, h3_res6, round(lat_center, 5), round(lon_center, 5), department, natural_region,
           instrument, raw_hotspots_count, round(harmonized_fire_activity, 4),
           round(harmonized_uncertainty_low, 4), round(harmonized_uncertainty_high, 4), max_frp,
           is_primary_series, calibration_regime, quality_flag
    from activity
    where {area} and acq_date between ? and ?
    order by acq_date, h3_res6, instrument
"""


# El departamento sale de la celda (límites oficiales del INEI si están cargados), igual que en el resto de la API.
_HOTSPOTS_SQL = """
    select acq_date, acq_time, latitude, longitude, satellite, instrument, confidence, frp, daynight,
           source, cell_id, coalesce(d.department, p.department)
    from read_parquet(?) p left join cell_dept d on d.h3_res6 = p.cell_id
    where {area} and acq_date between ? and ?
    order by acq_date, acq_time
"""


# Los más recientes primero: si el rango tiene más focos que el límite, se ve lo último que pasó.
_POINTS_SQL = """
    select round(longitude, 5), round(latitude, 5), instrument, satellite, acq_date, acq_time, confidence,
           frp, daynight, count(*) over () as total
    from read_parquet(?)
    where {area} and acq_date between ? and ?
    order by acq_date desc, acq_time desc
    limit ?
"""


class DuckDbHarmonizedSeriesGateway:
    def __init__(
        self,
        harmonized_parquet: Path,
        events_parquet: Path | None = None,
        summary_json: Path | None = None,
        hotspots_parquet: Path | None = None,
        limits_json: Path | None = None,
    ) -> None:
        if not harmonized_parquet.exists():
            raise FileNotFoundError(f"No existe la serie armonizada: {harmonized_parquet}")
        # En contenedores, DUCKDB_MEMORY_LIMIT (p. ej. "1GB") deja margen a Python bajo el límite de la plataforma.
        limit = os.environ.get("DUCKDB_MEMORY_LIMIT")
        self._con = duckdb.connect(config={"memory_limit": limit} if limit else {})
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
                   select sensor_set, lat, lon, department, acq_date, h3_res6, n_hotspots, sum_frp,
                          cast(substr(acq_date, 1, 4) as integer) as year,
                          cast(substr(acq_date, 6, 2) as integer) as month
                   from read_parquet(?) where sensor_set in ('all', 'modis')""",
                [str(events_parquet)],
            )
        self._limits = self._load_limits(limits_json)
        # Cada celda, a un solo departamento: el de la celda en la serie, o el oficial del INEI si está cargado.
        self._con.execute("create table cell_dept as select h3_res6, any_value(department) as department from activity group by 1")
        first, last = self._con.execute("select min(acq_date), max(acq_date) from activity").fetchone()
        self._first_date, self._last_date = str(first), str(last)
        names = [r[0] for r in self._con.execute("select distinct department from activity").fetchall()]
        self._departments = sorted(names, key=lambda n: unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode())
        self._summary_json = summary_json
        # Los focos individuales no se cargan en memoria: se leen del parquet solo al exportar.
        self._hotspots_parquet = hotspots_parquet if hotspots_parquet and hotspots_parquet.exists() else None
        self._series_cache: OrderedDict[AreaOfInterest, HarmonizedSeries] = OrderedDict()
        self._daily_cache: OrderedDict[AreaOfInterest, DailyActivity] = OrderedDict()
        self._boundaries: dict[str, tuple[tuple[float, float], ...]] = {}

    # --- filtros de área -------------------------------------------------

    def _load_limits(self, limits_json: Path | None) -> dict | None:
        """Límites oficiales del INEI (src/etl/peru_limits.py): reasignan el departamento de cada celda por su centro."""
        if not limits_json or not limits_json.exists():
            return None
        limits = json.loads(limits_json.read_text())
        names = {d["code"]: d["name"] for d in limits["departments"]}
        rows = [(kind, key, cell) for kind, groups in limits["cells"].items() for key, cells in groups.items() for cell in cells]
        self._con.execute("create table area_cells (kind varchar, key varchar, h3_res6 varchar)")
        self._con.execute(
            "insert into area_cells select unnest(?::varchar[]), unnest(?::varchar[]), unnest(?::varchar[])",
            [[r[0] for r in rows], [r[1] for r in rows], [r[2] for r in rows]],
        )
        dept = [(cell, names[code]) for code, cells in limits["cells"]["department"].items() for cell in cells]
        self._con.execute(
            "create table official_dept as select unnest(?::varchar[]) as h3_res6, unnest(?::varchar[]) as department",
            [[c for c, _ in dept], [n for _, n in dept]],
        )
        # Las celdas fuera de todo límite oficial (costa, frontera) conservan el departamento aproximado.
        for table in ("activity", "events") if self._has_events else ("activity",):
            self._con.execute(
                f"update {table} set department = o.department from official_dept o where {table}.h3_res6 = o.h3_res6"
            )
        return {
            "source": limits["source"], "retrieved": limits["retrieved"], "rule": limits["rule"],
            "departments": limits["departments"], "districts": {d["ubigeo"]: d for d in limits["districts"]},
            "codes": {d["name"]: d["code"] for d in limits["departments"]},
        }

    @staticmethod
    @lru_cache(maxsize=64)
    def _polygon_cells(ring: tuple[tuple[float, float], ...]) -> tuple[str, ...]:
        """Celdas H3 res 6 cuyo centro cae dentro del polígono; si es más chico que una celda, la que lo contiene."""
        cells = h3.polygon_to_cells(h3.LatLngPoly([(lat, lon) for lon, lat in ring]), 6)
        if not cells:
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
            cells = [h3.latlng_to_cell(lat, lon, 6)]
        return tuple(sorted(cells))

    def _area_sql(
        self, area: AreaOfInterest, lon: str = "lon_center", lat: str = "lat_center", cell: str | None = None
    ) -> tuple[str, list]:
        """Filtro SQL del área. `cell` es la columna de celda cuando la tabla no trae el departamento oficial."""
        column = cell or "h3_res6"
        if area.kind == "department":
            if area.department not in self._departments:
                raise DomainError(f"Departamento desconocido: {area.department}")
            if cell:
                return f"{cell} in (select h3_res6 from cell_dept where department = ?)", [area.department]
            return "department = ?", [area.department]
        if area.kind == "district":
            if not self._limits or area.district not in self._limits["districts"]:
                raise DomainError(f"Distrito desconocido: {area.district}")
            return f"{column} in (select h3_res6 from area_cells where kind = 'district' and key = ?)", [area.district]
        if area.kind == "polygon" and area.polygon:
            return f"{column} in (select unnest(?::varchar[]))", [list(self._polygon_cells(area.polygon))]
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

    def daily_activity(self, area: AreaOfInterest) -> DailyActivity:
        if area in self._daily_cache:
            self._daily_cache.move_to_end(area)
            return self._daily_cache[area]
        first = date.fromisoformat(self._first_date)
        n = (date.fromisoformat(self._last_date) - first).days + 1
        harmonized, hotspots = [0.0] * n, [0] * n
        where, params = self._area_sql(area)
        for day, h, raw in self._query(
            f"""select acq_date, sum(harmonized_fire_activity) filter (where is_primary_series), sum(raw_hotspots_count)
                from activity where {where} group by 1""",
            params,
        ):
            i = (date.fromisoformat(day) - first).days
            harmonized[i], hotspots[i] = round(float(h or 0.0), 3), int(raw or 0)
        events: list[int] | None = None
        if self._has_events:
            events = [0] * n
            ewhere, eparams = self._area_sql(area, lon="lon", lat="lat")
            for day, count in self._query(
                f"select acq_date, count(*) from events where sensor_set = 'all' and {ewhere} group by 1", eparams
            ):
                events[(date.fromisoformat(day) - first).days] = int(count)
        daily = DailyActivity(self._first_date, tuple(harmonized), tuple(hotspots), None if events is None else tuple(events))
        self._daily_cache[area] = daily
        if len(self._daily_cache) > _SERIES_CACHE_SIZE:
            self._daily_cache.popitem(last=False)
        return daily

    def active_cells(self, area: AreaOfInterest, days: DayRange) -> list[ActiveCell]:
        where, params = self._area_sql(area)
        rows = self._query(
            f"""select h3_res6, any_value(department),
                       coalesce(sum(harmonized_fire_activity) filter (where is_primary_series), 0),
                       sum(raw_hotspots_count), count(distinct acq_date)
                from activity where {where} and acq_date between ? and ? group by 1""",
            [*params, days.start.isoformat(), days.end.isoformat()],
        )
        return [ActiveCell(c, self._boundary(c), d, float(h), int(raw), int(days)) for c, d, h, raw, days in rows]

    def _boundary(self, cell: str) -> tuple[tuple[float, float], ...]:
        if cell not in self._boundaries:
            self._boundaries[cell] = tuple((round(lng, 5), round(lat, 5)) for lat, lng in h3.cell_to_boundary(cell))
        return self._boundaries[cell]

    def department_totals(self, days: DayRange) -> list[DepartmentTotal]:
        span = [days.start.isoformat(), days.end.isoformat()]
        events = {}
        if self._has_events:
            events = dict(
                self._query(
                    "select department, count(*) from events where sensor_set = 'all' and acq_date between ? and ? group by 1",
                    span,
                )
            )
        rows = self._query(
            """select department, coalesce(sum(harmonized_fire_activity) filter (where is_primary_series), 0),
                      sum(raw_hotspots_count), count(distinct h3_res6)
               from activity where acq_date between ? and ? group by 1""",
            span,
        )
        return [
            DepartmentTotal(d, float(h), int(raw), int(events.get(d, 0)) if self._has_events else None, int(cells))
            for d, h, raw, cells in rows
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

    def export_hotspot_rows(self, area: AreaOfInterest, days: DayRange) -> Iterator[tuple]:
        if self._hotspots_parquet is None:
            raise DomainError("Los focos individuales no están disponibles en este despliegue")
        where, params = self._area_sql(area, lon="longitude", lat="latitude", cell="cell_id")
        cursor = self._con.cursor().execute(
            _HOTSPOTS_SQL.format(area=where),
            [str(self._hotspots_parquet), *params, days.start.isoformat(), days.end.isoformat()],
        )
        while batch := cursor.fetchmany(5000):
            yield from batch

    def hotspot_points(self, area: AreaOfInterest, days: DayRange, limit: int) -> HotspotSample:
        if self._hotspots_parquet is None:
            raise DomainError("Los focos individuales no están disponibles en este despliegue")
        where, params = self._area_sql(area, lon="longitude", lat="latitude", cell="cell_id")
        rows = self._query(
            _POINTS_SQL.format(area=where),
            [str(self._hotspots_parquet), *params, days.start.isoformat(), days.end.isoformat(), limit],
        )
        return HotspotSample(
            total=int(rows[0][-1]) if rows else 0,
            points=[HotspotPoint(*row[:-1]) for row in rows],
            summary=self._hotspot_summary(where, params, days),
            events=self._event_summary(area, days),
        )

    def _event_summary(self, area: AreaOfInterest, days: DayRange) -> EventSummary | None:
        """Recuento por día de los focos agrupados (buffer y disolución diaria) del área y el rango."""
        if not self._has_events:
            return None
        where, params = self._area_sql(area, lon="lon", lat="lat")
        source = [*params, days.start.isoformat(), days.end.isoformat()]
        base = f"from events where sensor_set = 'all' and {where} and acq_date between ? and ?"
        total, hotspots, active, one, few, some, many = self._query(
            f"""select count(*), coalesce(sum(n_hotspots), 0), count(distinct acq_date),
                       count(*) filter (where n_hotspots = 1), count(*) filter (where n_hotspots between 2 and 5),
                       count(*) filter (where n_hotspots between 6 and 20), count(*) filter (where n_hotspots > 20)
                {base}""",
            source,
        )[0]
        busiest = self._query(f"select acq_date, count(*) {base} group by 1 order by 2 desc, 1 desc limit 1", source)
        largest = self._query(
            f"select acq_date, n_hotspots, sum_frp, lat, lon {base} order by n_hotspots desc, sum_frp desc limit 1", source
        )
        top = largest[0] if largest else (None, 0, None, None, None)
        return EventSummary(
            total=int(total), hotspots=int(hotspots), active_days=int(active),
            busiest_day=str(busiest[0][0]) if busiest else None, busiest_count=int(busiest[0][1]) if busiest else 0,
            sizes={"1": int(one), "2-5": int(few), "6-20": int(some), "21+": int(many)},
            largest_hotspots=int(top[1] or 0), largest_day=None if top[0] is None else str(top[0]),
            largest_frp=None if top[2] is None else round(float(top[2]), 1),
            largest_lat=None if top[3] is None else round(float(top[3]), 4),
            largest_lon=None if top[4] is None else round(float(top[4]), 4),
        )

    def _hotspot_summary(self, where: str, params: list, days: DayRange) -> HotspotSummary:
        source = [str(self._hotspots_parquet), *params, days.start.isoformat(), days.end.isoformat()]
        base = f"from read_parquet(?) where {where} and acq_date between ? and ?"
        groups = self._query(f"select instrument, satellite, daynight, confidence, count(*) {base} group by all", source)
        total, active_days, cells, median, top = self._query(
            f"select count(*), count(distinct acq_date), count(distinct cell_id), median(frp), max(frp) {base}", source
        )[0]
        busiest = self._query(f"select acq_date, count(*) {base} group by 1 order by 2 desc, 1 desc limit 1", source)

        def tally(index: int) -> dict[str, int]:
            out: dict[str, int] = {}
            for row in groups:
                out[str(row[index])] = out.get(str(row[index]), 0) + int(row[4])
            return dict(sorted(out.items(), key=lambda kv: -kv[1]))

        return HotspotSummary(
            total=int(total), active_days=int(active_days), hexagons=int(cells), by_sensor=tally(0), by_satellite=tally(1),
            by_daynight=tally(2), by_confidence=tally(3),
            frp_median=None if median is None else round(float(median), 1), frp_max=None if top is None else round(float(top), 1),
            busiest_day=str(busiest[0][0]) if busiest else None, busiest_count=int(busiest[0][1]) if busiest else 0,
        )

    def export_rows(self, area: AreaOfInterest, days: DayRange) -> Iterator[tuple]:
        where, params = self._area_sql(area)
        cursor = self._con.cursor().execute(
            _EXPORT_SQL.format(area=where), [*params, days.start.isoformat(), days.end.isoformat()]
        )
        while batch := cursor.fetchmany(5000):
            yield from batch

    # --- límites oficiales -------------------------------------------------------

    def limits(self) -> dict | None:
        """Departamentos y distritos oficiales para elegir el área (sin geometría)."""
        if not self._limits:
            return None
        names = {d["code"]: d["name"] for d in self._limits["departments"]}
        return {
            "source": self._limits["source"], "retrieved": self._limits["retrieved"], "rule": self._limits["rule"],
            "departments": [{"code": d["code"], "name": d["name"]} for d in self._limits["departments"]],
            "districts": [
                {"ubigeo": d["ubigeo"], "name": d["name"], "province": d["province"], "department": names.get(d["department"], "")}
                for d in self._limits["districts"].values()
            ],
        }

    def boundary(self, area: AreaOfInterest) -> dict | None:
        """Contorno oficial (simplificado) del departamento o distrito, como geometría GeoJSON."""
        if not self._limits:
            return None
        if area.kind == "department":
            code = self._limits["codes"].get(area.department or "")
            return next((d["geometry"] for d in self._limits["departments"] if d["code"] == code), None)
        if area.kind == "district":
            district = self._limits["districts"].get(area.district or "")
            return district["geometry"] if district else None
        return None
