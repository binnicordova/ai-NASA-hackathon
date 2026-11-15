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

from fire_calendar.calendar.application.use_cases import (
    GetActiveCells,
    GetAnomaly,
    GetBurnCalendar,
    GetDepartmentRanking,
)
from fire_calendar.calendar.infrastructure.duckdb_gateway import DuckDbHarmonizedSeriesGateway
from fire_calendar.hotspots.application.export_csv import ExportActivityCsv, ExportHotspotsCsv, stream_csv
from fire_calendar.shared.kernel import AreaOfInterest, BoundingBox, DateRange, DomainError, YearMonth

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
    "Departments are assigned with approximate outlines.",
    "This service describes past and current activity. It does not predict fires.",
]


def create_app(gateway: DuckDbHarmonizedSeriesGateway | None = None) -> FastAPI:
    gateway = gateway or DuckDbHarmonizedSeriesGateway(
        DATA_DIR / "harmonized_fires.parquet",
        events_parquet=DATA_DIR / "fire_events.parquet",
        summary_json=DATA_DIR / "calendar_summary.json",
        hotspots_parquet=DATA_DIR / "hotspots_clean.parquet",
    )
    get_calendar = GetBurnCalendar(gateway)
    get_anomaly = GetAnomaly(gateway)
    get_cells = GetActiveCells(gateway)
    get_ranking = GetDepartmentRanking(gateway)
    export_csv = ExportActivityCsv(gateway)
    export_hotspots = ExportHotspotsCsv(gateway)

    app = FastAPI(title="Fire calendar · functions", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=2000)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    def area_from(department: str | None, bbox: str | None) -> AreaOfInterest:
        if department and bbox:
            raise DomainError("Usa departamento o caja, no ambos")
        if bbox:
            return AreaOfInterest.of_bbox(BoundingBox.parse(bbox))
        if department:
            return AreaOfInterest.of_department(department)
        return AreaOfInterest.country()

    def period_from(text: str | None) -> YearMonth | None:
        return YearMonth.parse(text) if text else None

    department_q = Query(None, description="Nombre del departamento")
    bbox_q = Query(None, description="Caja oeste,sur,este,norte en grados decimales")
    from_q = Query(None, alias="from", description="Mes inicial AAAA-MM")
    to_q = Query(None, alias="to", description="Mes final AAAA-MM")

    @app.get("/api/v1/meta")
    def meta() -> dict:
        first, last = gateway.date_span()
        return {
            "firstDate": first, "lastDate": last, "departments": gateway.departments(),
            "source": "NASA FIRMS: MODIS Collection 6.1 and VIIRS Collection 2 (S-NPP, NOAA-20, NOAA-21)",
            "validation": gateway.validation(), "caveats": CAVEATS,
            "hasHotspotPoints": export_hotspots.available,
        }

    @app.get("/api/v1/calendar")
    def calendar(department: str | None = department_q, bbox: str | None = bbox_q,
                 start: str | None = from_q, end: str | None = to_q) -> dict:
        return presenters.calendar_json(get_calendar(area_from(department, bbox), period_from(start), period_from(end)))

    @app.get("/api/v1/anomaly")
    def anomaly(department: str | None = department_q, bbox: str | None = bbox_q,
                month: str | None = Query(None, description="Mes AAAA-MM; por defecto el mes en curso")) -> dict:
        return presenters.anomaly_json(get_anomaly(area_from(department, bbox), period_from(month)))

    @app.get("/api/v1/cells")
    def cells(month: str = Query(..., description="Mes AAAA-MM"),
              department: str | None = department_q, bbox: str | None = bbox_q) -> dict:
        return presenters.cells_geojson(get_cells(area_from(department, bbox), YearMonth.parse(month)))

    @app.get("/api/v1/ranking")
    def ranking(start: str | None = from_q, end: str | None = to_q) -> list[dict]:
        first, last = gateway.date_span()
        date_range = DateRange(period_from(start) or YearMonth.parse(first), period_from(end) or YearMonth.parse(last))
        return presenters.ranking_json(get_ranking(date_range))

    def csv_response(chunks, name: str) -> StreamingResponse:
        return StreamingResponse(chunks, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})

    def export_range(start: str | None, end: str | None) -> DateRange:
        first, last = gateway.date_span()
        return DateRange(period_from(start) or YearMonth.parse(first), period_from(end) or YearMonth.parse(last))

    @app.get("/api/v1/hotspots.csv")
    def hotspots_csv(department: str | None = department_q, bbox: str | None = bbox_q,
                     start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        area, date_range = area_from(department, bbox), export_range(start, end)
        return csv_response(export_hotspots(area, date_range), f"hotspots_{area.kind}_{date_range.start}_{date_range.end}.csv")

    @app.get("/api/v1/calendar.csv")
    def calendar_csv(department: str | None = department_q, bbox: str | None = bbox_q,
                     start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        area = area_from(department, bbox)
        result = get_calendar(area, period_from(start), period_from(end))
        name = f"burn-calendar_{area.kind}_{result.date_range.start}_{result.date_range.end}.csv"
        return csv_response(stream_csv(presenters.SERIES_COLUMNS, presenters.series_rows(result)), name)

    @app.get("/api/v1/export.csv")
    def export(department: str | None = department_q, bbox: str | None = bbox_q,
               start: str | None = from_q, end: str | None = to_q) -> StreamingResponse:
        first, last = gateway.date_span()
        area = area_from(department, bbox)
        date_range = DateRange(period_from(start) or YearMonth.parse(first), period_from(end) or YearMonth.parse(last))
        name = f"fire-activity_{area.kind}_{date_range.start}_{date_range.end}.csv"
        return StreamingResponse(
            export_csv(area, date_range), media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    if WEB_DIST.exists():  # un solo despliegue: la API sirve también la web compilada
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
    return app

