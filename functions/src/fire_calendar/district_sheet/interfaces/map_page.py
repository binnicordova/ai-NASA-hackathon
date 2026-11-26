"""Página del mapa de un área oficial (`/mapa/cusco/canchis/sicuani`): la app compilada (`web/dist/index.html`) con
lo que un buscador o una vista previa leen sin ejecutar JavaScript: idioma, título, descripción con la temporada,
dirección canónica (sin fechas ni pestaña: son filtros de la misma página) y alternativas por idioma. La web lee el
área de `<meta name="nasat-area">`, porque la dirección legible no lleva códigos."""

from __future__ import annotations

import html
import json
import re

from ..application.places import Place, PlaceFacts
from .texts import MONTHS, TEXT, day_label, join
from .urls import map_path


def map_title(place: Place, lang: str) -> str:
    return TEXT[lang]["map.title"].format(place=place.title) if place.names else TEXT[lang]["map.title.country"]


def map_description(place: Place, facts: PlaceFacts, lang: str) -> str:
    text = TEXT[lang]
    values = {"first": day_label(facts.first_date, lang), "last": day_label(facts.last_date, lang), "year": int(facts.last_date[:4]) + 1}
    if not place.names:
        return text["map.desc.country"].format(**values)
    season = text["map.season"].format(months=join([MONTHS[lang][m - 1] for m in facts.season], lang)) if facts.season else ""
    return text["map.desc"].format(place=place.title, season=season, **values)


def map_page(template: str, place: Place, facts: PlaceFacts, lang: str, base: str, image_url: str | None) -> str:
    canonical = base + map_path(place.slugs, lang)
    desc = map_description(place, facts, lang)
    title = map_title(place, lang)
    head = [f'<link rel="alternate" hreflang="{code}" href="{base + map_path(place.slugs, code)}">' for code in ("es", "en")]
    head.append(f'<link rel="alternate" hreflang="x-default" href="{base + map_path(place.slugs, "es")}">')
    og = {"og:type": "website", "og:site_name": "NASAT", "og:title": title.removesuffix(" · NASAT"), "og:description": desc,
          "og:url": canonical, "og:locale": "es_PE" if lang == "es" else "en_US"}
    if image_url:
        og.update({"og:image": image_url, "og:image:width": "1200", "og:image:height": "630"})
    head += [f'<meta property="{k}" content="{html.escape(v)}">' for k, v in og.items()]
    head.append('<meta name="twitter:card" content="summary_large_image">' if image_url else '<meta name="twitter:card" content="summary">')
    served = {"path": map_path(place.slugs, lang), "area": place.web_area()}
    head.append(f'<meta name="nasat-area" content="{html.escape(json.dumps(served, ensure_ascii=False))}">')

    # La portada trae sus alternativas (las de todo el Perú): se cambian por las de esta área.
    page = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">\s*', '', template)
    page = page.replace('<html lang="es"', f'<html lang="{lang}"', 1)
    page = re.sub(r"<title>.*?</title>", lambda _: f"<title>{html.escape(title)}</title>", page, count=1, flags=re.S)
    page = re.sub(r'<meta name="description" content="[^"]*">', lambda _: f'<meta name="description" content="{html.escape(desc)}">', page, count=1)
    page = re.sub(r'<link rel="canonical" href="[^"]*">', lambda _: f'<link rel="canonical" href="{canonical}">', page, count=1)
    return page.replace("</head>", "".join(head) + "</head>", 1)
