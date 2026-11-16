"""Límites oficiales del Perú (INEI) para elegir el área: departamentos y distritos, y sus celdas H3.

Fuente: Geoservidor del INEI, servicio WFS de Interoperabilidad (capas ig_departamento, ig_provincia e
ig_distrito). https://geoespacial.inei.gob.pe/geoserver/Interoperabilidad/ows

Qué produce (data/processed/peru_limits.json):
  - departments: código, nombre y contorno simplificado de cada departamento.
  - districts: ubigeo, nombre, provincia, departamento y contorno simplificado.
  - cells: para cada departamento y distrito, las celdas H3 de resolución 6 cuyo centro cae dentro del límite
    oficial. Es la misma grilla de la serie armonizada: así un área oficial se filtra sin mover ningún dato.

Límites que la app debe declarar:
  - El área se ajusta a la grilla H3 (celdas de ~36 km²): en los bordes, una celda cuenta para el límite que
    contiene su centro. Un distrito más chico que una celda toma la celda que lo contiene.
  - La serie armonizada guarda además un departamento aproximado por celda; la selección por área usa este
    archivo oficial.

Uso:
  python src/etl/peru_limits.py            # descarga y escribe data/processed/peru_limits.json
"""

from __future__ import annotations

import json
import ssl
import unicodedata
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import h3

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT = REPO_ROOT / "data" / "processed" / "peru_limits.json"
WFS = "https://geoespacial.inei.gob.pe/geoserver/Interoperabilidad/ows"
USER_AGENT = "NASAT-ETL/1.0 (NASA Space Apps Challenge 2026)"
H3_RES = 6
# Tolerancia de simplificación en grados (~300 m): de sobra para dibujar un contorno sobre celdas de ~3,7 km.
TOLERANCE = 0.003
SMALL_WORDS = {"de", "del", "la", "las", "los", "y", "el"}
# El INEI publica los nombres de departamento sin tildes; la app los muestra con su ortografía.
ACCENTED = {"ANCASH": "Áncash", "APURIMAC": "Apurímac", "HUANUCO": "Huánuco", "JUNIN": "Junín", "SAN MARTIN": "San Martín"}


def fetch(layer: str, properties: str | None = None) -> list[dict]:
    params = {
        "service": "WFS", "version": "1.0.0", "request": "GetFeature",
        "typeName": f"Interoperabilidad:{layer}", "outputFormat": "application/json",
    }
    if properties:
        params["propertyName"] = properties
    request = urllib.request.Request(f"{WFS}?{urllib.parse.urlencode(params)}", headers={"User-Agent": USER_AGENT})
    try:  # algunos Python sin certificados del sistema: se usan los de certifi si está instalado
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=300, context=context) as response:
        return json.load(response)["features"]


def nice_name(text: str) -> str:
    """'MADRE DE DIOS' -> 'Madre de Dios'."""
    words = text.strip().lower().split()
    return " ".join(w if i and w in SMALL_WORDS else w[:1].upper() + w[1:] for i, w in enumerate(words))


def plain(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().upper().strip()


def _simplify_ring(ring: list[list[float]], tol: float) -> list[list[float]]:
    """Douglas-Peucker sobre un anillo cerrado; conserva al menos 4 puntos."""
    if len(ring) <= 4:
        return ring

    def dp(points: list[list[float]]) -> list[list[float]]:
        (x1, y1), (x2, y2) = points[0], points[-1]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
        far, index = 0.0, 0
        for i in range(1, len(points) - 1):
            x, y = points[i]
            d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm
            if d > far:
                far, index = d, i
        if far <= tol:
            return [points[0], points[-1]]
        return dp(points[: index + 1])[:-1] + dp(points[index:])

    half = len(ring) // 2
    out = dp(ring[: half + 1])[:-1] + dp(ring[half:])
    out = [[round(x, 4), round(y, 4)] for x, y in out]
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else ring


def simplify(geometry: dict) -> dict:
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    out = []
    for poly in polys:
        rings = [_simplify_ring(ring, TOLERANCE) for ring in poly]
        if len(rings[0]) >= 4:
            out.append(rings)
    return {"type": "MultiPolygon", "coordinates": out}


def cells_of(geometry: dict) -> list[str]:
    """Celdas H3 res 6 cuyo centro cae dentro del límite; si no hay ninguna, la celda de su punto central."""
    shape = h3.geo_to_h3shape(geometry)
    cells = h3.h3shape_to_cells(shape, H3_RES)
    if not cells:
        ring = geometry["coordinates"][0][0]
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        cells = [h3.latlng_to_cell(lat, lon, H3_RES)]
    return sorted(cells)


def main() -> None:
    print("[1/3] Descargando límites oficiales del INEI...")
    departments = fetch("ig_departamento")
    provinces = {(f["properties"]["ccdd"], f["properties"]["ccpp"]): f["properties"]["nombprov"]
                 for f in fetch("ig_provincia", "ccdd,ccpp,nombprov")}
    districts = fetch("ig_distrito")
    print(f"      {len(departments)} departamentos, {len(provinces)} provincias, {len(districts)} distritos")

    print("[2/3] Asignando celdas H3 y simplificando contornos...")
    dept_out, cells = [], {"department": {}, "district": {}}
    for f in sorted(departments, key=lambda f: f["properties"]["ccdd"]):
        name = ACCENTED.get(plain(f["properties"]["nombdep"]), nice_name(f["properties"]["nombdep"]))
        dept_out.append({"code": f["properties"]["ccdd"], "name": name, "geometry": simplify(f["geometry"])})
        cells["department"][f["properties"]["ccdd"]] = cells_of(f["geometry"])
    dist_out = []
    for f in sorted(districts, key=lambda f: f["properties"]["ubigeo"]):
        p = f["properties"]
        if not f["geometry"]:
            continue
        dist_out.append({
            "ubigeo": p["ubigeo"], "name": nice_name(p["nombdist"]), "department": p["ccdd"],
            "province": nice_name(provinces.get((p["ccdd"], p["ccpp"]), "")), "geometry": simplify(f["geometry"]),
        })
        cells["district"][p["ubigeo"]] = cells_of(f["geometry"])

    print("[3/3] Escribiendo data/processed/peru_limits.json...")
    payload = {
        "source": "INEI, Geoservidor WFS Interoperabilidad: ig_departamento, ig_provincia, ig_distrito",
        "url": WFS, "retrieved": date.today().isoformat(), "h3_resolution": H3_RES,
        "rule": "Una celda H3 pertenece al límite que contiene su centro.",
        "departments": dept_out, "districts": dist_out, "cells": cells,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print(f"      {OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
