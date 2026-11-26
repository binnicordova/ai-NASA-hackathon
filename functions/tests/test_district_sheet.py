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
def test_readable_address_carries_the_district_for_search_and_sharing(client):
    page = client.get("/incendios/cusco/canchis/sicuani")
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    html = page.text
    assert "<title>Incendios en Sicuani (Canchis, Cusco): calendario y meses a vigilar · NASAT</title>" in html
    assert '<link rel="canonical" href="http://testserver/incendios/cusco/canchis/sicuani">' in html
    assert '<link rel="alternate" hreflang="en" href="http://testserver/en/wildfires/cusco/canchis/sicuani">' in html
    assert '<meta property="og:title" content="Sicuani: calendario de fuego y meses a vigilar">' in html
    assert "Sicuani (Canchis, Cusco): en 2027, vigila agosto (48\u00a0%), setiembre (43\u00a0%) y octubre (30\u00a0%)." in html
    assert '/api/v1/preview/district/080601.png?v=' in html and '<meta name="nasat-district" content="080601">' in html
    # Sin JavaScript ya se lee el nombre, los meses a vigilar, los distritos vecinos y los datos estructurados.
    assert "Sicuani" in html.split("<h1", 1)[1].split("</h1>", 1)[0]
    assert '<a href="/incendios/cusco/canchis/san-pablo">San Pablo</a>' in html
    assert '"@type": "Dataset"' in html and '"identifier": "ubigeo:080601"' in html
    english = client.get("/en/wildfires/cusco/canchis/sicuani").text
    assert '<html lang="en"' in english and "Wildfires in Sicuani (Canchis, Cusco)" in english
    assert "in 2027, watch August (48\u00a0%), September (43\u00a0%), and October (30\u00a0%)." in english
    calm = client.get("/incendios/lima/lima/lima").text  # Lima: ningún mes llega al 5 %
    assert "ningún mes con 5 % o más de probabilidad de fuego" in calm
    assert client.get("/incendios/cusco/canchis/nada").status_code == 404


@needs_data
def test_old_and_odd_addresses_redirect_to_the_readable_one(client):
    def moved(path: str) -> str:
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 301
        return response.headers["location"]

    assert moved("/d/080601") == "/incendios/cusco/canchis/sicuani"
    assert moved("/d/080601?lang=en") == "/en/wildfires/cusco/canchis/sicuani"
    assert moved("/incendios/Cusco/Canchis/Sicuani") == "/incendios/cusco/canchis/sicuani"
    assert moved("/incendios/huánuco/huanuco/huanuco") == "/incendios/huanuco/huanuco/huanuco"
    assert client.get("/d/999999", follow_redirects=False).status_code == 404
    assert client.get("/d/12").status_code == 400


@needs_data
def test_sitemap_lists_every_district_in_both_languages(client):
    sitemap = client.get("/sitemap.xml")
    assert sitemap.headers["content-type"].startswith("application/xml")
    assert sitemap.text.count("<url>") == 1 + 2 * 1890
    assert "<loc>http://testserver/incendios/cusco/canchis/sicuani</loc>" in sitemap.text
    robots = client.get("/robots.txt").text
    assert "Disallow: /api/" in robots and "Allow: /api/v1/preview/" in robots and "Sitemap: http://testserver/sitemap.xml" in robots


def test_slugs_are_readable_and_ascii():
    from fire_calendar.district_sheet.interfaces.urls import slugify

    assert [slugify(x) for x in ("Huánuco", "Los Baños del Inca", "Anco_huallo", "Madre de Dios", "Áncash")] == [
        "huanuco", "los-banos-del-inca", "anco-huallo", "madre-de-dios", "ancash"]


@needs_data
def test_preview_is_a_1200_by_630_png(client):
    response = client.get("/api/v1/preview/district/080601.png")
    assert response.status_code == 200 and response.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)
    assert client.get("/api/v1/preview/district/999999.png").status_code == 404
