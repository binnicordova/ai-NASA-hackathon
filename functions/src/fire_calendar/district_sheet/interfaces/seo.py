"""Mapa del sitio y robots.txt: la portada y las 1 890 fichas de distrito, en español y en inglés."""

from __future__ import annotations

from xml.sax.saxutils import escape

from ..domain.model import DistrictName
from .urls import district_path


def sitemap(base: str, districts: list[DistrictName], last_date: str) -> str:
    """Cada ficha en los dos idiomas, cada una con sus alternativas (hreflang), como pide Google."""
    rows = [f"<url><loc>{escape(base)}/</loc><lastmod>{last_date}</lastmod></url>"]
    for d in districts:
        alternates = "".join(
            f'<xhtml:link rel="alternate" hreflang="{code}" href="{escape(base + district_path(d, code))}"/>' for code in ("es", "en")
        ) + f'<xhtml:link rel="alternate" hreflang="x-default" href="{escape(base + district_path(d, "es"))}"/>'
        for code in ("es", "en"):
            rows.append(f"<url><loc>{escape(base + district_path(d, code))}</loc><lastmod>{last_date}</lastmod>{alternates}</url>")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
            + "".join(rows) + "</urlset>\n")


def robots(base: str) -> str:
    """La API no se indexa, salvo las imágenes de vista previa (las piden las redes al compartir un enlace)."""
    return f"User-agent: *\nAllow: /\nAllow: /api/v1/preview/\nDisallow: /api/\n\nSitemap: {base}/sitemap.xml\n"
