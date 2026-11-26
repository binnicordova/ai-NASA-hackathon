"""La cola de datos nuevos: base hasta el corte + cola desde el corte, y el cambio en caliente.

Se arma una cola a partir de la propia serie real (todo lo posterior a un corte). Con la cola igual a lo que la
base tiene después del corte, el resultado tiene que ser idéntico al de usar solo la base.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from fire_calendar.calendar.infrastructure.duckdb_gateway import DuckDbHarmonizedSeriesGateway
from fire_calendar.calendar.infrastructure.tail_source import ReloadingGateway, TailSnapshot, TailSource
from fire_calendar.interfaces.http import app as http_app
from fire_calendar.shared.kernel import AreaOfInterest, DayRange

DATA = http_app.DATA_DIR
CUTOFF = "2025-09-01"
TABLES = {"harmonized_fires": "acq_date", "fire_events": "acq_date", "hotspots_clean": "acq_date"}
pytestmark = pytest.mark.skipif(not (DATA / "harmonized_fires.parquet").exists(), reason="falta data/processed")


def write_tail(folder: Path, version: str, *, cutoff: str = CUTOFF, drop_day: str | None = None, last_day: str | None = None) -> None:
    """Publica en `folder` una versión de la cola con lo que la base tiene desde el corte."""
    target = folder / f"v={version}"
    target.mkdir(parents=True)
    con = duckdb.connect()
    for table in TABLES:
        where = f"acq_date >= '{cutoff}'"
        if drop_day:
            where += f" and acq_date <> '{drop_day}'"
        if last_day:
            where += f" and acq_date <= '{last_day}'"
        con.execute(
            f"copy (select * from read_parquet('{DATA / (table + '.parquet')}') where {where}) to '{target / (table + '.parquet')}' (format parquet)"
        )
    last = con.execute(f"select max(acq_date) from read_parquet('{target / 'harmonized_fires.parquet'}')").fetchone()[0]
    manifest = {"version": version, "generatedAt": "2026-11-26T10:00:00Z", "cutoff": cutoff, "lastDate": last,
                "lastObservation": {"N20": f"{last}T18:00Z"}, "warnings": []}
    (target / "manifest.json").write_text(json.dumps(manifest))
    (folder / "latest.json").write_text(json.dumps(manifest))


def one_day(day: str) -> DayRange:
    return DayRange(date.fromisoformat(day), date.fromisoformat(day))


def gateway(tail: TailSnapshot | None = None) -> DuckDbHarmonizedSeriesGateway:
    return DuckDbHarmonizedSeriesGateway(
        DATA / "harmonized_fires.parquet", events_parquet=DATA / "fire_events.parquet",
        summary_json=DATA / "calendar_summary.json", hotspots_parquet=DATA / "hotspots_clean.parquet",
        limits_json=DATA / "peru_limits.json", tail=tail,
    )


@pytest.fixture(scope="module")
def tail_store(tmp_path_factory) -> Path:
    folder = tmp_path_factory.mktemp("tail")
    write_tail(folder, "20261126T100000Z")
    return folder


@pytest.fixture(scope="module")
def merged(tail_store, tmp_path_factory) -> TestClient:
    snapshot = TailSource(str(tail_store), tmp_path_factory.mktemp("cache")).snapshot()
    return TestClient(http_app.create_app(gateway(snapshot)))


@pytest.fixture(scope="module")
def base_only() -> TestClient:
    return TestClient(http_app.create_app(gateway()))


@pytest.mark.parametrize("path,params", [
    ("/api/v1/calendar", {"department": "Cusco", "from": "2024-01", "to": "2026-11"}),
    ("/api/v1/ranking", {"from": "2025-08-15", "to": "2026-03-10"}),
    ("/api/v1/daily", {"department": "Cusco"}),
    ("/api/v1/cells", {"month": "2025-10", "department": "Cusco"}),
])
def test_tail_equal_to_base_gives_identical_answers(merged, base_only, path, params):
    assert merged.get(path, params=params).json() == base_only.get(path, params=params).json()


def test_points_and_csv_are_the_same_set_across_the_cutoff(merged, base_only):
    """Mismos focos antes y después del corte; el orden entre focos de un mismo instante no está definido."""
    params = {"department": "Cusco", "from": "2025-08-25", "to": "2025-09-10"}
    one, two = merged.get("/api/v1/hotspots.csv", params=params).text, base_only.get("/api/v1/hotspots.csv", params=params).text
    assert sorted(one.splitlines()) == sorted(two.splitlines()) and one.count("\n") > 10
    points = lambda c: c.get("/api/v1/points", params={**params, "limit": 5000}).json()
    a, b = points(merged), points(base_only)
    assert a["total"] == b["total"] and a["summary"] == b["summary"] and a["events"] == b["events"]
    assert sorted(map(tuple, a["points"])) == sorted(map(tuple, b["points"]))


def test_days_come_from_the_tail_after_the_cutoff_not_from_the_base(tail_store, tmp_path):
    """Un día ausente de la cola no se rellena con la base: la cola manda desde el corte."""
    write_tail(tmp_path, "v1", drop_day="2025-10-15")
    gap = gateway(TailSource(str(tmp_path), tmp_path / "cache").snapshot())
    full = gateway(TailSource(str(tail_store), tmp_path / "cache2").snapshot())
    day, country = one_day("2025-10-15"), AreaOfInterest.country()
    assert sum(c.harmonized for c in full.active_cells(country, day)) > 0
    assert sum(c.harmonized for c in gap.active_cells(country, day)) == 0


def test_meta_reports_the_tail_and_the_last_day(merged, base_only):
    meta = merged.get("/api/v1/meta").json()
    assert meta["dataUpdatedAt"] == "2026-11-26T10:00:00Z" and meta["tail"]["cutoff"] == CUTOFF
    assert meta["lastDate"] == base_only.get("/api/v1/meta").json()["lastDate"]
    plain = base_only.get("/api/v1/meta").json()
    assert plain["dataUpdatedAt"] is None and plain["tail"] is None


def test_reloading_gateway_swaps_when_a_newer_version_is_published(tmp_path):
    store, cache = tmp_path / "store", tmp_path / "cache"
    store.mkdir()
    write_tail(store, "20261126T100000Z", last_day="2026-03-31")
    live = ReloadingGateway(lambda tail: gateway(tail), TailSource(str(store), cache), interval=0, log=lambda m: None)
    assert live.date_span()[1] == "2026-03-31" and live.version == "20261126T100000Z"
    assert live.refresh() is False  # nada nuevo
    write_tail(store, "20261126T103000Z")  # el job publicó una versión con más días
    assert live.refresh() is True
    assert live.version == "20261126T103000Z" and live.date_span()[1] > "2026-03-31"
    assert live.tail_info()["version"] == "20261126T103000Z"


def test_reloading_gateway_serves_the_base_when_the_tail_is_missing(tmp_path):
    live = ReloadingGateway(lambda tail: gateway(tail), TailSource(str(tmp_path / "vacio"), tmp_path / "cache"),
                            interval=0, log=lambda m: None)
    assert live.version is None and live.tail_info() is None and live.date_span()[1] >= "2026-11-14"


def test_only_one_request_per_interval_is_asked_to_refresh(tmp_path):
    live = ReloadingGateway(lambda tail: gateway(tail), TailSource(str(tmp_path / "vacio"), tmp_path / "cache"),
                            interval=3600, log=lambda m: None)
    assert live.refresh_due() is False  # recién armado: ya miró
    live._checked -= 3601
    assert live.refresh_due() is True and live.refresh_due() is False  # una sola petición se lleva el turno
    live.refresh()  # al terminar libera el turno
    live._checked -= 3601
    assert live.refresh_due() is True


def test_the_app_refreshes_inside_the_request_that_finds_it_due(tmp_path):
    store, cache = tmp_path / "store", tmp_path / "cache"
    store.mkdir()
    live = ReloadingGateway(lambda tail: gateway(tail), TailSource(str(store), cache), interval=3600, log=lambda m: None)
    client = TestClient(http_app.create_app(live))
    assert client.get("/api/v1/meta").json()["tail"] is None
    write_tail(store, "20261126T100000Z", last_day="2026-03-31")
    assert client.get("/api/v1/meta").json()["tail"] is None  # aún no toca mirar
    live._checked -= 3601
    meta = client.get("/api/v1/meta").json()  # esta petición mira, cambia de gateway y ya responde con la cola
    assert meta["tail"]["version"] == "20261126T100000Z" and meta["lastDate"] == "2026-03-31"
