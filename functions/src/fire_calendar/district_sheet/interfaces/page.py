"""Página compartible de la ficha (`/d/<ubigeo>`): la página de la web con las etiquetas Open Graph del distrito,
para que WhatsApp, LinkedIn o el correo muestren su nombre, sus meses a vigilar y la imagen de vista previa."""

from __future__ import annotations

import html
from pathlib import Path

from ..domain.model import DistrictSheet
from .texts import MONTHS, TEXT, day_label, join, percent

# Sin la web compilada (pruebas, desarrollo de la API) se sirve una página mínima con las mismas etiquetas.
FALLBACK = """<!doctype html><html lang="es"><head><meta charset="utf-8"><title>NASAT</title></head>
<body><p><a href="/sheet.html">NASAT</a></p></body></html>"""


def description(sheet: DistrictSheet, lang: str) -> str:
    text = TEXT[lang]
    date = day_label(sheet.last_date, lang)
    if not sheet.watch:
        return text["desc.calm"].format(parents=sheet.district.parents, date=date)
    months = join([f"{MONTHS[lang][m.month - 1]} ({percent(m.p_any)})" for m in sheet.watch], lang)
    return text["desc.watch"].format(parents=sheet.district.parents, year=sheet.forecast_year, months=months, date=date)


def sheet_page(template: str, sheet: DistrictSheet, lang: str, page_url: str, image_url: str) -> str:
    title = TEXT[lang]["title"].format(name=sheet.district.name)
    tags = {
        "og:type": "website", "og:site_name": "NASAT", "og:title": title, "og:description": description(sheet, lang),
        "og:url": page_url, "og:image": image_url, "og:image:width": "1200", "og:image:height": "630",
        "og:locale": "es_PE" if lang == "es" else "en_US",
    }
    meta = "".join(f'<meta property="{k}" content="{html.escape(v)}">' for k, v in tags.items())
    meta += f'<meta name="twitter:card" content="summary_large_image"><meta name="description" content="{html.escape(tags["og:description"])}">'
    page = template.replace("<title>", f"{meta}<title>", 1) if "<title>" in template else template.replace("</head>", f"{meta}</head>", 1)
    start, end = page.find("<title>"), page.find("</title>")
    if start != -1 and end != -1:
        page = page[: start + len("<title>")] + html.escape(f"{title} · NASAT") + page[end:]
    return page


def template_from(web_dist: Path) -> str:
    built = web_dist / "sheet.html"
    return built.read_text(encoding="utf-8") if built.exists() else FALLBACK
