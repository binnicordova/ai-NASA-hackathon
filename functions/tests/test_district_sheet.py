"""Ficha del distrito: el enlace corto que se comparte, su vista previa y la regla de los meses a vigilar."""

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from fire_calendar.calendar.domain.model import MonthForecast
from fire_calendar.district_sheet.domain.services import watch_months
from fire_calendar.interfaces.http import app as http_app

PARQUET = http_app.DATA_DIR / "harmonized_fires.parquet"
needs_data = pytest.mark.skipif(not PARQUET.exists(), reason="falta data/processed/harmonized_fires.parquet")


def month(m: int, p: float) -> MonthForecast:
    return MonthForecast(m, p, p, 0, 1, 23, 1, False)


def test_watch_months_are_the_three_most_likely_in_calendar_order():
    months = [month(m, p) for m, p in enumerate([0, 0, 0.04, 0, 0, 0.27, 0.27, 0.48, 0.43, 0.30, 0.08, 0.04], start=1)]
    assert [m.month for m in watch_months(months)] == [8, 9, 10]
    # Empate: gana el mes que llega antes en el año; por debajo del 5 % no se vigila.
    assert [m.month for m in watch_months([month(6, 0.27), month(7, 0.27), month(3, 0.04)], 1)] == [6]
    assert watch_months([month(1, 0.04)]) == ()


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(http_app.create_app())


@needs_data
def test_share_link_carries_the_district_and_its_months_to_watch(client):
    page = client.get("/d/080601")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    html = page.text
    assert '<meta property="og:title" content="Sicuani: calendario de fuego y meses a vigilar">' in html
    assert "Cusco › Canchis. En 2027, vigila agosto (48 %), setiembre (43 %) y octubre (30 %)." in html
    assert '/api/v1/preview/district/080601.png?v=' in html and 'og:image:width" content="1200"' in html
    english = client.get("/d/080601", params={"lang": "en"}).text
    assert "In 2027, watch August (48 %), September (43 %) and October (30 %)." in english and "&amp;lang=en" in english
    calm = client.get("/d/150101").text  # Lima: ningún mes llega al 5 %
    assert "Ningún mes con 5 % o más de probabilidad de fuego" in calm
    assert client.get("/d/999999").status_code == 404
    assert client.get("/d/12").status_code == 400


@needs_data
def test_preview_is_a_1200_by_630_png(client):
    response = client.get("/api/v1/preview/district/080601.png")
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)
    assert client.get("/api/v1/preview/district/999999.png").status_code == 404
