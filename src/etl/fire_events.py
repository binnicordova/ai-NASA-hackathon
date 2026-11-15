"""Eventos de fuego estimados a partir de focos de calor FIRMS (buffer + disolución diaria).

Método (equivalente a "buffer y dissolve por foco y por día" en un SIG):
  1. Se parte de los mismos focos limpios que usa harmonize_firms.py
     (sin baja confianza, sin duplicados Archive/NRT, sin fuentes estáticas).
  2. Cada foco se rodea con un buffer circular del tamaño nominal de su píxel:
     VIIRS 375 m, MODIS 1000 m.
  3. Por cada día, los buffers que se tocan se disuelven en un solo polígono.
     Cada polígono disuelto es un "evento de fuego" de ese día.

Contar polígonos disueltos equivale a contar componentes conexas del grafo
"distancia entre focos <= suma de sus radios", que es lo que se calcula aquí
(mucho más rápido que construir y unir geometrías, mismo resultado en el conteo).

Límites que la app debe declarar:
  - Un evento es un grupo de focos contiguos en un día, NO un incendio confirmado.
  - Un incendio que dura tres días cuenta tres veces (disolución por día).
  - El conteo NO está armonizado: VIIRS ve fuegos pequeños que MODIS no registra,
    así que el número de eventos salta en 2012, 2018 y 2023. Por eso se entregan
    también las series solo-MODIS y solo-VIIRS.

Uso:
  python src/etl/fire_events.py --repo <raíz con data/ y src/etl/harmonize_firms.py> --out <carpeta de salida>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

BUFFER_M = {"VIIRS": 375.0, "MODIS": 1000.0}
EARTH_R = 6_371_008.8
LAT0 = np.radians(-9.5)  # latitud media del Perú, solo para el índice espacial


def clean_points(hf) -> pd.DataFrame:
    """Reproduce la limpieza de harmonize_firms.run_pipeline hasta `clean_df`."""
    combined, _ = hf.discover_and_audit_csvs()
    df = combined[combined["confidence"] != "l"].copy()
    df["lat_round4"] = df["latitude"].round(4)
    df["lon_round4"] = df["longitude"].round(4)
    df = df.sort_values(by=["is_archive", "file_idx"], ascending=[False, True])
    df = df.drop_duplicates(
        subset=["satellite", "acq_date", "acq_time", "lat_round4", "lon_round4"], keep="first"
    ).copy()
    df = hf.assign_h3_indices(df)
    static = df[
        (df["instrument"] == "MODIS") & (df["is_archive"]) & (df["type"].notna()) & (df["type"] != 0)
    ]
    in_static = df["h3_res7"].isin(set(static["h3_res7"].unique()))
    other_non_veg = (~in_static) & df["type"].notna() & (df["type"] != 0)
    return df[~in_static & ~other_non_veg].copy()


def _components(n: int, i: np.ndarray, j: np.ndarray) -> np.ndarray:
    if len(i) == 0:
        return np.arange(n)
    graph = coo_matrix((np.ones(len(i), dtype=np.int8), (i, j)), shape=(n, n))
    return connected_components(graph, directed=False)[1]


def _summarise(labels: np.ndarray, keep: np.ndarray, lat: np.ndarray, lon: np.ndarray, frp: np.ndarray):
    """Centroide, número de focos y FRP sumado por componente, solo sobre los nodos `keep`."""
    lab = labels[keep]
    uniq, inv = np.unique(lab, return_inverse=True)
    n = np.bincount(inv)
    return (
        np.bincount(inv, weights=lat[keep]) / n,
        np.bincount(inv, weights=lon[keep]) / n,
        n,
        np.bincount(inv, weights=frp[keep]),
    )


def cluster_day(lat, lon, radius, is_modis, frp):
    """Disuelve los buffers de un día. Devuelve eventos para: todos, solo MODIS, solo VIIRS."""
    n = len(lat)
    x = EARTH_R * np.radians(lon) * np.cos(LAT0)
    y = EARTH_R * np.radians(lat)
    pairs = cKDTree(np.c_[x, y]).query_pairs(2 * max(BUFFER_M.values()) * 1.08, output_type="ndarray")
    if len(pairs):
        i, j = pairs[:, 0], pairs[:, 1]
        mid = np.radians((lat[i] + lat[j]) / 2)
        dist = np.hypot(
            EARTH_R * np.radians(lon[i] - lon[j]) * np.cos(mid), EARTH_R * np.radians(lat[i] - lat[j])
        )
        touch = dist <= radius[i] + radius[j]
        i, j = i[touch], j[touch]
    else:
        i = j = np.array([], dtype=int)
    out = {}
    everyone = np.ones(n, dtype=bool)
    out["all"] = _summarise(_components(n, i, j), everyone, lat, lon, frp)
    for name, mask in (("modis", is_modis), ("viirs", ~is_modis)):
        if mask.any():
            same = mask[i] & mask[j]
            out[name] = _summarise(_components(n, i[same], j[same]), mask, lat, lon, frp)
    return out


def build_events(clean: pd.DataFrame) -> pd.DataFrame:
    clean = clean.sort_values("acq_date")
    lat = clean["latitude"].to_numpy(float)
    lon = clean["longitude"].to_numpy(float)
    frp = clean["frp"].to_numpy(float)
    is_modis = (clean["instrument"] == "MODIS").to_numpy()
    radius = np.where(is_modis, BUFFER_M["MODIS"], BUFFER_M["VIIRS"])
    dates = clean["acq_date"].to_numpy()
    starts = np.r_[0, np.flatnonzero(dates[1:] != dates[:-1]) + 1, len(dates)]
    rows = []
    for a, b in zip(starts[:-1], starts[1:]):
        day = cluster_day(lat[a:b], lon[a:b], radius[a:b], is_modis[a:b], frp[a:b])
        for kind, (clat, clon, npts, sfrp) in day.items():
            rows.append(
                pd.DataFrame(
                    {"acq_date": dates[a], "sensor_set": kind, "lat": clat, "lon": clon,
                     "n_hotspots": npts.astype(np.int32), "sum_frp": sfrp}
                )
            )
    return pd.concat(rows, ignore_index=True)


def add_department(events: pd.DataFrame, hf) -> pd.DataFrame:
    """Departamento por celda H3 res 6 del centroide, igual que harmonize_firms."""
    import h3

    cells = [h3.latlng_to_cell(la, lo, 6) for la, lo in zip(events["lat"], events["lon"])]
    events["h3_res6"] = cells
    uniq = pd.unique(events["h3_res6"])
    centres = np.array([h3.cell_to_latlng(c) for c in uniq])
    dept, _ = hf.classify_peru_departments(centres[:, 1], centres[:, 0])
    events["department"] = events["h3_res6"].map(dict(zip(uniq, dept)))
    return events


def export_clean_points(clean: pd.DataFrame, hf, out: Path) -> int:
    """Guarda los focos limpios, uno por fila, para la descarga CSV de focos por área y fechas."""
    import h3

    cells = pd.unique(clean["h3_res6"])
    centres = np.array([h3.cell_to_latlng(c) for c in cells])
    dept, _ = hf.classify_peru_departments(centres[:, 1], centres[:, 0])
    points = pd.DataFrame(
        {
            "acq_date": clean["acq_date"].to_numpy(),
            "acq_time": clean["acq_time"].to_numpy(),
            "latitude": clean["latitude"].round(5).to_numpy(),
            "longitude": clean["longitude"].round(5).to_numpy(),
            "satellite": clean["satellite"].to_numpy(),
            "instrument": clean["instrument"].to_numpy(),
            "confidence": clean["confidence"].to_numpy(),
            "frp": clean["frp"].round(2).to_numpy(),
            "daynight": clean["daynight"].to_numpy(),
            "source": np.where(clean["is_archive"].to_numpy(), "archive", "nrt"),
            "cell_id": clean["h3_res6"].to_numpy(),
            "department": clean["h3_res6"].map(dict(zip(cells, dept))).to_numpy(),
        }
    ).sort_values(["acq_date", "acq_time"])
    points.to_parquet(out / "hotspots_clean.parquet", index=False)
    return len(points)


def month_grid(first: str, last: str) -> list[tuple[int, int]]:
    y, m = int(first[:4]), int(first[5:7])
    ye, me = int(last[:4]), int(last[5:7])
    out = []
    while (y, m) <= (ye, me):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def build_summary(events: pd.DataFrame, harmonized: pd.DataFrame) -> dict:
    events["year"] = events["acq_date"].str[:4].astype(int)
    events["month"] = events["acq_date"].str[5:7].astype(int)
    last_date = harmonized["acq_date"].max()
    grid = month_grid(harmonized["acq_date"].min(), last_date)
    last_y, last_m, last_d = int(last_date[:4]), int(last_date[5:7]), int(last_date[8:10])
    harmonized = harmonized.assign(day=harmonized["acq_date"].str[8:10].astype(int))

    def scope(ev: pd.DataFrame, hz: pd.DataFrame) -> dict:
        evm = ev.groupby(["year", "month", "sensor_set"]).size().unstack(fill_value=0)
        prim = hz[hz["is_primary_series"]]
        hm = prim.groupby(["year", "month"]).agg(
            h=("harmonized_fire_activity", "sum"),
            lo=("harmonized_uncertainty_low", "sum"),
            hi=("harmonized_uncertainty_high", "sum"),
        )
        raw = hz.groupby(["year", "month"])["raw_hotspots_count"].sum()
        rows = []
        for y, m in grid:
            e = evm.loc[(y, m)] if (y, m) in evm.index else {}
            h = hm.loc[(y, m)] if (y, m) in hm.index else None
            rows.append([
                y, m,
                round(float(h["h"]), 1) if h is not None else 0,
                int(raw.get((y, m), 0)),
                "M" if y < 2012 else "V",
                int(e.get("all", 0)), int(e.get("modis", 0)), int(e.get("viirs", 0)),
                round(float(h["lo"]), 1) if h is not None else 0,
                round(float(h["hi"]), 1) if h is not None else 0,
            ])
        # Mes en curso: comparar los mismos días del mes en años anteriores
        mtd = prim[(prim["month"] == last_m) & (prim["day"] <= last_d)].groupby("year")["harmonized_fire_activity"].sum()
        ref = [float(mtd.get(y, 0.0)) for y in range(2003, last_y)]
        val = float(mtd.get(last_y, 0.0))
        return {
            "m": rows,
            "lfl": {
                "days": last_d, "value": round(val, 1), "median": round(float(np.median(ref)), 1),
                "pct": int(round(100 * sum(r < val for r in ref) / len(ref))),
            },
        }

    scopes = {"Peru": scope(events, harmonized)}
    for dept in sorted(harmonized["department"].unique()):
        scopes[dept] = scope(events[events["department"] == dept], harmonized[harmonized["department"] == dept])
    return {
        "meta": {
            "method": "Buffer por foco (VIIRS 375 m, MODIS 1000 m) y disolución diaria; un evento = un polígono disuelto en un día",
            "buffer_m": BUFFER_M,
            "last_date": last_date,
            "row_fields": ["year", "month", "harmonized_activity", "raw_hotspots", "primary_sensor",
                           "events_all_sensors", "events_modis_only", "events_viirs_only",
                           "harmonized_low", "harmonized_high"],
            "warnings": [
                "Un evento no es un incendio confirmado.",
                "Disolución por día: un incendio de varios días cuenta una vez por día.",
                "El conteo de eventos no está armonizado entre sensores.",
                "Departamentos asignados con polígonos aproximados.",
            ],
        },
        "scopes": scopes,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    out = args.out or args.repo / "data" / "processed"
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(args.repo / "src" / "etl"))
    import harmonize_firms as hf

    print("[1/4] Limpiando focos (mismas reglas que harmonize_firms)...")
    clean = clean_points(hf)
    print(f"      {len(clean):,} focos limpios, {clean['acq_date'].nunique():,} días")
    print(f"      focos exportados: {export_clean_points(clean, hf, out):,} -> hotspots_clean.parquet")
    print("[2/4] Buffer + disolución por día...")
    events = build_events(clean)
    print("[3/4] Asignando departamento...")
    events = add_department(events, hf)
    events.to_parquet(out / "fire_events.parquet", index=False)
    print("[4/4] Resumen por departamento y mes...")
    harmonized = pd.read_parquet(args.repo / "data" / "processed" / "harmonized_fires.parquet")
    summary = build_summary(events, harmonized)
    (out / "fire_events_summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")))
    tot = events.groupby("sensor_set").size().to_dict()
    print(f"      eventos: {tot}")
    print(f"      focos limpios: {len(clean):,} | focos por evento (todos): {len(clean) / tot['all']:.2f}")


if __name__ == "__main__":
    main()
