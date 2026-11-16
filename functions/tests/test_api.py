"""Pruebas de extremo a extremo contra la serie armonizada real (se omiten si no está el parquet)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fire_calendar.interfaces.http import app as http_app

PARQUET = http_app.DATA_DIR / "harmonized_fires.parquet"
pytestmark = pytest.mark.skipif(not PARQUET.exists(), reason="falta data/processed/harmonized_fires.parquet")


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(http_app.create_app())


def test_meta_lists_departments_and_span(client):
    meta = client.get("/api/v1/meta").json()
    # 25 departamentos oficiales del INEI (con Callao)
    assert meta["firstDate"] == "2000-11-01" and len(meta["departments"]) == 25
    assert "Cusco" in meta["departments"]


def test_national_calendar_matches_the_pipeline_summary(client):
    cal = client.get("/api/v1/calendar").json()
    assert len(cal["series"]) == cal["range"]["months"]
    years = {y["year"]: y for y in cal["years"]}
    # Cifras de calendar_summary.json: el salto falso de 2012 desaparece en la serie armonizada.
    assert round(years[2011]["harmonized"]) == 28592 and years[2011]["hotspots"] == 9919
    assert round(years[2012]["harmonized"]) == 41356 and years[2012]["hotspots"] == 90002
    assert years[2000]["partial"] and years[2000]["rank"] is None
    assert cal["rangeSummary"]["hotspots"] == 2168246
    assert cal["peakSeason"]["months"] == [8, 9, 10]  # agosto a octubre concentran dos tercios


def test_current_month_anomaly_is_like_for_like(client):
    a = client.get("/api/v1/anomaly").json()
    assert a["monthToDateDays"] is not None
    # Comparado con meses completos daría ~0.54; de igual a igual es ~1.0.
    assert 0.9 <= a["ratio"] <= 1.1


def test_area_by_department_bbox_and_range(client):
    cusco = client.get("/api/v1/calendar", params={"department": "Cusco", "from": "2024-01", "to": "2024-12"}).json()
    assert cusco["range"]["months"] == 12 and cusco["rangeSummary"]["hotspots"] == 9508
    box = client.get("/api/v1/calendar", params={"bbox": "-73.98,-15.46,-70.35,-11.22"}).json()
    national = client.get("/api/v1/calendar").json()
    assert 0 < box["rangeSummary"]["hotspots"] < national["rangeSummary"]["hotspots"]


def test_cells_are_valid_geojson_hexagons(client):
    geo = client.get("/api/v1/cells", params={"month": "2024-09", "department": "Cusco"}).json()
    assert geo["type"] == "FeatureCollection" and len(geo["features"]) > 50
    ring = geo["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and len(ring) == 7
    assert -82 < ring[0][0] < -68 and -19 < ring[0][1] < 0.5


def test_ranking_and_csv_export(client):
    ranking = client.get("/api/v1/ranking", params={"from": "2024-01", "to": "2024-12"}).json()
    assert len(ranking) == 25 and ranking[0]["harmonized"] >= ranking[1]["harmonized"]
    assert all(0 < r["hexagons"] <= r["hotspots"] for r in ranking if r["hotspots"])
    csv_text = client.get("/api/v1/export.csv", params={"department": "Tacna", "from": "2024-01", "to": "2024-12"}).text
    lines = csv_text.strip().splitlines()
    assert lines[0].startswith("acq_date,cell_id,lat_center") and len(lines) > 1
    assert all(line.startswith("2024-") for line in lines[1:])


def test_bad_input_is_a_400_not_a_crash(client):
    for params in ({"bbox": "1,2,3"}, {"department": "Atlantis"}, {"from": "2024-99"}, {"department": "Cusco", "bbox": "-73,-15,-70,-11"}):
        response = client.get("/api/v1/calendar", params=params)
        assert response.status_code == 400 and "error" in response.json()


def test_hotspot_points_csv_matches_the_range_summary(client):
    """El CSV de focos trae un foco por fila: debe sumar lo mismo que el resumen del rango."""
    params = {"department": "Cusco", "from": "2024-01", "to": "2024-12"}
    lines = client.get("/api/v1/hotspots.csv", params=params).text.strip().splitlines()
    assert lines[0].startswith("acq_date,acq_time_utc,latitude,longitude,satellite,instrument")
    assert len(lines) - 1 == client.get("/api/v1/calendar", params=params).json()["rangeSummary"]["hotspots"] == 9508
    assert {line.split(",")[5] for line in lines[1:]} == {"MODIS", "VIIRS"}
    box = client.get("/api/v1/hotspots.csv", params={"bbox": "-71,-13.5,-69,-11.5", "from": "2024-09", "to": "2024-09"}).text
    for line in box.strip().splitlines()[1:]:
        _, _, lat, lon, *_ = line.split(",")
        assert -13.5 <= float(lat) <= -11.5 and -71 <= float(lon) <= -69


def test_analysis_csv_and_month_verdict(client):
    lines = client.get("/api/v1/calendar.csv", params={"department": "Cusco"}).text.strip().splitlines()
    assert lines[0].startswith("year,month,in_selected_range,harmonized_activity") and len(lines) == 314
    verdict = client.get("/api/v1/anomaly", params={"department": "Cusco", "month": "2024-09"}).json()
    assert verdict["percentile"] == 83 and verdict["category"] == "above"
    assert client.get("/api/v1/meta").json()["hasHotspotPoints"] is True


def test_daily_series_adds_up_to_the_national_totals(client):
    """La serie diaria (fondo de la línea de tiempo) suma lo mismo que el calendario mensual."""
    daily = client.get("/api/v1/daily").json()
    assert daily["start"] == "2000-11-01" and len(daily["harmonized"]) == len(daily["hotspots"]) == 9510
    assert sum(daily["hotspots"]) == 2168246
    assert round(sum(daily["harmonized"])) == round(client.get("/api/v1/calendar").json()["rangeSummary"]["harmonized"])


def test_day_ranges_are_inclusive_and_match_the_points(client):
    """Un rango de días: hexágonos, focos crudos y CSV cuentan los mismos focos."""
    params = {"department": "Cusco", "from": "2024-09-01", "to": "2024-09-15"}
    points = client.get("/api/v1/points", params=params).json()
    cells = client.get("/api/v1/cells", params=params).json()
    csv_rows = client.get("/api/v1/hotspots.csv", params=params).text.strip().splitlines()[1:]
    assert points["total"] == points["shown"] == sum(f["properties"]["hotspots"] for f in cells["features"]) == len(csv_rows)
    assert not points["truncated"] and points["fields"][:3] == ["lon", "lat", "instrument"]
    assert all("2024-09-01" <= p[4] <= "2024-09-15" for p in points["points"])
    assert {p[2] for p in points["points"]} <= {"MODIS", "VIIRS"}


def test_points_are_capped_newest_first(client):
    sample = client.get("/api/v1/points", params={"limit": 500}).json()
    assert sample["truncated"] and sample["shown"] == 500 and sample["total"] == 2168246
    assert sample["points"][0][4] >= sample["points"][-1][4]
    assert client.get("/api/v1/points", params={"limit": 0}).status_code == 400
    assert client.get("/api/v1/points", params={"from": "2030-01-01"}).status_code == 400


LIMITS = http_app.DATA_DIR / "peru_limits.json"


@pytest.mark.skipif(not LIMITS.exists(), reason="falta data/processed/peru_limits.json")
def test_official_limits_district_and_boundary(client):
    """Límites oficiales del INEI: un distrito filtra por sus celdas H3 y está dentro de su departamento."""
    limits = client.get("/api/v1/limits").json()
    assert len(limits["departments"]) == 25 and len(limits["districts"]) == 1890
    lares = next(d for d in limits["districts"] if d["ubigeo"] == "080404")
    assert lares["name"] == "Lares" and lares["department"] == "Cusco"
    year = {"from": "2024-01-01", "to": "2024-12-31"}
    district = client.get("/api/v1/points", params={"district": "080404", **year, "limit": 1}).json()["summary"]
    cusco = client.get("/api/v1/points", params={"department": "Cusco", **year, "limit": 1}).json()["summary"]
    assert 0 < district["total"] < cusco["total"] == 9508
    assert sum(cusco["bySensor"].values()) == cusco["total"] and set(cusco["bySensor"]) == {"MODIS", "VIIRS"}
    shape = client.get("/api/v1/boundary", params={"district": "080404"}).json()
    assert shape["type"] == "Feature" and shape["geometry"]["type"] == "MultiPolygon"
    assert client.get("/api/v1/points", params={"district": "999999"}).status_code == 400


def test_drawn_polygon_is_snapped_to_the_grid(client):
    """Un polígono dibujado filtra por las celdas cuyo centro cae dentro; contiene menos que su caja envolvente."""
    ring = "-72.5,-13;-71.5,-13;-71.5,-12.5"  # triángulo: la mitad de la caja
    year = {"from": "2024-01-01", "to": "2024-12-31", "limit": 1}
    tri = client.get("/api/v1/points", params={"polygon": ring, **year}).json()["total"]
    box = client.get("/api/v1/points", params={"bbox": "-72.5,-13,-71.5,-12.5", **year}).json()["total"]
    assert 0 < tri < box
    cal = client.get("/api/v1/calendar", params={"polygon": ring}).json()
    assert cal["rangeSummary"]["hotspots"] > 0
    for bad in ("1,2;3,4", "a,b;c,d;e,f"):
        assert client.get("/api/v1/calendar", params={"polygon": bad}).status_code == 400


def test_raw_points_carry_the_daily_event_recount(client):
    """Focos agrupados por día (buffer 375 m / 1 km y disolución): cuentan casi los mismos focos que los puntos."""
    params = {"department": "Cusco", "from": "2024-01-01", "to": "2024-12-31", "limit": 1}
    body = client.get("/api/v1/points", params=params).json()
    events, points = body["events"], body["summary"]
    assert 0 < events["total"] < events["hotspots"]
    # Los eventos se asignan al área por su centro: en el borde pueden sobrar o faltar unos pocos focos.
    assert abs(points["total"] - events["hotspots"]) < 0.01 * points["total"]
    assert sum(events["sizes"].values()) == events["total"]
    # Hexágonos con focos: los mismos que pinta la capa de celdas en ese rango.
    cells = client.get("/api/v1/cells", params={k: v for k, v in params.items() if k != "limit"}).json()["features"]
    assert points["hexagons"] == len(cells)
    assert events["activeDays"] <= points["activeDays"] and events["largest"]["hotspots"] >= 21


def test_province_is_an_official_area(client):
    limits = client.get("/api/v1/limits").json()
    assert len(limits["provinces"]) == 196
    cusco = next(p for p in limits["provinces"] if p["code"] == "0801")
    assert cusco["name"] == "Cusco" and cusco["department"] == "Cusco"
    assert client.get("/api/v1/boundary", params={"province": "0801"}).json()["geometry"]["type"] == "MultiPolygon"
    cal = client.get("/api/v1/calendar", params={"province": "0801"}).json()
    assert cal["area"]["kind"] == "province" and cal["rangeSummary"]["hotspots"] > 0
    assert client.get("/api/v1/calendar", params={"province": "9999"}).status_code == 400
    assert client.get("/api/v1/calendar", params={"province": "0801", "department": "Cusco"}).status_code == 400


def test_fire_forecast_is_poisson_and_checked_out_of_sample(client):
    for level, count in (("department", 25), ("province", 196), ("district", 1890)):
        fc = client.get("/api/v1/forecast", params={"level": level}).json()
        assert fc["sensor"] == "MODIS" and fc["years"] == {"from": 2003, "to": 2025, "count": 23} and len(fc["units"]) == count
        for u in fc["units"]:
            assert all(0 <= lo <= hi for lo, hi in zip(u["low"], u["high"]))
            assert all(0 <= p <= 1 for p in u["pAny"])
        check = fc["check"]
        # 2021-2025 fuera de muestra: mejor que una sola tasa, y el rango del 80 % cubre al menos el 80 % de los casos.
        assert check["test"] == [2021, 2025] and check["skill"] > 0.25 and check["coverage"] >= 0.8
    # Departamentos: los años varían más que un Poisson; el Poisson puro cubriría bastante menos que el 80 %.
    dept = client.get("/api/v1/forecast", params={"level": "department"}).json()["check"]
    assert dept["dispersion"] > 2 and dept["poissonCoverage"] < 0.7
    cusco = client.get("/api/v1/forecast/area", params={"department": "Cusco"}).json()["months"][8]
    assert cusco["expected"] > 50 and cusco["pAny"] > 0.99 and cusco["low"] <= cusco["expected"] <= cusco["high"]
    assert client.get("/api/v1/forecast", params={"level": "x"}).status_code == 400
    shapes = client.get("/api/v1/shapes", params={"level": "province"}).json()
    assert len(shapes["features"]) == 196
