"""Direcciones legibles de la ficha del distrito, para buscadores y para quien las lee en un mensaje.

`/incendios/cusco/canchis/sicuani` (español) y `/en/wildfires/cusco/canchis/sicuani` (inglés): la palabra que la gente
busca y el lugar de arriba abajo, como los nombra el INEI. Departamento, provincia y distrito juntos son únicos (los
1 890 distritos); el nombre del distrito solo no lo es (100 se repiten). `/d/<ubigeo>` queda como atajo y redirige.

`slugify` es la misma regla que `slugify` en web/src/district-sheet/domain/sheet.ts: si cambia una, cambia la otra.
"""

from __future__ import annotations

import re
import unicodedata

from ..domain.model import DistrictName

SECTION = {"es": "incendios", "en": "en/wildfires"}
MAP = {"es": "mapa", "en": "en/map"}


def slugify(text: str) -> str:
    """"Huánuco" → "huanuco", "Los Baños del Inca" → "los-banos-del-inca", "Anco_huallo" → "anco-huallo"."""
    plain = "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")


def slugs(district: DistrictName) -> tuple[str, str, str]:
    return slugify(district.department), slugify(district.province), slugify(district.name)


def district_path(district: DistrictName, lang: str) -> str:
    return "/" + "/".join((SECTION[lang], *slugs(district)))


def map_path(slug_parts: tuple[str, ...], lang: str) -> str:
    """Mapa de un área oficial: `/mapa/cusco/canchis`. Todo el Perú es la portada: `/` (en inglés, `/en/map`)."""
    if not slug_parts:
        return "/en/map" if lang == "en" else "/"
    return "/" + "/".join((MAP[lang], *slug_parts))
