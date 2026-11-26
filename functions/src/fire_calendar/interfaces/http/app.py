"""Interfaz HTTP de functions/. Solo traduce entrada y salida; las reglas viven en el dominio.

Ejecutar:  uv run uvicorn --factory fire_calendar.interfaces.http.app:create_app --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from fire_calendar.calendar.application.use_cases import (
    GetActiveCells,
    GetAnomaly,
    GetBurnCalendar,
    GetDailyActivity,
    GetDepartmentRanking,
    GetFireForecast,
    GetHotspotPoints,
)
from fire_calendar.calendar.infrastructure.duckdb_gateway import DuckDbHarmonizedSeriesGateway
from fire_calendar.calendar.infrastructure.tail_source import ReloadingGateway, TailSnapshot, TailSource
from fire_calendar.hotspots.application.export_csv import ExportActivityCsv, ExportHotspotsCsv, stream_csv
from datetime import date

from fire_calendar.shared.kernel import AreaOfInterest, BoundingBox, DayRange, DomainError, YearMonth, parse_polygon

from . import presenters

REPO_ROOT = Path(__file__).resolve().parents[5]
DATA_DIR = Path(os.environ.get("FIRE_DATA_DIR", REPO_ROOT / "data" / "processed"))
WEB_DIST = Path(os.environ.get("FIRE_WEB_DIST", REPO_ROOT / "web" / "dist"))

CAVEATS = [
    "A hot spot is a thermal detection, not a confirmed wildfire.",
    "No observation (cloud, smoke) is not the same as no fire.",
    "A fire event is a group of hot spots whose buffers touch on the same day; a multi-day fire counts once per day.",
    "Raw hot spots and fire events are not comparable across years because the number of sensors changes.",
    "Activity before mid-2002 is extrapolated from Terra only and has low confidence.",
    "Departments and districts follow official INEI boundaries, assigned by H3 cell (~36 km²).",
    "The most recent months are near-real-time data: NASA replaces them with standard-quality data about three months later, so they can change slightly.",
    "The fire prediction is seasonal: a Poisson model (Poisson-Gamma when years vary more) of MODIS fire events in the same month of past years. It uses no weather and is checked out of sample (2021 onwards).",
]


def default_gateway() -> DuckDbHarmonizedSeriesGateway | ReloadingGateway:
    """La base de data/processed; con FIRE_TAIL_URI, además la cola de datos nuevos, que se recarga sola."""

    def build(tail: TailSnapshot | None) -> DuckDbHarmonizedSeriesGateway:
        return DuckDbHarmonizedSeriesGateway(
            DATA_DIR / "harmonized_fires.parquet",
            events_parquet=DATA_DIR / "fire_events.parquet",
            summary_json=DATA_DIR / "calendar_summary.json",
            hotspots_parquet=DATA_DIR / "hotspots_clean.parquet",
            limits_json=DATA_DIR / "peru_limits.json",
            tail=tail,
        )

    uri = os.environ.get("FIRE_TAIL_URI")
    if not uri:
        return build(None)
    source = TailSource(uri, Path(os.environ.get("FIRE_TAIL_CACHE", "/tmp/fire-tail")))
    return ReloadingGateway(build, source, interval=float(os.environ.get("FIRE_TAIL_POLL_SECONDS", "120")))


def create_app(gateway: DuckDbHarmonizedSeriesGateway | ReloadingGateway | None = None) -> FastAPI:
    gateway = gateway or default_gateway()
    get_calendar = GetBurnCalendar(gateway)
    get_anomaly = GetAnomaly(gateway)
    get_cells = GetActiveCells(gateway)
    get_ranking = GetDepartmentRanking(gateway)
    get_daily = GetDailyActivity(gateway)
    get_points = GetHotspotPoints(gateway)
    get_forecast = GetFireForecast(gateway)
    export_csv = ExportActivityCsv(gateway)
    export_hotspots = ExportHotspotsCsv(gateway)

    app = FastAPI(title="Fire calendar · functions", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=2000)

    @app.middleware("http")
    async def refresh_tail(request: Request, call_next):
        due = getattr(gateway, "refresh_due", None)  # solo el gateway con cola lo tiene
        if due and due():
            await run_in_threadpool(gateway.refresh)  # en esta petición: entre peticiones Cloud Run casi no da CPU
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    def area_from(department: str | None, bbox: str | None, district: str | None = None, polygon: str | None = None,
                  province: str | None = None) -> AreaOfInterest:
        if sum(bool(x) for x in (department, bbox, district, polygon, province)) > 1:
            raise DomainError("Usa un solo tipo de área: departamento, provincia, distrito, caja o polígono")
        if province:
            return AreaOfInterest.of_province(province)
        if bbox:
            return AreaOfInterest.of_bbox(BoundingBox.parse(bbox))
        if department:
            return AreaOfInterest.of_department(department)
        if district:
            return AreaOfInterest.of_district(district)
        if polygon:
            return AreaOfInterest.of_polygon(parse_polygon(polygon))
        return AreaOfInterest.country()

    def period_from(text: str | None) -> YearMonth | None:
        return YearMonth.parse(text) if text else None

    department_q = Query(None, description="Nombre del departamento")
    bbox_q = Query(None, description="Caja oeste,sur,este,norte en grados decimales")
    district_q = Query(None, description="Ubigeo del distrito (6 dígitos, límites oficiales del INEI)")
    province_q = Query(None, description="Código de provincia (4 dígitos: los primeros del ubigeo, límites oficiales del INEI)")
    polygon_q = Query(None, description="Polígono lon,lat;lon,lat;... (se ajusta a las celdas H3 cuyo centro cae dentro)")
    from_q = Query(None, alias="from", description="Inicio AAAA-MM-DD (o AAAA-MM: primer día del mes)")
    to_q = Query(None, alias="to", description="Fin AAAA-MM-DD (o AAAA-MM: último día del mes)")

    def days_from(start: str | None, end: str | None) -> DayRange:
        first, last = gateway.date_span()
        return DayRange.parse(start, end, date.fromisoformat(first), date.fromisoformat(last))

    @app.get("/api/v1/meta")
    def meta() -> dict:
        first, last = gateway.date_span()
        tail = gateway.tail_info()
        return {
            "firstDate": first, "lastDate": last, "departments": gateway.departments(),
            "dataUpdatedAt": tail["generatedAt"] if tail else None, "tail": tail,
            "source": "NASA FIRMS: MODIS Collection 6.1 and VIIRS Collection 2 (S-NPP, NOAA-20, NOAA-21)",
            "validation": gateway.validation(), "caveats": CAVEATS,
            "hasHotspotPoints": export_hotspots.available,
        }

    @app.get("/api/v1/calendar")
    def calendar(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
                 start: str | None = from_q, end: str | None = to_q) -> dict:
        return presenters.calendar_json(get_calendar(area_from(department, bbox, district, polygon, province), period_from(start), period_from(end)))

    @app.get("/api/v1/anomaly")
    def anomaly(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
                month: str | None = Query(None, description="Mes AAAA-MM; por defecto el mes en curso")) -> dict:
        return presenters.anomaly_json(get_anomaly(area_from(department, bbox, district, polygon, province), period_from(month)))

    @app.get("/api/v1/limits")
    def limits() -> dict:
        """Departamentos y distritos oficiales (INEI) para elegir el área."""
        data = gateway.limits()
        if data is None:
            raise DomainError("Los límites oficiales no están disponibles en este despliegue")
        return data

    @app.get("/api/v1/boundary")
    def boundary(department: str | None = department_q, district: str | None = district_q,
                 province: str | None = province_q) -> dict:
        """Contorno oficial simplificado del departamento, la provincia o el distrito, como Feature GeoJSON."""
        area = area_from(department, None, district, None, province)
        geometry = gateway.boundary(area)
        if geometry is None:
            raise DomainError("No hay contorno oficial para esa área")
        return {"type": "Feature", "geometry": geometry, "properties": {"label": area.label}}

    level_q = Query("department", description="department, province o district")

    @app.get("/api/v1/forecast")
    def forecast(level: str = level_q) -> JSONResponse:
        """Predicción de fuego por mes de cada límite oficial (Poisson sobre eventos MODIS), con su prueba fuera de muestra."""
        body = presenters.forecast_map_json(get_forecast.by_unit(level))
        return JSONResponse(body, headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/v1/forecast/area")
    def area_forecast(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q) -> dict:
        area = area_from(department, bbox, district, polygon, province)
        years, months = get_forecast.for_area(area)
        return presenters.area_forecast_json(area, years, months)

    @app.get("/api/v1/shapes")
    def shapes(level: str = level_q) -> JSONResponse:
        """Contornos oficiales simplificados (INEI) de todos los límites de un nivel."""
        if level not in ("department", "province", "district"):
            raise DomainError("Nivel desconocido: usa department, province o district")
        data = gateway.shapes(level)
        if data is None:
            raise DomainError("Los límites oficiales no están disponibles en este despliegue")
        return JSONResponse(data, headers={"Cache-Control": "public, max-age=86400"})

    @app.get("/api/v1/daily")
    def daily(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q) -> dict:
        return presenters.daily_json(get_daily(area_from(department, bbox, district, polygon, province)))

    @app.get("/api/v1/cells")
    def cells(month: str | None = Query(None, description="Mes AAAA-MM (atajo de from/to)"),
              department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
              start: str | None = from_q, end: str | None = to_q) -> dict:
        days = days_from(month, month) if month else days_from(start, end)
        return presenters.cells_geojson(get_cells(area_from(department, bbox, district, polygon, province), days))

    @app.get("/api/v1/points")
    def points(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
               start: str | None = from_q, end: str | None = to_q,
               limit: int = Query(20_000, description="Máximo de focos devueltos, los más recientes primero")) -> dict:
        return presenters.points_json(get_points(area_from(department, bbox, district, polygon, province), days_from(start, end), limit))

    @app.get("/api/v1/ranking")
    def ranking(start: str | None = from_q, end: str | None = to_q) -> list[dict]:
        return presenters.ranking_json(get_ranking(days_from(start, end)))

    def csv_response(chunks, name: str) -> StreamingResponse:
        return StreamingResponse(chunks, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    @app.get("/api/v1/hotspots.csv")
    def hotspots_csv(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
                     start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        area, days = area_from(department, bbox, district, polygon, province), days_from(start, end)
        return csv_response(export_hotspots(area, days), f"hotspots_{area.kind}_{days}.csv")

    @app.get("/api/v1/calendar.csv")
    def calendar_csv(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
                     start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        area = area_from(department, bbox, district, polygon, province)
        result = get_calendar(area, period_from(start), period_from(end))
        name = f"burn-calendar_{area.kind}_{result.date_range.start}_{result.date_range.end}.csv"
        return csv_response(stream_csv(presenters.SERIES_COLUMNS, presenters.series_rows(result)), name)

    @app.get("/api/v1/export.csv")
    def export(department: str | None = department_q, bbox: str | None = bbox_q,
              district: str | None = district_q, polygon: str | None = polygon_q, province: str | None = province_q,
               start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        area, days = area_from(department, bbox, district, polygon, province), days_from(start, end)
        return csv_response(export_csv(area, days), f"fire-activity_{area.kind}_{days}.csv")

    if WEB_DIST.exists():  # un solo despliegue: la API sirve también la web compilada
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
    return app

