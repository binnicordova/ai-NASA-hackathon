"""Mapa del sitio y robots.txt: la portada, el mapa de cada área oficial y las 1 890 fichas de distrito, en los dos idiomas."""

from __future__ import annotations

from xml.sax.saxutils import escape

from ..domain.model import DistrictName
from ..application.places import Place
from .urls import district_path, map_path


def _with_alternates(base: str, paths: dict[str, str], last_date: str) -> list[str]:
    """Una página en los dos idiomas, cada versión con sus alternativas (hreflang), como pide Google."""
    alternates = "".join(f'<xhtml:link rel="alternate" hreflang="{code}" href="{escape(base + path)}"/>' for code, path in paths.items())
    alternates += f'<xhtml:link rel="alternate" hreflang="x-default" href="{escape(base + paths["es"])}"/>'
    return [f"<url><loc>{escape(base + path)}</loc><lastmod>{last_date}</lastmod>{alternates}</url>" for path in paths.values()]


def sitemap(base: str, districts: list[DistrictName], last_date: str, places: list[Place] | None = None) -> str:
    """La portada, el mapa de cada área oficial y la ficha de cada distrito, en español y en inglés."""
    rows = _with_alternates(base, {"es": map_path((), "es"), "en": map_path((), "en")}, last_date)
    for place in places or []:
        rows += _with_alternates(base, {code: map_path(place.slugs, code) for code in ("es", "en")}, last_date)
    for d in districts:
        rows += _with_alternates(base, {code: district_path(d, code) for code in ("es", "en")}, last_date)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
            + "".join(rows) + "</urlset>\n")


def robots(base: str) -> str:
    """La API no se indexa, salvo las imágenes de vista previa (las piden las redes al compartir un enlace)."""
    return f"User-agent: *\nAllow: /\nAllow: /api/v1/preview/\nDisallow: /api/\n\nSitemap: {base}/sitemap.xml\n"
