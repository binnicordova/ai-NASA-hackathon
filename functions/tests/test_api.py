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
    assert meta["firstDate"] == "2000-11-01" and len(meta["departments"]) == 24
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
    assert cusco["range"]["months"] == 12 and cusco["rangeSummary"]["hotspots"] == 7475
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
    assert len(ranking) == 24 and ranking[0]["harmonized"] >= ranking[1]["harmonized"]
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
    assert len(lines) - 1 == client.get("/api/v1/calendar", params=params).json()["rangeSummary"]["hotspots"] == 7475
    assert {line.split(",")[5] for line in lines[1:]} == {"MODIS", "VIIRS"}
    box = client.get("/api/v1/hotspots.csv", params={"bbox": "-71,-13.5,-69,-11.5", "from": "2024-09", "to": "2024-09"}).text
    for line in box.strip().splitlines()[1:]:
        _, _, lat, lon, *_ = line.split(",")
        assert -13.5 <= float(lat) <= -11.5 and -71 <= float(lon) <= -69


def test_analysis_csv_and_month_verdict(client):
    lines = client.get("/api/v1/calendar.csv", params={"department": "Cusco"}).text.strip().splitlines()
    assert lines[0].startswith("year,month,in_selected_range,harmonized_activity") and len(lines) == 314
    verdict = client.get("/api/v1/anomaly", params={"department": "Cusco", "month": "2024-09"}).json()
    assert verdict["percentile"] == 87 and verdict["category"] == "above"
    assert client.get("/api/v1/meta").json()["hasHotspotPoints"] is True
