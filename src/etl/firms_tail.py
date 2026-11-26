"""Cola de datos nuevos de FIRMS: lo posterior al corte, procesado con las reglas de la base.

La base (`data/processed/*.parquet`) llega hasta el día anterior al corte de `base_manifest.json`.
Este módulo trae de la API de FIRMS (NRT: MODIS, NOAA-20, NOAA-21) los días desde el corte hasta hoy,
los limpia y armoniza con el mismo código y los mismos factores congelados (`frozen_params.json`) y
publica tres parquets pequeños (la "cola") en un almacén. La API de `functions/` une base y cola.

    FIRMS_MAP_KEY=... python src/etl/firms_tail.py --store gs://BUCKET/tail

Una corrida primero mira los feeds públicos (ETag): si no cambiaron, termina sin hacer nada.
La clave nunca se imprime ni se guarda.
"""

from __future__ import annotations

import argparse
import copy
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from http.client import HTTPException
from pathlib import Path

import numpy as np
import pandas as pd

ETL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ETL_DIR))

import fire_events as fe  # noqa: E402
import harmonize_firms as hf  # noqa: E402
from tail_store import Store, StoreConflict, open_store  # noqa: E402

DATA_DIR = Path(os.environ.get("FIRE_DATA_DIR", ETL_DIR.parents[1] / "data" / "processed"))
FIRMS = "https://firms.modaps.eosdis.nasa.gov"
USER_AGENT = "NASAT-ETL/1.0 (NASA Space Apps Challenge 2026)"
BBOX = "-82,-19,-68,1"  # caja que envuelve a Perú; se recorta al país con las celdas del INEI
CHUNK_DAYS = 5  # la API entrega de 1 a 5 días por llamada
REFRESH_DAYS = 3  # cada corrida vuelve a pedir los últimos días: los pases llegan por lotes
KEEP_VERSIONS = 6
SILENT_AFTER = timedelta(hours=48)
TABLES = ("harmonized_fires", "fire_events", "hotspots_clean")
SORT_KEYS = {
    "harmonized_fires": ["acq_date", "h3_res6", "instrument"],
    "fire_events": ["acq_date", "sensor_set", "lat", "lon"],
    "hotspots_clean": ["acq_date", "acq_time"],
}
MAP_KEY_FORMAT = re.compile(r"[0-9a-f]{32}")  # una MAP_KEY de FIRMS: 32 caracteres hexadecimales
# Los feeds públicos traen la confianza de VIIRS en palabras; la API, en letras.
CONFIDENCE_WORDS = {"low": "l", "nominal": "n", "high": "h"}


class TailError(RuntimeError):
    """Algo impide publicar una cola correcta. La versión anterior sigue vigente."""


@dataclass(frozen=True)
class Product:
    source: str  # nombre en la API de área
    code: str  # producto del ETL (el de los CSV de descarga)
    feed: str  # feed público de 24 h: solo se mira su ETag para saber si hay algo nuevo


# S-NPP dejó de entregar el 2 nov 2026, antes del corte: ya no es fuente de la cola.
PRODUCTS = (
    Product("MODIS_NRT", "M-C61", "modis-c6.1/csv/MODIS_C6_1_South_America_24h.csv"),
    Product("VIIRS_NOAA20_NRT", "J1V-C2", "noaa-20-viirs-c2/csv/J1_VIIRS_C2_South_America_24h.csv"),
    Product("VIIRS_NOAA21_NRT", "J2V-C2", "noaa-21-viirs-c2/csv/J2_VIIRS_C2_South_America_24h.csv"),
)


def log(message: str) -> None:
    print(message, flush=True)


# --- red ---------------------------------------------------------------------------------------


def http(url: str, *, secret: str = "", method: str = "GET", retries: int = 3, timeout: int = 60):
    """Devuelve (cuerpo, cabeceras). Reintenta errores de red y 5xx; la clave nunca sale en un mensaje."""
    last = "sin respuesta"
    for attempt in range(retries):
        request = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return (response.read() if method == "GET" else b""), response.headers
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if exc.code < 500 and exc.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, HTTPException, ValueError) as exc:
            last = type(exc).__name__  # solo el tipo: el mensaje puede traer la URL con la clave
        time.sleep(2**attempt)
    shown = url.replace(secret, "<MAP_KEY>") if secret else url
    raise TailError(f"{shown}: {last}")


def feed_marks() -> dict[str, dict | None]:
    """ETag y Last-Modified de cada feed público. Barato y sin clave; si falla uno, se reconstruye por las dudas."""
    marks: dict[str, dict | None] = {}
    for product in PRODUCTS:
        try:
            _, headers = http(f"{FIRMS}/data/active_fire/{product.feed}", method="HEAD", retries=2, timeout=30)
            marks[product.source] = {"etag": headers.get("ETag"), "lastModified": headers.get("Last-Modified")}
        except TailError as exc:
            log(f"aviso: no se pudo leer el feed de {product.source}: {exc}")
            marks[product.source] = None
    return marks


def nrt_window(key: str) -> dict[str, tuple[str, str]]:
    """Primer y último día con datos de cada producto (data_availability)."""
    body, _ = http(f"{FIRMS}/api/data_availability/csv/{key}/ALL", secret=key)
    table = pd.read_csv(io.BytesIO(body))
    if "data_id" not in table.columns:
        raise TailError("data_availability no devolvió la tabla esperada (¿clave inválida?)")
    return {row.data_id: (str(row.min_date), str(row.max_date)) for row in table.itertuples()}


def fetch_text(url: str, key: str = "") -> str:
    body, _ = http(url, secret=key)
    return body.decode("utf-8")


Fetch = Callable[[str], str]


def fetch_raw(product: Product, start: date, end: date, key: str, fetch: Fetch) -> pd.DataFrame:
    """Focos crudos de un producto entre dos días (ambos incluidos), en tramos de 5 días."""
    frames = []
    day = start
    while day <= end:
        days = min(CHUNK_DAYS, (end - day).days + 1)
        text = fetch(f"{FIRMS}/api/area/csv/{key}/{product.source}/{BBOX}/{days}/{day.isoformat()}")
        if not text.startswith("latitude,"):
            raise TailError(f"{product.source}: respuesta inesperada de la API ({text[:80]!r})")
        frames.append(pd.read_csv(io.StringIO(text), low_memory=False))
        day += timedelta(days=days)
    return pd.concat(frames, ignore_index=True).drop_duplicates()


# --- limpieza y armonización (las reglas de harmonize_firms.run_pipeline) --------------------------


def to_standard(raw: pd.DataFrame, code: str, file_idx: int) -> pd.DataFrame:
    """Mismo esquema que `discover_and_audit_csvs`, para un producto NRT."""
    raw = raw.copy()
    raw["confidence"] = raw["confidence"].astype(str).str.strip().str.lower().replace(CONFIDENCE_WORDS)
    sensor = hf.normalize_sensor(raw)
    confidence = hf.normalize_confidence(raw, sensor)
    mir, tir = hf.coalesce_thermal_columns(raw)
    return pd.DataFrame(
        {
            "file_idx": file_idx,
            "product": code,
            "source_type": "nrt",
            "is_archive": False,
            "latitude": pd.to_numeric(raw["latitude"], errors="coerce"),
            "longitude": pd.to_numeric(raw["longitude"], errors="coerce"),
            "bright_mir": mir,
            "bright_tir": tir,
            "acq_date": raw["acq_date"].astype(str).str.strip(),
            "acq_time": raw["acq_time"].astype(str).str.strip().str.zfill(4),
            "satellite": raw["satellite"].astype(str).str.strip(),
            "instrument": sensor,
            "confidence": confidence,
            "frp": pd.to_numeric(raw["frp"], errors="coerce").fillna(0.0),
            "daynight": raw["daynight"].astype(str).str.strip(),
            "type": np.nan,  # NRT no trae `type`: la máscara estática de la base ya quita esas fuentes
        }
    )


def peru_cells(limits_json: Path) -> frozenset[str]:
    """Celdas H3 res 6 cuyo centro cae en un departamento del INEI: el recorte al país."""
    limits = json.loads(limits_json.read_text(encoding="utf-8"))
    return frozenset(cell for cells in limits["cells"]["department"].values() for cell in cells)


def clean_rows(std: pd.DataFrame, static_h3_res7: set[str], cells: frozenset[str]) -> pd.DataFrame:
    """Pasos 1-3 de run_pipeline: confianza baja fuera, sin duplicados, sin fuentes estáticas; más el recorte a Perú."""
    df = std[std["confidence"] != "l"].copy()
    df["lat_round4"] = df["latitude"].round(4)
    df["lon_round4"] = df["longitude"].round(4)
    df = df.sort_values(by=["is_archive", "file_idx"], ascending=[False, True])
    df = df.drop_duplicates(subset=["satellite", "acq_date", "acq_time", "lat_round4", "lon_round4"], keep="first")
    if df.empty:
        return df
    df = hf.assign_h3_indices(df.copy())
    df = df[df["h3_res6"].isin(cells)]
    in_static = df["h3_res7"].isin(static_h3_res7)
    other_non_veg = (~in_static) & df["type"].notna() & (df["type"] != 0)
    clean = df[~in_static & ~other_non_veg].copy()
    clean["year"] = clean["acq_date"].str[:4].astype(np.int16)
    clean["month"] = clean["acq_date"].str[5:7].astype(np.int8)
    clean["k_viirs"] = hf.build_viirs_constellation_size(clean["acq_date"])
    return clean


@dataclass
class NewRows:
    harmonized_fires: pd.DataFrame
    fire_events: pd.DataFrame
    hotspots_clean: pd.DataFrame

    def tables(self) -> dict[str, pd.DataFrame]:
        return {name: getattr(self, name) for name in TABLES}


def build_new_rows(
    raw_by_source: dict[str, pd.DataFrame],
    *,
    factors: dict,
    static_h3_res7: set[str],
    cells: frozenset[str],
) -> NewRows:
    """De los focos crudos a las tres tablas del modelo de datos, sin tocar la red ni el disco."""
    codes = {p.source: p.code for p in PRODUCTS}
    parts = [to_standard(df, codes[source], idx) for idx, (source, df) in enumerate(raw_by_source.items())]
    std = pd.concat(parts, ignore_index=True)
    clean = clean_rows(std, static_h3_res7, cells) if len(std) else std
    if clean.empty:
        raise TailError("la API no devolvió focos limpios dentro de Perú para la ventana pedida")
    harmonized = hf.harmonize_daily(clean, copy.deepcopy(factors))  # muta `factors`: se le pasa una copia
    events = fe.add_department(fe.build_events(clean), hf)
    points = fe.points_frame(clean, hf)
    return NewRows(harmonized, events, points)


# --- cola publicada -------------------------------------------------------------------------------


def merge_tail(previous: dict[str, pd.DataFrame] | None, new: NewRows, start: str) -> dict[str, pd.DataFrame]:
    """La cola previa hasta `start` (sin incluirlo) más lo recién calculado desde `start`."""
    merged = {}
    for name, fresh in new.tables().items():
        if previous is not None:
            old = previous[name]
            fresh = pd.concat([old[old["acq_date"] < start], fresh], ignore_index=True)
        merged[name] = fresh.sort_values(SORT_KEYS[name]).reset_index(drop=True)
    return merged


def last_observations(points: pd.DataFrame) -> dict[str, str]:
    """Última detección (UTC) de MODIS, NOAA-20 y NOAA-21 dentro de Perú."""
    stamp = points["acq_date"] + "T" + points["acq_time"].str[:2] + ":" + points["acq_time"].str[2:] + "Z"
    groups = {
        "MODIS": points["instrument"] == "MODIS",
        "N20": points["satellite"] == "N20",
        "N21": points["satellite"] == "N21",
    }
    return {name: str(stamp[mask].max()) for name, mask in groups.items() if mask.any()}


def validate(tables: dict[str, pd.DataFrame], *, cutoff: str, previous_last: str | None, today: date | None) -> list[str]:
    """Falla (TailError) ante algo que no se debe publicar; devuelve avisos para el manifiesto."""
    harmonized = tables["harmonized_fires"]
    for name, table in tables.items():
        if table.empty:
            raise TailError(f"{name}: sin filas")
        if table["acq_date"].min() < cutoff:
            raise TailError(f"{name}: hay días anteriores al corte {cutoff}")
    if harmonized.duplicated(["h3_res6", "acq_date", "instrument"]).any():
        raise TailError("harmonized_fires: celdas-día duplicadas")
    if harmonized["harmonized_fire_activity"].isna().any() or (harmonized["harmonized_fire_activity"] < 0).any():
        raise TailError("harmonized_fires: actividad nula o negativa")
    last = str(harmonized["acq_date"].max())
    if previous_last and last < previous_last:
        raise TailError(f"el último día retrocede: {last} < {previous_last}")
    warnings = []
    if today and date.fromisoformat(last) < today - timedelta(days=4):
        raise TailError(f"los datos no llegan a hoy: último día {last}")
    return warnings


def silent_sensors(observed: dict[str, str], now: datetime) -> list[str]:
    stale = []
    for name in ("MODIS", "N20", "N21"):
        seen = observed.get(name)
        if not seen or now - datetime.fromisoformat(seen.replace("Z", "+00:00")) > SILENT_AFTER:
            stale.append(name)
    return stale


def read_tables(store: Store, manifest: dict) -> dict[str, pd.DataFrame]:
    tables = {}
    for name in TABLES:
        data = store.read(f"v={manifest['version']}/{name}.parquet")
        if data is None:
            raise TailError(f"falta v={manifest['version']}/{name}.parquet en el almacén")
        tables[name] = pd.read_parquet(io.BytesIO(data))
    return tables


def publish(store: Store, tables: dict[str, pd.DataFrame], manifest: dict, generation: int) -> None:
    version = manifest["version"]
    for name, table in tables.items():
        buffer = io.BytesIO()
        table.to_parquet(buffer, index=False, engine="pyarrow")
        store.write(f"v={version}/{name}.parquet", buffer.getvalue())
    body = json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=1).encode("utf-8")
    store.write(f"v={version}/manifest.json", body)
    store.write("latest.json", body, if_generation=generation)  # al final: antes de esto nadie ve la versión nueva
    for old in store.versions()[:-KEEP_VERSIONS]:
        store.delete_prefix(f"v={old}")


def run(
    store: Store,
    *,
    key: str,
    force: bool = False,
    end: date | None = None,
    now: datetime | None = None,
    fetch: Fetch | None = None,
    marks: Callable[[], dict] = feed_marks,
    window: Callable[[str], dict[str, tuple[str, str]]] = nrt_window,
) -> dict:
    now = now or datetime.now(timezone.utc)
    fetch = fetch or (lambda url: fetch_text(url, key))
    base = json.loads((DATA_DIR / "base_manifest.json").read_text(encoding="utf-8"))
    cutoff = base["cutoff"]
    state_raw = store.read("state.json")
    state = json.loads(state_raw) if state_raw else {}
    latest_raw = store.read("latest.json")
    latest = json.loads(latest_raw) if latest_raw else None

    seen = marks()
    if latest and not force and all(seen.values()) and seen == state.get("feeds"):
        log("sin cambios en los feeds de FIRMS: nada que hacer")
        return {"status": "unchanged", "version": latest["version"]}

    generation = store.generation("latest.json")
    previous = read_tables(store, latest) if latest else None
    start = cutoff
    if latest:
        start = max(cutoff, (date.fromisoformat(latest["lastDate"]) - timedelta(days=REFRESH_DAYS)).isoformat())
    last_day = end or now.date()
    if date.fromisoformat(start) > last_day:
        raise TailError(f"la ventana está vacía: {start} > {last_day}")

    available = window(key)
    for product in PRODUCTS:
        first = available.get(product.source, ("9999", ""))[0]
        if first > start:
            raise TailError(
                f"{product.source}: NRT solo desde {first} y la cola pide desde {start}; "
                "hay que restituir esos días con datos estándar (SP)"
            )

    log(f"ventana {start} → {last_day} (corte {cutoff})")
    raw = {p.source: fetch_raw(p, date.fromisoformat(start), last_day, key, fetch) for p in PRODUCTS}
    for source, frame in raw.items():
        log(f"  {source}: {len(frame):,} focos en la caja")

    factors, static = hf.load_frozen_params(DATA_DIR / "frozen_params.json")
    new = build_new_rows(raw, factors=factors, static_h3_res7=static, cells=peru_cells(DATA_DIR / "peru_limits.json"))
    tables = merge_tail(previous, new, start)
    previous_last = latest["lastDate"] if latest else None
    warnings = validate(tables, cutoff=cutoff, previous_last=previous_last, today=None if end else now.date())

    observed = last_observations(tables["hotspots_clean"])
    silent = silent_sensors(observed, now)
    if silent:
        warnings.append(f"sensores sin detecciones en 48 h: {', '.join(silent)}")
    for warning in warnings:
        log(f"aviso: {warning}")

    manifest = {
        "version": now.strftime("%Y%m%dT%H%M%SZ"),
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cutoff": cutoff,
        "lastDate": str(tables["harmonized_fires"]["acq_date"].max()),
        "rows": {name: int(len(table)) for name, table in tables.items()},
        "lastObservation": observed,
        "warnings": warnings,
    }
    try:
        publish(store, tables, manifest, generation)
    except StoreConflict as exc:
        raise TailError(f"otra corrida publicó primero ({exc}); la próxima lo reintenta") from exc
    store.write("state.json", json.dumps({"feeds": seen, "lastRun": manifest["generatedAt"]}).encode("utf-8"))
    log(f"publicada la versión {manifest['version']}: último día {manifest['lastDate']}, filas {manifest['rows']}")
    return {"status": "published", **manifest}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--store", default=os.environ.get("FIRE_TAIL_STORE"), help="gs://BUCKET/PREFIJO o una carpeta")
    parser.add_argument("--force", action="store_true", help="reconstruir aunque los feeds no hayan cambiado")
    parser.add_argument("--end", type=date.fromisoformat, default=None, help="último día a pedir (por defecto, hoy UTC)")
    args = parser.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not args.store or not key:
        log("faltan --store (o FIRE_TAIL_STORE) y la variable FIRMS_MAP_KEY")
        return 2
    if not MAP_KEY_FORMAT.fullmatch(key):
        # Sin imprimir el valor: si el secreto tiene otra cosa, no debe acabar en los registros.
        log("ERROR: FIRMS_MAP_KEY no tiene el formato de una MAP_KEY (32 caracteres hexadecimales); revisa el secreto")
        return 2
    try:
        result = run(open_store(args.store), key=key, force=args.force, end=args.end)
    except TailError as exc:
        log(f"ERROR: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001 - nada de trazas: el mensaje de una excepción puede contener la clave
        log(f"ERROR inesperado: {type(exc).__name__}: {str(exc).replace(key, '<MAP_KEY>')[:300]}")
        return 1
    log(json.dumps({k: v for k, v in result.items() if k in ("status", "version", "lastDate")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
