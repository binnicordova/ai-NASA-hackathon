"""Página de la ficha del distrito (`/incendios/<departamento>/<provincia>/<distrito>`): la página compilada de la web
con lo que un buscador o una vista previa necesitan leer sin ejecutar JavaScript.

- `<title>`, descripción, dirección canónica y alternativas por idioma (hreflang), etiquetas Open Graph.
- El nombre, la provincia y los meses a vigilar escritos en el HTML (la web los vuelve a escribir igual al cargar).
- Enlaces a los demás distritos de la provincia: así un buscador llega a todas las fichas desde cualquiera.
- Datos estructurados schema.org `Dataset` (Google Dataset Search): lugar, periodo, fuente y descarga CSV.
"""

from __future__ import annotations

import html
import json
from pathlib import Path

from ..domain.model import DistrictName, DistrictSheet
from .texts import MONTHS, TEXT, day_label, join, percent
from .urls import district_path

# Sin la web compilada (pruebas, desarrollo de la API) se sirve una página mínima con los mismos marcadores.
FALLBACK = """<!doctype html><html lang="es"><head><meta charset="utf-8"><title>NASAT</title></head>
<body><main id="sheet"><h1 id="sheetName"><!--ssr:name--></h1><p id="sheetParents"><!--ssr:parents--></p>
<p id="sheetWatch"><!--ssr:watch--></p><nav id="sheetNearby"><!--ssr:nearby--></nav></main></body></html>"""


def template_from(web_dist: Path) -> str:
    built = web_dist / "sheet.html"
    return built.read_text(encoding="utf-8") if built.exists() else FALLBACK


def _watch_list(sheet: DistrictSheet, lang: str) -> str:
    return join([f"{MONTHS[lang][m.month - 1]} ({percent(m.p_any)})" for m in sheet.watch], lang)


def title(sheet: DistrictSheet, lang: str) -> str:
    d = sheet.district
    return TEXT[lang]["title"].format(name=d.name, province=d.province, department=d.department)


def share_title(sheet: DistrictSheet, lang: str) -> str:
    return TEXT[lang]["share"].format(name=sheet.district.name)


def description(sheet: DistrictSheet, lang: str) -> str:
    text = TEXT[lang]
    date = day_label(sheet.last_date, lang)
    d = sheet.district
    place = f"{d.name} ({d.province}, {d.department})"
    if not sheet.watch:
        return text["desc.calm"].format(place=place, date=date)
    return text["desc.watch"].format(place=place, year=sheet.forecast_year, months=_watch_list(sheet, lang), date=date)


def _dataset(sheet: DistrictSheet, lang: str, base: str) -> dict:
    d = sheet.district
    text = TEXT[lang]
    place: dict = {"@type": "Place", "name": f"{d.name}, {d.province}, {d.department}, {text['country']}"}
    if sheet.bounds:
        west, south, east, north = sheet.bounds
        place["geo"] = {"@type": "GeoShape", "box": f"{south:.4f} {west:.4f} {north:.4f} {east:.4f}"}
    first_year, last_year = sheet.first_date[:4] or "2000", sheet.last_date[:4]
    return {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "name": text["dataset"].format(name=d.name, province=d.province, department=d.department, a=first_year, b=last_year),
        "description": description(sheet, lang),
        "url": base + district_path(d, lang),
        "inLanguage": lang,
        "identifier": f"ubigeo:{d.ubigeo}",
        "isAccessibleForFree": True,
        "creator": {"@type": "Organization", "name": "NASAT", "url": base + "/"},
        "isBasedOn": "https://firms.modaps.eosdis.nasa.gov/",
        "spatialCoverage": place,
        "temporalCoverage": f"{sheet.first_date}/{sheet.last_date}" if sheet.first_date else sheet.last_date,
        "dateModified": sheet.last_date,
        "keywords": [d.name, d.province, d.department, "MODIS", "VIIRS", "NASA FIRMS",
                     "incendios forestales" if lang == "es" else "wildfires"],
        "distribution": [{
            "@type": "DataDownload", "encodingFormat": "text/csv",
            "contentUrl": f"{base}/api/v1/calendar.csv?district={d.ubigeo}",
        }],
    }


def _nearby(sheet: DistrictSheet, siblings: list[DistrictName], lang: str) -> str:
    if not siblings:
        return ""
    heading = html.escape(TEXT[lang]["nearby"].format(province=sheet.district.province))
    links = "".join(f'<li><a href="{district_path(s, lang)}">{html.escape(s.name)}</a></li>' for s in siblings)
    return f"<h2>{heading}</h2><ul>{links}</ul>"


def sheet_page(template: str, sheet: DistrictSheet, lang: str, base: str, siblings: list[DistrictName], image_url: str) -> str:
    """La página con su HTML para buscadores. `base` es el origen público (https://nasat.space)."""
    d = sheet.district
    canonical = base + district_path(d, lang)
    desc = description(sheet, lang)
    og = {
        "og:type": "website", "og:site_name": "NASAT", "og:title": share_title(sheet, lang), "og:description": desc,
        "og:url": canonical, "og:image": image_url, "og:image:width": "1200", "og:image:height": "630",
        "og:locale": "es_PE" if lang == "es" else "en_US",
    }
    head = [f'<meta name="description" content="{html.escape(desc)}">', f'<link rel="canonical" href="{canonical}">']
    for code in ("es", "en"):
        head.append(f'<link rel="alternate" hreflang="{code}" href="{base + district_path(d, code)}">')
    head.append(f'<link rel="alternate" hreflang="x-default" href="{base + district_path(d, "es")}">')
    head += [f'<meta property="{k}" content="{html.escape(v)}">' for k, v in og.items()]
    head.append('<meta name="twitter:card" content="summary_large_image">')
    # La web lee el distrito y el idioma de aquí: la dirección legible no lleva el ubigeo.
    head.append(f'<meta name="nasat-district" content="{d.ubigeo}">')
    data = json.dumps(_dataset(sheet, lang, base), ensure_ascii=False).replace("</", "<\\/")
    head.append(f'<script type="application/ld+json">{data}</script>')

    page = template.replace("<title>", "".join(head) + "<title>", 1) if "<title>" in template else template.replace("</head>", "".join(head) + "</head>", 1)
    start, end = page.find("<title>"), page.find("</title>")
    if start != -1 and end != -1:
        page = page[: start + len("<title>")] + html.escape(f"{title(sheet, lang)} · NASAT") + page[end:]
    page = page.replace('<html lang="es"', f'<html lang="{lang}"', 1)
    watch = TEXT[lang]["watch.lead"].format(months=_watch_list(sheet, lang)) if sheet.watch else TEXT[lang]["watch.none"]
    for marker, value in (
        ("name", html.escape(d.name)),
        ("parents", html.escape(f"{d.department} › {d.province} · Ubigeo {d.ubigeo}")),
        ("watch", html.escape(watch)),
        ("nearby", _nearby(sheet, siblings, lang)),
    ):
        page = page.replace(f"<!--ssr:{marker}-->", value, 1)
    return page
