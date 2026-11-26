"""Pipeline de unificación, limpieza y armonización espacio-temporal NASA FIRMS.

Convierte detecciones crudas de MODIS (M-C61) y VIIRS (SV-C2, J1V-C2, J2V-C2)
en una serie continua comparable (2000–2026) expresada en unidades equivalentes
a 1 satélite VIIRS de referencia (S-NPP), neutralizando diferencias de:
  1. Esquema y confianza (MODIS 0-100 vs VIIRS l/n/h).
  2. Duplicados Archive vs Near Real-Time (NRT).
  3. Fuentes térmicas estáticas no vegetales (volcanes, industria, mar adentro)
     mediante máscara espacial H3 Resolución 7 derivada de MODIS Archive (MCD14ML).
  4. Resolución espacial y múltiples pasadas en el mismo día (agregación H3 Res 6).
  5. Inflación por constelación multi-satélite VIIRS (1 -> 2 -> 3 satélites en
     2012, 2018 y 2023) y cobertura inicial solo Terra (2000–julio 2002) con
     regularización por saturación intra-MODIS.
  6. Estacionalidad mensual de fuegos pequeños mediante factores alpha_month.
  7. Enriquecimiento territorial por departamento y región natural del Perú.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import h3
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Constantes de dominio y calendario de misiones NASA
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"
PROCESSED_DIR = DATA_DIR / "processed"
REPORT_PATH = REPO_ROOT / "docs" / "data_audit_report.md"

SOURCE_SUBDIRS = [
    "2000 al 2012",
    "2013 al 2023",
    "2024 al 2026",
]

AQUA_LAUNCH_DATE = "2002-07-04"
VIIRS_START_DATE = "2012-01-20"
NOAA20_START_DATE = "2018-04-01"
NOAA21_START_DATE = "2023-03-01"
SNPP_END_DATE = "2026-11-01"

BASELINE_START_YEAR = 2001
BASELINE_END_YEAR = 2020
CALIBRATION_START_YEAR = 2012
CALIBRATION_END_YEAR = 2025
PARTIAL_YEARS = {2000, 2026}

# Ventanas documentadas de corte MODIS en data/readme data.txt
MODIS_OUTAGE_RANGES: list[tuple[str, str, str]] = [
    ("2001-06-14", "2001-07-05", "Corte MODIS Terra junio-julio 2001"),
    ("2007-08-15", "2007-08-19", "Corte MODIS mediados de agosto 2007"),
    ("2009-04-20", "2009-04-22", "Corte MODIS 21-22 de abril 2009"),
]
MODIS_OUTAGE_MONTHS = {"2001-06", "2001-07", "2007-08", "2009-04"}

# Polígonos departamentales aproximados del Perú (lon, lat) para clasificación H3 Res 6
PERU_DEPT_POLYGONS: list[tuple[str, str, list[tuple[float, float]]]] = [
    ("Tumbes", "Costa", [(-81.33, -3.40), (-80.15, -3.40), (-80.15, -4.25), (-81.05, -4.25)]),
    ("Piura", "Costa", [(-81.35, -4.25), (-79.15, -4.25), (-79.15, -6.38), (-81.20, -6.38)]),
    ("Lambayeque", "Costa", [(-80.65, -5.45), (-79.15, -5.45), (-79.15, -7.20), (-80.65, -7.20)]),
    ("Cajamarca", "Sierra", [(-79.45, -4.60), (-77.75, -4.60), (-77.75, -7.80), (-79.45, -7.80)]),
    ("Amazonas", "Selva", [(-78.70, -2.98), (-77.10, -2.98), (-77.10, -6.95), (-78.70, -6.95)]),
    ("La Libertad", "Costa", [(-79.70, -6.95), (-76.90, -6.95), (-76.90, -8.98), (-79.70, -8.98)]),
    ("San Martín", "Selva", [(-77.75, -5.35), (-75.50, -5.35), (-75.50, -8.80), (-77.75, -8.80)]),
    ("Áncash", "Sierra", [(-78.70, -8.00), (-76.70, -8.00), (-76.70, -10.80), (-78.70, -10.80)]),
    (
        "Ucayali",
        "Selva",
        [
            (-75.85, -7.20),
            (-70.50, -7.20),
            (-70.50, -11.22),
            (-73.98, -11.22),
            (-74.20, -10.65),
            (-74.75, -9.80),
            (-75.85, -9.40),
        ],
    ),
    ("Huánuco", "Sierra", [(-77.10, -8.30), (-74.75, -8.30), (-74.75, -10.48), (-77.10, -10.48)]),
    ("Pasco", "Sierra", [(-76.60, -9.80), (-74.10, -9.80), (-74.10, -11.15), (-76.60, -11.15)]),
    ("Lima", "Costa", [(-77.90, -10.25), (-75.50, -10.25), (-75.50, -13.35), (-77.90, -13.35)]),
    ("Junín", "Sierra", [(-76.50, -10.65), (-73.35, -10.65), (-73.35, -12.65), (-76.50, -12.65)]),
    ("Huancavelica", "Sierra", [(-75.85, -11.95), (-74.20, -11.95), (-74.20, -14.15), (-75.85, -14.15)]),
    ("Ica", "Costa", [(-76.45, -13.00), (-74.60, -13.00), (-74.60, -15.45), (-76.45, -15.45)]),
    ("Apurímac", "Sierra", [(-73.85, -13.15), (-72.05, -13.15), (-72.05, -14.85), (-73.85, -14.85)]),
    ("Ayacucho", "Sierra", [(-75.15, -12.15), (-72.80, -12.15), (-72.80, -15.65), (-75.15, -15.65)]),
    (
        "Madre de Dios",
        "Selva",
        [
            (-72.40, -9.85),
            (-68.60, -9.85),
            (-68.60, -13.40),
            (-70.80, -13.40),
            (-71.50, -12.60),
            (-72.40, -11.80),
        ],
    ),
    (
        "Cusco",
        "Sierra",
        [
            (-73.98, -11.22),
            (-72.40, -11.22),
            (-72.40, -11.80),
            (-71.50, -12.60),
            (-70.35, -12.60),
            (-70.35, -15.46),
            (-72.05, -15.46),
            (-72.05, -13.15),
            (-73.85, -13.15),
        ],
    ),
    (
        "Loreto",
        "Selva",
        [
            (-77.80, -0.01),
            (-69.90, -0.01),
            (-69.90, -7.20),
            (-75.85, -7.20),
            (-75.85, -5.35),
            (-77.80, -5.35),
        ],
    ),
    ("Puno", "Sierra", [(-71.15, -13.00), (-68.65, -13.00), (-68.65, -17.30), (-71.15, -17.30)]),
    ("Arequipa", "Sierra", [(-75.10, -14.60), (-70.80, -14.60), (-70.80, -17.30), (-75.10, -17.30)]),
    ("Moquegua", "Costa", [(-71.50, -15.95), (-70.00, -15.95), (-70.00, -17.75), (-71.50, -17.75)]),
    ("Tacna", "Costa", [(-71.15, -16.75), (-69.40, -16.75), (-69.40, -18.40), (-71.15, -18.40)]),
]


@dataclass
class FileAuditRecord:
    """Registro de auditoría por archivo CSV fuente."""

    relative_path: str
    filename: str
    product: str
    source_type: str
    columns: list[str]
    total_rows: int
    min_acq_date: str
    max_acq_date: str
    satellites: list[str]
    versions: list[str]
    low_confidence_filtered: int = 0
    static_mask_filtered: int = 0
    other_non_veg_filtered: int = 0


def classify_peru_departments(
    lons: np.ndarray, lats: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Asigna departamento y región natural (Costa/Sierra/Selva) a vectores lon/lat."""

    def _point_in_poly(
        lon_arr: np.ndarray, lat_arr: np.ndarray, poly: list[tuple[float, float]]
    ) -> np.ndarray:
        inside = np.zeros(len(lon_arr), dtype=bool)
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            cond = ((y1 > lat_arr) != (y2 > lat_arr)) & (
                lon_arr < (x2 - x1) * (lat_arr - y1) / (y2 - y1 + 1e-12) + x1
            )
            inside ^= cond
        return inside

    dept = np.full(len(lons), "", dtype=object)
    region = np.full(len(lons), "", dtype=object)

    for name, reg, poly in PERU_DEPT_POLYGONS:
        mask = (dept == "") & _point_in_poly(lons, lats, poly)
        dept[mask] = name
        region[mask] = reg

    unassigned = np.where(dept == "")[0]
    if len(unassigned) > 0:
        centroids = [
            (
                name,
                reg,
                float(np.mean([p[0] for p in poly])),
                float(np.mean([p[1] for p in poly])),
            )
            for name, reg, poly in PERU_DEPT_POLYGONS
        ]
        for idx in unassigned:
            lo, la = float(lons[idx]), float(lats[idx])
            best = min(centroids, key=lambda c: (lo - c[2]) ** 2 + (la - c[3]) ** 2)
            dept[idx] = best[0]
            region[idx] = best[1]

    return dept, region


def parse_file_metadata(csv_path: Path) -> tuple[str, str]:
    """Extrae producto (M-C61, SV-C2, J1V-C2, J2V-C2) y tipo (archive/nrt)."""
    name = csv_path.name
    match = re.match(r"^fire_(archive|nrt)_([A-Z0-9-]+)_\d+\.csv$", name)
    if match:
        return match.group(2), match.group(1)
    source_type = "archive" if "archive" in name.lower() else "nrt"
    for prod in ("M-C61", "SV-C2", "J1V-C2", "J2V-C2"):
        if prod in name:
            return prod, source_type
    return "UNKNOWN", source_type


def normalize_sensor(df: pd.DataFrame) -> pd.Series:
    """Normaliza instrumento a 'MODIS' o 'VIIRS' (SV-C2 trae instrument='SNPP')."""
    sat = df["satellite"].astype(str).str.strip()
    is_modis = sat.isin(["Terra", "Aqua", "T", "A"])
    return pd.Series(np.where(is_modis, "MODIS", "VIIRS"), index=df.index)


def normalize_confidence(df: pd.DataFrame, sensor: pd.Series) -> pd.Series:
    """Estandariza confianza a {'l', 'n', 'h'} entre MODIS (0-100) y VIIRS (l/n/h)."""
    conf_str = df["confidence"].astype(str).str.strip().str.lower()
    num_conf = pd.to_numeric(df["confidence"], errors="coerce")
    is_modis = sensor == "MODIS"
    modis_mapped = np.where(
        num_conf < 30,
        "l",
        np.where(num_conf < 80, "n", "h"),
    )
    return pd.Series(np.where(is_modis, modis_mapped, conf_str), index=df.index)


def coalesce_thermal_columns(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    """Unifica brightness/bright_ti4 -> bright_mir y bright_t31/bright_ti5 -> bright_tir."""
    if "bright_ti4" in df.columns and "brightness" in df.columns:
        mir = df["bright_ti4"].fillna(df["brightness"])
    elif "bright_ti4" in df.columns:
        mir = df["bright_ti4"]
    else:
        mir = df["brightness"]

    if "bright_ti5" in df.columns and "bright_t31" in df.columns:
        tir = df["bright_ti5"].fillna(df["bright_t31"])
    elif "bright_ti5" in df.columns:
        tir = df["bright_ti5"]
    else:
        tir = df["bright_t31"]

    return pd.to_numeric(mir, errors="coerce"), pd.to_numeric(tir, errors="coerce")


def discover_and_audit_csvs() -> tuple[pd.DataFrame, list[FileAuditRecord]]:
    """Escanea recursivamente las carpetas de datos, audita cada CSV y estandariza el esquema."""
    csv_files: list[Path] = []
    for subdir in SOURCE_SUBDIRS:
        base = DATA_DIR / subdir
        if base.exists():
            csv_files.extend(sorted(base.rglob("*.csv")))

    if not csv_files:
        raise FileNotFoundError(f"No se encontraron archivos CSV en {DATA_DIR}")

    audit_records: list[FileAuditRecord] = []
    frames: list[pd.DataFrame] = []

    for idx, csv_path in enumerate(csv_files):
        product, source_type = parse_file_metadata(csv_path)
        raw_df = pd.read_csv(csv_path, low_memory=False)
        cols = list(raw_df.columns)
        satellites = sorted(raw_df["satellite"].dropna().astype(str).unique().tolist())
        versions = sorted(raw_df["version"].dropna().astype(str).unique().tolist())
        min_date = str(raw_df["acq_date"].min())
        max_date = str(raw_df["acq_date"].max())

        sensor = normalize_sensor(raw_df)
        conf_norm = normalize_confidence(raw_df, sensor)
        bright_mir, bright_tir = coalesce_thermal_columns(raw_df)

        low_conf_mask = conf_norm == "l"
        low_conf_count = int(low_conf_mask.sum())

        audit_records.append(
            FileAuditRecord(
                relative_path=str(csv_path.relative_to(REPO_ROOT)).replace("\\", "/"),
                filename=csv_path.name,
                product=product,
                source_type=source_type,
                columns=cols,
                total_rows=len(raw_df),
                min_acq_date=min_date,
                max_acq_date=max_date,
                satellites=satellites,
                versions=versions,
                low_confidence_filtered=low_conf_count,
            )
        )

        std_df = pd.DataFrame(
            {
                "file_idx": idx,
                "product": product,
                "source_type": source_type,
                "is_archive": source_type == "archive",
                "latitude": pd.to_numeric(raw_df["latitude"], errors="coerce"),
                "longitude": pd.to_numeric(raw_df["longitude"], errors="coerce"),
                "bright_mir": bright_mir,
                "bright_tir": bright_tir,
                "acq_date": raw_df["acq_date"].astype(str).str.strip(),
                "acq_time": raw_df["acq_time"].astype(str).str.strip().str.zfill(4),
                "satellite": raw_df["satellite"].astype(str).str.strip(),
                "instrument": sensor,
                "confidence": conf_norm,
                "frp": pd.to_numeric(raw_df["frp"], errors="coerce").fillna(0.0),
                "daynight": raw_df["daynight"].astype(str).str.strip(),
                "type": (
                    pd.to_numeric(raw_df["type"], errors="coerce")
                    if "type" in raw_df.columns
                    else np.nan
                ),
            }
        )
        frames.append(std_df)

    combined = pd.concat(frames, ignore_index=True)
    return combined, audit_records


def assign_h3_indices(df: pd.DataFrame) -> pd.DataFrame:
    """Asigna índices H3 Res 7 y Res 6 usando coordenadas únicas para máxima velocidad."""
    unique_coords = df[["latitude", "longitude"]].drop_duplicates().copy()
    h3_7_list = [
        h3.latlng_to_cell(lat, lon, 7)
        for lat, lon in zip(unique_coords["latitude"], unique_coords["longitude"])
    ]
    h3_6_list = [h3.cell_to_parent(cell, 6) for cell in h3_7_list]
    unique_coords["h3_res7"] = h3_7_list
    unique_coords["h3_res6"] = h3_6_list
    return df.merge(unique_coords, on=["latitude", "longitude"], how="left")


def build_viirs_constellation_size(acq_date: pd.Series) -> pd.Series:
    """Calcula el número de satélites VIIRS operativos en cada fecha."""
    has_snpp = (acq_date >= VIIRS_START_DATE) & (acq_date <= SNPP_END_DATE)
    has_n20 = acq_date >= NOAA20_START_DATE
    has_n21 = acq_date >= NOAA21_START_DATE
    return (has_snpp.astype(np.int8) + has_n20.astype(np.int8) + has_n21.astype(np.int8))


def flag_sensor_outages(acq_date: pd.Series, instrument: pd.Series) -> pd.Series:
    """Marca periodos conocidos de corte MODIS con quality_flag='SENSOR_OUTAGE'."""
    outage = pd.Series(False, index=acq_date.index)
    is_modis = instrument == "MODIS"
    for start_d, end_d, _ in MODIS_OUTAGE_RANGES:
        outage = outage | (is_modis & (acq_date >= start_d) & (acq_date <= end_d))
    return pd.Series(np.where(outage, "SENSOR_OUTAGE", "OK"), index=acq_date.index)


def compute_calibration_factors(
    clean_df: pd.DataFrame,
    cal_start: int = CALIBRATION_START_YEAR,
    cal_end: int = CALIBRATION_END_YEAR,
) -> dict[str, Any]:
    """Calcula factores empíricos mensuales:
    - beta_{k,m}: normaliza constelación VIIRS de k satélites a 1 satélite VIIRS equiv.
    - alpha_m: escala MODIS (Terra+Aqua) a unidades equivalentes 1-VIIRS por mes.
    - gamma_terra_m: ratio intra-MODIS mediana(MODIS_Terra_y_Aqua / MODIS_solo_Terra) (2003-2024)
      con umbrales históricos (T_med_m, M_med_m) para regularización por saturación.
    """
    viirs = clean_df[clean_df["instrument"] == "VIIRS"].copy()
    modis = clean_df[clean_df["instrument"] == "MODIS"].copy()

    # 1) Factores de constelación beta_{k, month} sobre periodo 2012-2025
    v_cal = viirs[viirs["year"].between(cal_start, cal_end)]
    v_union_m = (
        v_cal.groupby(["year", "month", "k_viirs", "h3_res6", "acq_date"], as_index=False)
        .size()
        .groupby(["year", "month", "k_viirs"])
        .size()
    )
    v_sat_m = (
        v_cal.groupby(
            ["year", "month", "k_viirs", "satellite", "h3_res6", "acq_date"], as_index=False
        )
        .size()
        .groupby(["year", "month", "k_viirs", "satellite"])
        .size()
        .groupby(["year", "month", "k_viirs"])
        .mean()
    )
    beta_df = pd.DataFrame({"single_sat": v_sat_m, "union_cells": v_union_m}).reset_index()
    beta_df["beta"] = beta_df["single_sat"] / beta_df["union_cells"]

    beta_lookup: dict[tuple[int, int], float] = {}
    for m in range(1, 13):
        beta_lookup[(1, m)] = 1.0
    for k in (2, 3):
        sub_k = beta_df[beta_df["k_viirs"] == k]
        global_k = float(sub_k["beta"].median()) if not sub_k.empty else 1.0 / k
        for m in range(1, 13):
            sub_km = sub_k[sub_k["month"] == m]["beta"]
            beta_lookup[(k, m)] = float(sub_km.median()) if not sub_km.empty else global_k

    # Aplicar beta_{k,m} para obtener VIIRS 1-sat-equivalent mensual
    v_daily_cal = (
        v_cal.groupby(["h3_res6", "acq_date", "year", "month", "k_viirs"], as_index=False)
        .agg(sum_frp=("frp", "sum"), max_frp=("frp", "max"))
    )
    v_daily_cal["beta"] = [
        beta_lookup.get((int(k), int(m)), 1.0)
        for k, m in zip(v_daily_cal["k_viirs"], v_daily_cal["month"])
    ]
    v_daily_cal["frp_1eq"] = v_daily_cal["sum_frp"] / v_daily_cal["k_viirs"].clip(lower=1)

    v_monthly = v_daily_cal.groupby(["year", "month"], as_index=False).agg(
        viirs_1eq_cells=("beta", "sum"),
        viirs_1eq_frp=("frp_1eq", "sum"),
    )

    # 2) Factores alpha_m (MODIS -> VIIRS 1-sat-eq) sobre periodo 2012-2025
    m_cal = modis[modis["year"].between(cal_start, cal_end)]
    m_daily_cal = (
        m_cal.groupby(["h3_res6", "acq_date", "year", "month"], as_index=False)
        .agg(max_frp=("frp", "max"))
    )
    m_monthly = m_daily_cal.groupby(["year", "month"], as_index=False).agg(
        modis_cells=("h3_res6", "size"),
        modis_max_frp=("max_frp", "sum"),
    )

    overlap = v_monthly.merge(m_monthly, on=["year", "month"], how="inner")
    overlap["alpha"] = overlap["viirs_1eq_cells"] / overlap["modis_cells"].replace(0, np.nan)
    overlap["alpha_frp"] = overlap["viirs_1eq_frp"] / overlap["modis_max_frp"].replace(0, np.nan)

    alpha_month: dict[int, float] = {}
    alpha_p25: dict[int, float] = {}
    alpha_p75: dict[int, float] = {}
    alpha_std: dict[int, float] = {}
    alpha_frp_month: dict[int, float] = {}

    global_alpha = float(overlap["alpha"].median())
    global_alpha_frp = float(overlap["alpha_frp"].median())

    for m in range(1, 13):
        sub = overlap[overlap["month"] == m]["alpha"].dropna()
        sub_frp = overlap[overlap["month"] == m]["alpha_frp"].dropna()
        if sub.empty:
            alpha_month[m] = global_alpha
            alpha_p25[m] = global_alpha * 0.85
            alpha_p75[m] = global_alpha * 1.15
            alpha_std[m] = 0.0
        else:
            alpha_month[m] = float(sub.median())
            alpha_p25[m] = float(sub.quantile(0.25))
            alpha_p75[m] = float(sub.quantile(0.75))
            alpha_std[m] = float(sub.std(ddof=1)) if len(sub) > 1 else 0.0
        alpha_frp_month[m] = float(sub_frp.median()) if not sub_frp.empty else global_alpha_frp

    # 3) Ratio intra-MODIS gamma_terra_m = mediana(celdas_MODIS_Terra_y_Aqua / celdas_MODIS_solo_Terra) (2003-2024)
    m_ta = modis[modis["year"].between(2003, 2024)]
    m_all_m = (
        m_ta.groupby(["h3_res6", "acq_date", "year", "month"], as_index=False)
        .agg(max_frp=("frp", "max"))
        .groupby(["year", "month"], as_index=False)
        .agg(all_cells=("h3_res6", "size"), all_frp=("max_frp", "sum"))
    )
    m_terra_m = (
        m_ta[m_ta["satellite"] == "Terra"]
        .groupby(["h3_res6", "acq_date", "year", "month"], as_index=False)
        .agg(max_frp=("frp", "max"))
        .groupby(["year", "month"], as_index=False)
        .agg(terra_cells=("h3_res6", "size"), terra_frp=("max_frp", "sum"))
    )
    t_ov = m_all_m.merge(m_terra_m, on=["year", "month"], how="inner")
    t_ov["gamma_terra"] = t_ov["all_cells"] / t_ov["terra_cells"].replace(0, np.nan)
    t_ov["gamma_frp_terra"] = t_ov["all_frp"] / t_ov["terra_frp"].replace(0, np.nan)

    gamma_terra_month: dict[int, float] = {}
    gamma_terra_p25: dict[int, float] = {}
    gamma_terra_p75: dict[int, float] = {}
    gamma_frp_terra_month: dict[int, float] = {}
    terra_median_cells: dict[int, float] = {}
    modis_median_cells: dict[int, float] = {}

    for m in range(1, 13):
        sub_m = t_ov[t_ov["month"] == m]
        sub_t = sub_m["gamma_terra"].dropna()
        sub_tf = sub_m["gamma_frp_terra"].dropna()
        gamma_terra_month[m] = float(sub_t.median())
        gamma_terra_p25[m] = float(sub_t.quantile(0.25))
        gamma_terra_p75[m] = float(sub_t.quantile(0.75))
        gamma_frp_terra_month[m] = float(sub_tf.median())
        terra_median_cells[m] = float(sub_m["terra_cells"].median())
        modis_median_cells[m] = float(sub_m["all_cells"].median())

    return {
        "beta_constellation": beta_lookup,
        "alpha_month": alpha_month,
        "alpha_p25": alpha_p25,
        "alpha_p75": alpha_p75,
        "alpha_std": alpha_std,
        "alpha_frp_month": alpha_frp_month,
        "gamma_terra_month": gamma_terra_month,
        "gamma_terra_p25": gamma_terra_p25,
        "gamma_terra_p75": gamma_terra_p75,
        "gamma_frp_terra_month": gamma_frp_terra_month,
        "terra_median_cells": terra_median_cells,
        "modis_median_cells": modis_median_cells,
    }


def compute_terra_only_effective_gamma(
    daily_df: pd.DataFrame, factors: dict[str, Any]
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, float]]:
    """Calcula el factor intra-MODIS efectivo gamma_terra para fechas < 2002-07-04.

    Cuando el conteo mensual observado solo por Terra (n_t) supera la mediana
    histórica de Terra (T_med) y se aproxima o supera la mediana combinada
    Terra+Aqua (M_med) —como en nov-dic 2000 durante la puesta en marcha inicial—,
    el factor efectivo decae suavemente hacia 1.0 para evitar extrapolar Aqua
    sobre un mes ya saturado.
    """
    is_modis = daily_df["instrument"] == "MODIS"
    is_terra_only = is_modis & (daily_df["acq_date"] < AQUA_LAUNCH_DATE)

    terra_monthly_counts = (
        daily_df[is_terra_only]
        .groupby(["year", "month"])
        .size()
        .to_dict()
    )

    g_eff_by_ym: dict[tuple[int, int], tuple[float, float, float, float]] = {}
    effective_summary: dict[str, float] = {}

    for (yr, m), n_t in sorted(terra_monthly_counts.items()):
        g_raw = factors["gamma_terra_month"][int(m)]
        g_p25 = factors["gamma_terra_p25"][int(m)]
        g_p75 = factors["gamma_terra_p75"][int(m)]
        g_frp = factors["gamma_frp_terra_month"][int(m)]
        t_med = factors["terra_median_cells"][int(m)]
        m_med = factors["modis_median_cells"][int(m)]

        if yr == 2000 or n_t >= m_med:
            # En nov-dic 2000 (783 celdas en 2 meses, ya por encima de la mediana combinada M_med)
            # la señal ya está en escala MODIS completa (sin inflación adicional por Aqua).
            sat_weight = 0.0
        elif n_t <= t_med:
            sat_weight = 1.0
        else:
            sat_weight = max(0.0, 1.0 - (n_t - t_med) / max(1.0, (m_med - t_med)))

        g_eff = 1.0 + (g_raw - 1.0) * sat_weight
        g_eff_low = 1.0 + (g_p25 - 1.0) * sat_weight
        g_eff_high = 1.0 + (g_p75 - 1.0) * sat_weight
        g_eff_frp = 1.0 + (g_frp - 1.0) * sat_weight

        g_eff_by_ym[(int(yr), int(m))] = (g_eff, g_eff_low, g_eff_high, g_eff_frp)
        effective_summary[f"{int(yr):04d}-{int(m):02d}"] = round(g_eff, 4)

    n = len(daily_df)
    g_arr = np.ones(n, dtype=float)
    g_low_arr = np.ones(n, dtype=float)
    g_high_arr = np.ones(n, dtype=float)
    g_frp_arr = np.ones(n, dtype=float)

    years = daily_df["year"].to_numpy()
    months = daily_df["month"].to_numpy()
    terra_mask = is_terra_only.to_numpy()

    for idx in np.where(terra_mask)[0]:
        vals = g_eff_by_ym.get((int(years[idx]), int(months[idx])), (1.0, 1.0, 1.0, 1.0))
        g_arr[idx] = vals[0]
        g_low_arr[idx] = vals[1]
        g_high_arr[idx] = vals[2]
        g_frp_arr[idx] = vals[3]

    return g_arr, g_low_arr, g_high_arr, g_frp_arr, effective_summary


def evaluate_validation_metrics(
    clean_df: pd.DataFrame, daily_df: pd.DataFrame
) -> dict[str, Any]:
    """Calcula métricas reales antes/después en solapamiento (2013-2025) y holdout (2021-2024)."""
    train_df = clean_df[clean_df["year"].between(2012, 2020)]
    train_factors = compute_calibration_factors(train_df, cal_start=2012, cal_end=2020)

    val_years = list(range(2021, 2025))
    val_daily = daily_df[daily_df["year"].isin(val_years)].copy()

    v_val = (
        val_daily[val_daily["instrument"] == "VIIRS"]
        .groupby(["year", "month"], as_index=False)
        .agg(
            viirs_raw_hotspots=("raw_hotspots_count", "sum"),
            viirs_unharm_cells=("active_cell_day", "sum"),
            viirs_1eq=("harmonized_fire_activity", "sum"),
        )
    )
    m_val = (
        val_daily[val_daily["instrument"] == "MODIS"]
        .groupby(["year", "month"], as_index=False)
        .agg(
            modis_raw_hotspots=("raw_hotspots_count", "sum"),
            modis_unharm_cells=("active_cell_day", "sum"),
        )
    )
    holdout_m = v_val.merge(m_val, on=["year", "month"], how="inner")
    holdout_m["modis_pred_oos"] = holdout_m["modis_unharm_cells"] * holdout_m["month"].map(
        train_factors["alpha_month"]
    )

    def _err_stats(actual: pd.Series, pred: pd.Series) -> dict[str, float]:
        actual_f = actual.astype(np.float64)
        pred_f = pred.astype(np.float64)
        diff = pred_f - actual_f
        abs_err = diff.abs()
        mape = float((abs_err / actual_f.replace(0, np.nan)).mean() * 100.0)
        mae = float(abs_err.mean())
        rmse = float(np.sqrt((diff**2).mean()))
        bias_pct = float((diff.sum() / actual_f.sum()) * 100.0)
        corr = float(actual_f.corr(pred_f))
        return {
            "mape_pct": round(mape, 2),
            "mae": round(mae, 1),
            "rmse": round(rmse, 1),
            "bias_pct": round(bias_pct, 2),
            "pearson_r": round(corr, 4),
        }

    holdout_annual = holdout_m.groupby("year", as_index=False).sum(numeric_only=True)

    full_ov_v = (
        daily_df[
            (daily_df["instrument"] == "VIIRS") & (daily_df["year"].between(2013, 2025))
        ]
        .groupby("year", as_index=False)
        .agg(
            viirs_raw=("raw_hotspots_count", "sum"),
            viirs_unharm_cells=("active_cell_day", "sum"),
            viirs_1eq=("harmonized_fire_activity", "sum"),
        )
    )
    full_ov_m = (
        daily_df[
            (daily_df["instrument"] == "MODIS") & (daily_df["year"].between(2013, 2025))
        ]
        .groupby("year", as_index=False)
        .agg(
            modis_raw=("raw_hotspots_count", "sum"),
            modis_unharm_cells=("active_cell_day", "sum"),
            modis_pred=("modis_calibrated_activity", "sum"),
        )
    )
    full_ann = full_ov_v.merge(full_ov_m, on="year", how="inner")

    return {
        "holdout_2021_2024_monthly": {
            "before_raw_modis_vs_viirs": _err_stats(
                holdout_m["viirs_raw_hotspots"], holdout_m["modis_raw_hotspots"]
            ),
            "before_unharmonized_cells": _err_stats(
                holdout_m["viirs_unharm_cells"], holdout_m["modis_unharm_cells"]
            ),
            "after_harmonized_oos": _err_stats(
                holdout_m["viirs_1eq"], holdout_m["modis_pred_oos"]
            ),
        },
        "holdout_2021_2024_annual": {
            "before_raw_modis_vs_viirs": _err_stats(
                holdout_annual["viirs_raw_hotspots"], holdout_annual["modis_raw_hotspots"]
            ),
            "before_unharmonized_cells": _err_stats(
                holdout_annual["viirs_unharm_cells"], holdout_annual["modis_unharm_cells"]
            ),
            "after_harmonized_oos": _err_stats(
                holdout_annual["viirs_1eq"], holdout_annual["modis_pred_oos"]
            ),
        },
        "overlap_2013_2025_annual": {
            "before_raw_modis_vs_viirs": _err_stats(
                full_ann["viirs_raw"], full_ann["modis_raw"]
            ),
            "before_unharmonized_cells": _err_stats(
                full_ann["viirs_unharm_cells"], full_ann["modis_unharm_cells"]
            ),
            "after_harmonized": _err_stats(
                full_ann["viirs_1eq"], full_ann["modis_pred"]
            ),
        },
    }


def write_frozen_params(path: Path, factors: dict[str, Any], static_h3_res7: set[str]) -> None:
    """Guarda con toda su precisión lo que la cola de datos nuevos necesita para calcular igual que la base.

    `calendar_summary.json` redondea los factores a 4 decimales; aquí van completos. Las constantes
    de calibración (2012-2025) y la máscara de fuentes estáticas no cambian con los días nuevos.
    """

    def plain(value: Any) -> Any:
        if isinstance(value, dict):
            return {(",".join(map(str, k)) if isinstance(k, tuple) else str(k)): plain(v) for k, v in value.items()}
        return value

    payload = {
        "calibration_years": [CALIBRATION_START_YEAR, CALIBRATION_END_YEAR],
        "factors": plain(factors),
        "static_h3_res7": sorted(static_h3_res7),
    }
    path.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True), encoding="utf-8")


def load_frozen_params(path: Path) -> tuple[dict[str, Any], set[str]]:
    """Inversa de write_frozen_params: factores con las claves originales (mes entero, (k, mes))."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    factors: dict[str, Any] = {}
    for name, table in raw["factors"].items():
        if name == "terra_effective_gamma_by_ym":
            factors[name] = table
        elif name == "beta_constellation":
            factors[name] = {tuple(int(x) for x in k.split(",")): v for k, v in table.items()}
        else:
            factors[name] = {int(k): v for k, v in table.items()}
    return factors, set(raw["static_h3_res7"])


def harmonize_daily(clean_df: pd.DataFrame, factors: dict[str, Any]) -> pd.DataFrame:
    """Agrega celdas-día H3 Res 6 y aplica los factores de calibración (pasos 4-5 de run_pipeline).

    Cada celda-día se calcula sola con los factores recibidos; por eso se usa igual en la
    reconstrucción completa y en la cola de datos nuevos (src/etl/firms_tail.py).
    Deja en `factors["terra_effective_gamma_by_ym"]` el resumen del factor Terra efectivo.
    """
    daily = (
        clean_df.groupby(["h3_res6", "acq_date", "year", "month", "instrument"], as_index=False)
        .agg(
            raw_hotspots_count=("frp", "size"),
            max_frp=("frp", "max"),
            sum_frp=("frp", "sum"),
            bright_mir_max=("bright_mir", "max"),
            bright_tir_mean=("bright_tir", "mean"),
            satellites_detected=("satellite", lambda s: sorted(set(s))),
        )
    )
    daily["active_cell_day"] = np.int8(1)
    daily["raw_hotspots_count"] = daily["raw_hotspots_count"].astype(np.int32)
    daily["k_viirs"] = build_viirs_constellation_size(daily["acq_date"])
    daily["constellation_size"] = np.where(
        daily["instrument"] == "VIIRS",
        daily["k_viirs"],
        np.where(daily["acq_date"] < AQUA_LAUNCH_DATE, 1, 2),
    ).astype(np.int8)

    # Coordenadas y clasificación departamental por hexágono H3 Res 6
    unique_h3_6 = daily["h3_res6"].unique()
    h3_centers = {c: h3.cell_to_latlng(c) for c in unique_h3_6}
    u_lats = np.array([h3_centers[c][0] for c in unique_h3_6], dtype=float)
    u_lons = np.array([h3_centers[c][1] for c in unique_h3_6], dtype=float)
    u_depts, u_regions = classify_peru_departments(u_lons, u_lats)
    h3_dept_map = dict(zip(unique_h3_6, u_depts))
    h3_region_map = dict(zip(unique_h3_6, u_regions))

    daily["lat_center"] = [h3_centers[c][0] for c in daily["h3_res6"]]
    daily["lon_center"] = [h3_centers[c][1] for c in daily["h3_res6"]]
    daily["department"] = [h3_dept_map[c] for c in daily["h3_res6"]]
    daily["natural_region"] = [h3_region_map[c] for c in daily["h3_res6"]]

    # Asignar factores de calibración con regularización por saturación en Solo-Terra
    is_modis = daily["instrument"] == "MODIS"
    is_terra_only = is_modis & (daily["acq_date"] < AQUA_LAUNCH_DATE)
    is_viirs_era = daily["acq_date"] >= VIIRS_START_DATE

    alpha_m = daily["month"].map(factors["alpha_month"]).astype(float).to_numpy()
    alpha_p25 = daily["month"].map(factors["alpha_p25"]).astype(float).to_numpy()
    alpha_p75 = daily["month"].map(factors["alpha_p75"]).astype(float).to_numpy()
    alpha_frp_m = daily["month"].map(factors["alpha_frp_month"]).astype(float).to_numpy()

    g_eff, g_eff_low, g_eff_high, g_eff_frp, terra_eff_summary = (
        compute_terra_only_effective_gamma(daily, factors)
    )
    factors["terra_effective_gamma_by_ym"] = terra_eff_summary

    eff_alpha = np.where(is_terra_only, alpha_m * g_eff, alpha_m)
    eff_alpha_low = np.where(is_terra_only, alpha_p25 * g_eff_low, alpha_p25)
    eff_alpha_high = np.where(is_terra_only, alpha_p75 * g_eff_high, alpha_p75)
    eff_alpha_frp = np.where(is_terra_only, alpha_frp_m * g_eff_frp, alpha_frp_m)

    beta_v = np.array(
        [
            factors["beta_constellation"].get((int(k), int(m)), 1.0)
            for k, m in zip(daily["k_viirs"], daily["month"])
        ],
        dtype=float,
    )

    daily["gamma_terra"] = np.where(is_terra_only, g_eff, 1.0)
    daily["alpha_month"] = np.where(is_modis, alpha_m, 1.0)
    daily["beta_constellation"] = np.where(is_modis, 1.0, beta_v)

    daily["modis_calibrated_activity"] = np.where(is_modis, eff_alpha, 0.0)
    daily["is_primary_series"] = np.where(is_viirs_era, ~is_modis, is_modis)

    daily["harmonized_fire_activity"] = np.where(
        daily["is_primary_series"],
        np.where(is_modis, eff_alpha, beta_v),
        0.0,
    )
    daily["harmonized_uncertainty_low"] = np.where(
        daily["is_primary_series"],
        np.where(is_modis, eff_alpha_low, beta_v),
        0.0,
    )
    daily["harmonized_uncertainty_high"] = np.where(
        daily["is_primary_series"],
        np.where(is_modis, eff_alpha_high, beta_v),
        0.0,
    )
    daily["harmonized_frp"] = np.where(
        daily["is_primary_series"],
        np.where(
            is_modis,
            daily["max_frp"] * eff_alpha_frp,
            daily["sum_frp"] / daily["k_viirs"].clip(lower=1),
        ),
        0.0,
    )

    daily["calibration_regime"] = np.where(
        is_modis,
        np.where(is_terra_only, "MODIS_TERRA_ONLY", "MODIS_TERRA_AQUA"),
        np.where(
            daily["k_viirs"] == 1,
            "VIIRS_1SAT",
            np.where(daily["k_viirs"] == 2, "VIIRS_2SAT", "VIIRS_3SAT"),
        ),
    )
    daily["quality_flag"] = flag_sensor_outages(daily["acq_date"], daily["instrument"])

    parquet_cols = [
        "h3_res6",
        "lat_center",
        "lon_center",
        "department",
        "natural_region",
        "acq_date",
        "year",
        "month",
        "instrument",
        "active_cell_day",
        "raw_hotspots_count",
        "max_frp",
        "sum_frp",
        "bright_mir_max",
        "bright_tir_mean",
        "satellites_detected",
        "constellation_size",
        "gamma_terra",
        "alpha_month",
        "beta_constellation",
        "harmonized_fire_activity",
        "harmonized_uncertainty_low",
        "harmonized_uncertainty_high",
        "harmonized_frp",
        "modis_calibrated_activity",
        "is_primary_series",
        "calibration_regime",
        "quality_flag",
    ]
    daily = daily[parquet_cols].sort_values(["acq_date", "h3_res6", "instrument"]).reset_index(
        drop=True
    )
    return daily


def run_pipeline() -> None:
    """Ejecuta el pipeline completo de auditoría, limpieza, armonización y exportación."""
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)

    print("[1/6] Escaneando y estandarizando archivos CSV en data/...")
    combined, audit_records = discover_and_audit_csvs()
    total_raw_rows = len(combined)

    keep_conf_mask = combined["confidence"] != "l"
    low_conf_total = int((~keep_conf_mask).sum())
    df_conf = combined[keep_conf_mask].copy()

    print("[2/6] Deduplicando registros Archive vs NRT...")
    df_conf["lat_round4"] = df_conf["latitude"].round(4)
    df_conf["lon_round4"] = df_conf["longitude"].round(4)
    df_conf = df_conf.sort_values(by=["is_archive", "file_idx"], ascending=[False, True])
    before_dedup = len(df_conf)
    df_dedup = df_conf.drop_duplicates(
        subset=["satellite", "acq_date", "acq_time", "lat_round4", "lon_round4"],
        keep="first",
    ).copy()
    dedup_removed = before_dedup - len(df_dedup)

    print("[3/6] Construyendo máscara espacial H3 Res 7 (MODIS type != 0) y asignando H3 Res 6...")
    df_dedup = assign_h3_indices(df_dedup)

    modis_static_rows = df_dedup[
        (df_dedup["instrument"] == "MODIS")
        & (df_dedup["is_archive"])
        & (df_dedup["type"].notna())
        & (df_dedup["type"] != 0)
    ]
    static_h3_res7 = set(modis_static_rows["h3_res7"].unique())

    in_static_mask = df_dedup["h3_res7"].isin(static_h3_res7)
    static_filtered_total = int(in_static_mask.sum())

    other_non_veg_mask = (~in_static_mask) & df_dedup["type"].notna() & (df_dedup["type"] != 0)
    other_non_veg_total = int(other_non_veg_mask.sum())

    static_by_file = df_dedup[in_static_mask].groupby("file_idx").size().to_dict()
    other_by_file = df_dedup[other_non_veg_mask].groupby("file_idx").size().to_dict()
    for i, rec in enumerate(audit_records):
        rec.static_mask_filtered = int(static_by_file.get(i, 0))
        rec.other_non_veg_filtered = int(other_by_file.get(i, 0))

    clean_df = df_dedup[~in_static_mask & ~other_non_veg_mask].copy()
    clean_df["year"] = clean_df["acq_date"].str[:4].astype(np.int16)
    clean_df["month"] = clean_df["acq_date"].str[5:7].astype(np.int8)
    clean_df["k_viirs"] = build_viirs_constellation_size(clean_df["acq_date"])

    print("[4/6] Agregando celdas-día H3 Res 6 y calculando factores de calibración...")
    factors = compute_calibration_factors(clean_df)

    daily = harmonize_daily(clean_df, factors)
    write_frozen_params(PROCESSED_DIR / "frozen_params.json", factors, static_h3_res7)

    print("[5/6] Exportando artefactos en data/processed/...")
    parquet_path = PROCESSED_DIR / "harmonized_fires.parquet"
    daily.to_parquet(parquet_path, index=False, engine="pyarrow")

    validation_metrics = evaluate_validation_metrics(clean_df, daily)

    # Resumen mensual 2000-2026
    unharm_daily = (
        daily.groupby(["h3_res6", "acq_date", "year", "month"], as_index=False)
        .size()
        .groupby(["year", "month"], as_index=False)
        .size()
        .rename(columns={"size": "cell_days_unharmonized"})
    )

    modis_m = (
        daily[daily["instrument"] == "MODIS"]
        .groupby(["year", "month"], as_index=False)
        .agg(
            raw_modis_hotspots=("raw_hotspots_count", "sum"),
            modis_cell_days=("active_cell_day", "sum"),
            modis_calibrated_activity=("modis_calibrated_activity", "sum"),
        )
    )
    viirs_m = (
        daily[daily["instrument"] == "VIIRS"]
        .groupby(["year", "month"], as_index=False)
        .agg(
            raw_viirs_hotspots=("raw_hotspots_count", "sum"),
            viirs_cell_days=("active_cell_day", "sum"),
        )
    )
    primary_m = (
        daily[daily["is_primary_series"]]
        .groupby(["year", "month"], as_index=False)
        .agg(
            harmonized_fire_activity=("harmonized_fire_activity", "sum"),
            harmonized_uncertainty_low=("harmonized_uncertainty_low", "sum"),
            harmonized_uncertainty_high=("harmonized_uncertainty_high", "sum"),
            harmonized_frp=("harmonized_frp", "sum"),
        )
    )

    monthly = (
        unharm_daily.merge(modis_m, on=["year", "month"], how="left")
        .merge(viirs_m, on=["year", "month"], how="left")
        .merge(primary_m, on=["year", "month"], how="left")
        .fillna(0.0)
        .sort_values(["year", "month"])
        .reset_index(drop=True)
    )

    baseline_df = monthly[monthly["year"].between(BASELINE_START_YEAR, BASELINE_END_YEAR)]
    baseline_stats: dict[int, dict[str, float]] = {}
    for m in range(1, 13):
        vals = baseline_df[baseline_df["month"] == m]["harmonized_fire_activity"]
        baseline_stats[m] = {
            "median_2001_2020": round(float(vals.median()), 2),
            "p90_2001_2020": round(float(vals.quantile(0.90)), 2),
            "mean_2001_2020": round(float(vals.mean()), 2),
        }

    monthly["historical_median_2001_2020"] = [
        baseline_stats[int(m)]["median_2001_2020"] for m in monthly["month"]
    ]
    monthly["historical_p90_2001_2020"] = [
        baseline_stats[int(m)]["p90_2001_2020"] for m in monthly["month"]
    ]
    monthly["anomaly_pct"] = np.where(
        monthly["historical_median_2001_2020"] > 0,
        (
            (monthly["harmonized_fire_activity"] - monthly["historical_median_2001_2020"])
            / monthly["historical_median_2001_2020"]
        )
        * 100.0,
        0.0,
    )
    monthly["anomaly_ratio"] = np.where(
        monthly["historical_median_2001_2020"] > 0,
        monthly["harmonized_fire_activity"] / monthly["historical_median_2001_2020"],
        0.0,
    )
    monthly["is_above_p90"] = (
        monthly["harmonized_fire_activity"] > monthly["historical_p90_2001_2020"]
    )
    monthly["year_month"] = [
        f"{int(y):04d}-{int(m):02d}" for y, m in zip(monthly["year"], monthly["month"])
    ]
    monthly["quality_flag"] = np.where(
        monthly["year_month"].isin(MODIS_OUTAGE_MONTHS), "SENSOR_OUTAGE", "OK"
    )
    monthly["primary_sensor"] = np.where(monthly["year"] < 2012, "MODIS", "VIIRS")
    monthly["is_partial_year"] = monthly["year"].isin(PARTIAL_YEARS)

    annual = (
        monthly.groupby("year", as_index=False)
        .agg(
            raw_modis=("raw_modis_hotspots", "sum"),
            raw_viirs=("raw_viirs_hotspots", "sum"),
            modis_cell_days=("modis_cell_days", "sum"),
            viirs_cell_days=("viirs_cell_days", "sum"),
            cell_days_unharmonized=("cell_days_unharmonized", "sum"),
            harmonized_fire_activity=("harmonized_fire_activity", "sum"),
            harmonized_uncertainty_low=("harmonized_uncertainty_low", "sum"),
            harmonized_uncertainty_high=("harmonized_uncertainty_high", "sum"),
            harmonized_frp=("harmonized_frp", "sum"),
            modis_calibrated_activity=("modis_calibrated_activity", "sum"),
        )
        .sort_values("year")
        .reset_index(drop=True)
    )

    monthly_records = []
    for row in monthly.to_dict(orient="records"):
        monthly_records.append(
            {
                "year": int(row["year"]),
                "month": int(row["month"]),
                "year_month": row["year_month"],
                "is_partial_year": bool(row["is_partial_year"]),
                "primary_sensor": row["primary_sensor"],
                "raw_modis_hotspots": int(row["raw_modis_hotspots"]),
                "raw_viirs_hotspots": int(row["raw_viirs_hotspots"]),
                "raw_total_hotspots": int(
                    row["raw_modis_hotspots"] + row["raw_viirs_hotspots"]
                ),
                "modis_cell_days": int(row["modis_cell_days"]),
                "viirs_cell_days": int(row["viirs_cell_days"]),
                "cell_days_unharmonized": int(row["cell_days_unharmonized"]),
                "harmonized_fire_activity": round(float(row["harmonized_fire_activity"]), 2),
                "harmonized_uncertainty_low": round(
                    float(row["harmonized_uncertainty_low"]), 2
                ),
                "harmonized_uncertainty_high": round(
                    float(row["harmonized_uncertainty_high"]), 2
                ),
                "harmonized_frp": round(float(row["harmonized_frp"]), 2),
                "historical_median_2001_2020": round(
                    float(row["historical_median_2001_2020"]), 2
                ),
                "historical_p90_2001_2020": round(float(row["historical_p90_2001_2020"]), 2),
                "anomaly_pct": round(float(row["anomaly_pct"]), 2),
                "anomaly_ratio": round(float(row["anomaly_ratio"]), 3),
                "is_above_p90": bool(row["is_above_p90"]),
                "quality_flag": row["quality_flag"],
            }
        )

    annual_records = []
    for row in annual.to_dict(orient="records"):
        yr = int(row["year"])
        annual_records.append(
            {
                "year": yr,
                "is_partial_year": yr in PARTIAL_YEARS,
                "raw_modis": int(row["raw_modis"]),
                "raw_viirs": int(row["raw_viirs"]),
                "modis_cell_days": int(row["modis_cell_days"]),
                "viirs_cell_days": int(row["viirs_cell_days"]),
                "cell_days_unharmonized": int(row["cell_days_unharmonized"]),
                "harmonized_fire_activity": round(float(row["harmonized_fire_activity"]), 2),
                "harmonized_uncertainty_low": round(
                    float(row["harmonized_uncertainty_low"]), 2
                ),
                "harmonized_uncertainty_high": round(
                    float(row["harmonized_uncertainty_high"]), 2
                ),
                "harmonized_frp": round(float(row["harmonized_frp"]), 2),
                "modis_calibrated_activity": round(
                    float(row["modis_calibrated_activity"]), 2
                ),
            }
        )

    calendar_payload = {
        "metadata": {
            "reference_unit": "1-VIIRS-equivalent (S-NPP baseline) active H3-res6 cell-days",
            "h3_spatial_resolution": 6,
            "static_mask_h3_resolution": 7,
            "static_mask_cells_count": len(static_h3_res7),
            "baseline_period": f"{BASELINE_START_YEAR}-{BASELINE_END_YEAR}",
            "calibration_period": f"{CALIBRATION_START_YEAR}-{CALIBRATION_END_YEAR}",
            "partial_years": sorted(PARTIAL_YEARS),
            "date_range": {
                "min": str(daily["acq_date"].min()),
                "max": str(daily["acq_date"].max()),
            },
            "outage_periods": [
                {"start": s, "end": e, "description": desc}
                for s, e, desc in MODIS_OUTAGE_RANGES
            ],
        },
        "calibration_factors": {
            "alpha_month_modis_to_viirs1eq": {
                str(m): round(v, 4) for m, v in factors["alpha_month"].items()
            },
            "alpha_month_iqr": {
                str(m): [
                    round(factors["alpha_p25"][m], 4),
                    round(factors["alpha_p75"][m], 4),
                ]
                for m in range(1, 13)
            },
            "gamma_terra_to_modis_raw": {
                str(m): round(v, 4) for m, v in factors["gamma_terra_month"].items()
            },
            "gamma_terra_effective_by_ym": factors["terra_effective_gamma_by_ym"],
            "beta_constellation_viirs": {
                f"k{k}_m{m}": round(v, 4)
                for (k, m), v in sorted(factors["beta_constellation"].items())
                if k in (2, 3)
            },
            "alpha_frp_month": {
                str(m): round(v, 4) for m, v in factors["alpha_frp_month"].items()
            },
        },
        "baseline_by_month_2001_2020": {
            str(m): stats for m, stats in baseline_stats.items()
        },
        "validation_metrics": validation_metrics,
        "annual_series": annual_records,
        "monthly_series": monthly_records,
    }

    calendar_path = PROCESSED_DIR / "calendar_summary.json"
    with open(calendar_path, "w", encoding="utf-8") as f:
        json.dump(calendar_payload, f, ensure_ascii=False, indent=2)

    # Construir h3_spatial_grid.json con departamento y región natural
    primary_daily = daily[daily["is_primary_series"]].copy()
    hex_agg = (
        primary_daily.groupby(
            ["h3_res6", "lat_center", "lon_center", "department", "natural_region"],
            as_index=False,
        )
        .agg(
            total_harmonized_activity=("harmonized_fire_activity", "sum"),
            total_harmonized_frp=("harmonized_frp", "sum"),
            active_days=("acq_date", "nunique"),
            active_years=("year", "nunique"),
            first_date=("acq_date", "min"),
            last_date=("acq_date", "max"),
        )
    )
    raw_by_hex = (
        daily.groupby("h3_res6", as_index=False)
        .agg(
            total_raw_hotspots=("raw_hotspots_count", "sum"),
            modis_raw_hotspots=(
                "raw_hotspots_count",
                lambda s: int(s[daily.loc[s.index, "instrument"] == "MODIS"].sum()),
            ),
            viirs_raw_hotspots=(
                "raw_hotspots_count",
                lambda s: int(s[daily.loc[s.index, "instrument"] == "VIIRS"].sum()),
            ),
        )
    )
    hex_month = (
        primary_daily.groupby(["h3_res6", "month"], as_index=False)["harmonized_fire_activity"]
        .sum()
        .pivot(index="h3_res6", columns="month", values="harmonized_fire_activity")
        .fillna(0.0)
    )
    for m in range(1, 13):
        if m not in hex_month.columns:
            hex_month[m] = 0.0
    hex_month = hex_month[list(range(1, 13))]

    hex_year_peak = (
        primary_daily.groupby(["h3_res6", "year"], as_index=False)["harmonized_fire_activity"]
        .sum()
        .sort_values(["h3_res6", "harmonized_fire_activity"], ascending=[True, False])
        .drop_duplicates("h3_res6")
        .rename(columns={"year": "peak_year"})[["h3_res6", "peak_year"]]
    )

    hex_base = (
        primary_daily[primary_daily["year"].between(BASELINE_START_YEAR, BASELINE_END_YEAR)]
        .groupby("h3_res6", as_index=False)["harmonized_fire_activity"]
        .sum()
    )
    hex_base["baseline_2001_2020_annual_mean"] = hex_base["harmonized_fire_activity"] / float(
        BASELINE_END_YEAR - BASELINE_START_YEAR + 1
    )

    hex_recent = (
        primary_daily[primary_daily["year"].between(2024, 2026)]
        .groupby("h3_res6", as_index=False)["harmonized_fire_activity"]
        .sum()
        .rename(columns={"harmonized_fire_activity": "recent_2024_2026_activity"})
    )

    hex_full = (
        hex_agg.merge(raw_by_hex, on="h3_res6", how="left")
        .merge(hex_year_peak, on="h3_res6", how="left")
        .merge(
            hex_base[["h3_res6", "baseline_2001_2020_annual_mean"]], on="h3_res6", how="left"
        )
        .merge(hex_recent, on="h3_res6", how="left")
        .fillna({"baseline_2001_2020_annual_mean": 0.0, "recent_2024_2026_activity": 0.0})
        .sort_values("total_harmonized_activity", ascending=False)
        .reset_index(drop=True)
    )

    hex_month_dict = hex_month.to_dict(orient="index")
    spatial_cells = []
    for row in hex_full.to_dict(orient="records"):
        h3_id = row["h3_res6"]
        m_vals = hex_month_dict.get(h3_id, {m: 0.0 for m in range(1, 13)})
        profile = [round(float(m_vals.get(m, 0.0)), 2) for m in range(1, 13)]
        peak_month = int(np.argmax(profile) + 1) if sum(profile) > 0 else 0
        spatial_cells.append(
            {
                "h3_res6": h3_id,
                "lat": round(float(row["lat_center"]), 5),
                "lon": round(float(row["lon_center"]), 5),
                "department": row["department"],
                "natural_region": row["natural_region"],
                "total_harmonized_activity": round(float(row["total_harmonized_activity"]), 2),
                "total_harmonized_frp": round(float(row["total_harmonized_frp"]), 2),
                "total_raw_hotspots": int(row["total_raw_hotspots"]),
                "modis_raw_hotspots": int(row["modis_raw_hotspots"]),
                "viirs_raw_hotspots": int(row["viirs_raw_hotspots"]),
                "active_days": int(row["active_days"]),
                "active_years": int(row["active_years"]),
                "first_date": row["first_date"],
                "last_date": row["last_date"],
                "peak_month": peak_month,
                "peak_year": int(row["peak_year"]),
                "baseline_2001_2020_annual_mean": round(
                    float(row["baseline_2001_2020_annual_mean"]), 3
                ),
                "recent_2024_2026_activity": round(float(row["recent_2024_2026_activity"]), 2),
                "monthly_profile": profile,
            }
        )

    dept_summary_df = (
        hex_full.groupby(["department", "natural_region"], as_index=False)
        .agg(
            active_cells=("h3_res6", "size"),
            total_harmonized_activity=("total_harmonized_activity", "sum"),
            total_harmonized_frp=("total_harmonized_frp", "sum"),
            total_raw_hotspots=("total_raw_hotspots", "sum"),
            min_lat=("lat_center", "min"),
            max_lat=("lat_center", "max"),
            min_lon=("lon_center", "min"),
            max_lon=("lon_center", "max"),
        )
        .sort_values("total_harmonized_activity", ascending=False)
    )
    departments_summary = [
        {
            "department": r["department"],
            "natural_region": r["natural_region"],
            "active_cells": int(r["active_cells"]),
            "total_harmonized_activity": round(float(r["total_harmonized_activity"]), 2),
            "total_harmonized_frp": round(float(r["total_harmonized_frp"]), 2),
            "total_raw_hotspots": int(r["total_raw_hotspots"]),
            "bbox": [
                round(float(r["min_lon"]), 4),
                round(float(r["min_lat"]), 4),
                round(float(r["max_lon"]), 4),
                round(float(r["max_lat"]), 4),
            ],
        }
        for r in dept_summary_df.to_dict(orient="records")
    ]

    spatial_payload = {
        "metadata": {
            "h3_resolution": 6,
            "approx_cell_area_km2": 36.13,
            "total_active_cells": len(spatial_cells),
            "departments_count": len(departments_summary),
            "static_masked_res7_cells": len(static_h3_res7),
            "reference_unit": "1-VIIRS-equivalent active cell-days",
        },
        "departments_summary": departments_summary,
        "cells": spatial_cells,
    }
    spatial_path = PROCESSED_DIR / "h3_spatial_grid.json"
    with open(spatial_path, "w", encoding="utf-8") as f:
        json.dump(spatial_payload, f, ensure_ascii=False)

    print("[6/6] Generando reporte científico docs/data_audit_report.md...")
    write_audit_report(
        audit_records=audit_records,
        total_raw_rows=total_raw_rows,
        low_conf_total=low_conf_total,
        dedup_removed=dedup_removed,
        static_h3_res7_count=len(static_h3_res7),
        static_filtered_total=static_filtered_total,
        other_non_veg_total=other_non_veg_total,
        clean_rows_total=len(clean_df),
        daily_rows_total=len(daily),
        primary_daily_rows=int(daily["is_primary_series"].sum()),
        factors=factors,
        validation_metrics=validation_metrics,
        annual_records=annual_records,
        outage_rows_flagged=int((daily["quality_flag"] == "SENSOR_OUTAGE").sum()),
    )
    print("Pipeline completado exitosamente.")


def write_audit_report(
    *,
    audit_records: list[FileAuditRecord],
    total_raw_rows: int,
    low_conf_total: int,
    dedup_removed: int,
    static_h3_res7_count: int,
    static_filtered_total: int,
    other_non_veg_total: int,
    clean_rows_total: int,
    daily_rows_total: int,
    primary_daily_rows: int,
    factors: dict[str, Any],
    validation_metrics: dict[str, Any],
    annual_records: list[dict[str, Any]],
    outage_rows_flagged: int,
) -> None:
    """Genera el reporte completo de auditoría y validación en español."""
    lines: list[str] = []
    lines.append("# Reporte de Auditoría y Armonización NASA FIRMS (2000–2026)")
    lines.append("")
    lines.append(
        "Este documento registra la auditoría exhaustiva de los archivos fuente de NASA FIRMS para Perú, "
        "la contabilidad exacta de limpieza y filtrado, el método de armonización espacio-temporal H3 "
        "con normalización multi-satélite y la validación cuantitativa antes/después."
    )
    lines.append("")

    # 1. Resumen de limpieza
    lines.append("## 1. Contabilidad Global de Limpieza y Deduplicación")
    lines.append("")
    lines.append("| Etapa del Pipeline | Registros | Delta / Filtrados | Descripción |")
    lines.append("|---|---:|---:|---|")
    lines.append(
        f"| Lectura cruda (`14` CSV) | {total_raw_rows:,} | — | Total de detecciones en `data/2000 al 2012`, `2013 al 2023` y `2024 al 2026` |"
    )
    lines.append(
        f"| Filtro de baja confianza (`'l'`) | {total_raw_rows - low_conf_total:,} | -{low_conf_total:,} | MODIS `< 30` y VIIRS `'l'` descartados para eliminar falsos positivos |"
    )
    lines.append(
        f"| Deduplicación Archive vs NRT | {total_raw_rows - low_conf_total - dedup_removed:,} | -{dedup_removed:,} | Clave `(satellite, acq_date, acq_time, round(lat,4), round(lon,4))` priorizando `archive` |"
    )
    lines.append(
        f"| Máscara estática H3 Res 7 (`MCD14ML`) | {total_raw_rows - low_conf_total - dedup_removed - static_filtered_total:,} | -{static_filtered_total:,} | {static_h3_res7_count:,} hexágonos H3 Res 7 donde MODIS Archive reporta `type != 0` (volcanes, industria, mar) aplicados a MODIS y VIIRS |"
    )
    lines.append(
        f"| Otros `type != 0` residuales (VIIRS Archive) | {clean_rows_total:,} | -{other_non_veg_total:,} | Detecciones VIIRS Archive `type != 0` fuera de la máscara MODIS Res 7 |"
    )
    lines.append(
        f"| **Agregación diaria `(h3_res6, acq_date, instrument)`** | **{daily_rows_total:,}** | — | Celdas-día activas (`{primary_daily_rows:,}` filas en la serie primaria continua) |"
    )
    lines.append("")

    # 2. Tabla de archivos procesados
    lines.append("## 2. Auditoría Detallada por Archivo Fuente")
    lines.append("")
    lines.append(
        "| Archivo | Producto | Tipo | Filas Crudas | Baja Confianza (`l`) | Máscara Estática + `type!=0` | Filas Limpias (est.) | Rango `acq_date` | Satélites | Versiones |"
    )
    lines.append("|---|---|---|---:|---:|---:|---:|---|---|---|")
    for r in audit_records:
        non_veg = r.static_mask_filtered + r.other_non_veg_filtered
        approx_clean = max(0, r.total_rows - r.low_confidence_filtered - non_veg)
        lines.append(
            f"| `{r.filename}` | `{r.product}` | `{r.source_type}` | {r.total_rows:,} | "
            f"{r.low_confidence_filtered:,} | {non_veg:,} | {approx_clean:,} | "
            f"`{r.min_acq_date}` → `{r.max_acq_date}` | {', '.join(r.satellites)} | {', '.join(r.versions)} |"
        )
    lines.append("")
    lines.append("### Esquema de columnas detectado en los archivos fuente")
    lines.append("")
    lines.append(
        "- **Archivos `archive` (MODIS y VIIRS, 10 archivos):** "
        "`latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight, type`."
    )
    lines.append(
        "- **Archivos `nrt` (MODIS y VIIRS, 4 archivos):** "
        "`latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight` (sin columna `type`)."
    )
    lines.append(
        "- **Hallazgo de auditoría:** En los archivos `SV-C2` (S-NPP), la columna `instrument` viene etiquetada como `'SNPP'` en lugar de `'VIIRS'`, por lo que el pipeline normaliza el sensor a partir de `satellite` (`Terra`/`Aqua` → `MODIS`; `SNPP`/`N20`/`N21` → `VIIRS`). Asimismo, aunque los archivos descargados usan `brightness`/`bright_t31`, el pipeline estandariza también `bright_ti4`/`bright_ti5` hacia `bright_mir`/`bright_tir`."
    )
    lines.append("")

    # 3. Método y Factores de Calibración
    lines.append("## 3. Factores de Calibración y Neutralización Multi-Satélite")
    lines.append("")
    lines.append(
        "Para lograr que **el sensor de origen no importe** ni en la transición MODIS→VIIRS (2012) "
        "ni ante la entrada de NOAA-20 (2018) y NOAA-21 (2023), toda la serie se expresa en una "
        "unidad física común: **celdas-día H3 Resolución 6 equivalentes a 1 satélite VIIRS de referencia (S-NPP)**."
    )
    lines.append("")
    lines.append(
        "1. **Neutralización multi-satélite VIIRS (`beta_{k, month}`):** Aunque agregar por `(h3_res6, acq_date, VIIRS)` "
        "colapsa detecciones repetidas en la misma celda, distintos satélites VIIRS pasan con ~50 minutos de desfase y "
        "diferente geometría/nubosidad, por lo que 2 satélites observan ~1.75× más celdas distintas que 1 satélite y 3 satélites ~2.25×. "
        "Calibramos $\\beta_{k,m} = \\text{mediana}(\\text{celdas}_{1\\text{-sat}} / \\text{celdas}_{\\text{unión } k\\text{-sat}})$ sobre 2012–2025."
    )
    lines.append(
        "2. **Calibración estacional MODIS → 1-VIIRS (`alpha_month`):** Calculada sobre el solapamiento 2012–2025 "
        "como la mediana mensual de $\\text{VIIRS}_{1\\text{-eq}} / \\text{MODIS}$, capturando que en meses húmedos "
        "(feb–abr) hay más quemas pequeñas solo detectadas por VIIRS ($\\alpha \\approx 6.8\\text{–}7.6$) que en temporada seca pico (ago–sep, $\\alpha \\approx 3.4\\text{–}3.8$)."
    )
    lines.append(
        "3. **Régimen inicial solo Terra (2000-11-01 a 2002-07-03) con regularización por saturación:** "
        "En Perú (`2003–2024`), la pasada matutina de Terra (~10:30 hora local, con nubosidad matinal amazónica/andina) "
        "captura solo el 14%–30% de las celdas diarias de MODIS (`Terra+Aqua`), por lo que el ratio intra-MODIS "
        "$\\gamma_{\\text{Terra}, m} = \\text{mediana}(\\text{MODIS}_{\\text{Terra+Aqua}} / \\text{MODIS}_{\\text{Terra}})$ es 3.17–7.15. "
        "Sin embargo, en noviembre–diciembre 2000 (puesta en marcha inicial de Terra, con 783 celdas-día en solo 2 meses vs 800 en los 12 meses de 2001), "
        "el conteo de Terra ya supera la mediana combinada `Terra+Aqua` ($M_{\\text{med}, 11} = 378$). "
        "Aplicando regularización por saturación ($\\gamma_{\\text{eff}} = 1.0$ cuando $T_{y,m} \\ge M_{\\text{med}, m}$), "
        "2000 (nov–dic) queda en **3,972.7** (sin inflación artificial) y 2001 completo en **20,613.9**."
    )
    lines.append("")
    lines.append("| Mes | $\\alpha_m$ (MODIS → 1-VIIRS) | Rango IQR $\\alpha_m$ | $\\beta_{2,m}$ (2 VIIRS) | $\\beta_{3,m}$ (3 VIIRS) | $\\gamma_{\\text{Terra},m}$ (Intra-MODIS) | $\\alpha_{\\text{FRP},m}$ |")
    lines.append("|---:|---:|---:|---:|---:|---:|---:|")
    for m in range(1, 13):
        a = factors["alpha_month"][m]
        p25 = factors["alpha_p25"][m]
        p75 = factors["alpha_p75"][m]
        b2 = factors["beta_constellation"][(2, m)]
        b3 = factors["beta_constellation"][(3, m)]
        gt = factors["gamma_terra_month"][m]
        af = factors["alpha_frp_month"][m]
        lines.append(
            f"| {m:02d} | {a:.3f} | [{p25:.3f}, {p75:.3f}] | {b2:.4f} | {b3:.4f} | {gt:.3f} | {af:.3f} |"
        )
    lines.append("")

    # 4. Validación Antes vs Después
    lines.append("## 4. Validación Científica (Antes vs. Después de Armonizar)")
    lines.append("")
    oos_m = validation_metrics["holdout_2021_2024_monthly"]
    oos_a = validation_metrics["holdout_2021_2024_annual"]
    ov_a = validation_metrics["overlap_2013_2025_annual"]

    lines.append(
        "Se realizó validación **fuera de muestra (holdout 2021–2024)** calibrando únicamente con 2012–2020 y evaluando "
        "la capacidad de MODIS para predecir la actividad equivalente de VIIRS en 2021–2024 (incluyendo la entrada de NOAA-21 en 2023):"
    )
    lines.append("")
    lines.append("| Escenario de Evaluación | Métrica | Antes: Conteos Crudos (MODIS vs VIIRS) | Intermedio: Celdas H3 Res 6 sin Calibrar | **Después: Serie Armonizada** |")
    lines.append("|---|---|---:|---:|---:|")
    lines.append(
        f"| Holdout 2021–2024 (Mensual) | MAPE (%) | {oos_m['before_raw_modis_vs_viirs']['mape_pct']:.2f}% | "
        f"{oos_m['before_unharmonized_cells']['mape_pct']:.2f}% | **{oos_m['after_harmonized_oos']['mape_pct']:.2f}%** |"
    )
    lines.append(
        f"| Holdout 2021–2024 (Mensual) | Sesgo (%) | {oos_m['before_raw_modis_vs_viirs']['bias_pct']:.2f}% | "
        f"{oos_m['before_unharmonized_cells']['bias_pct']:.2f}% | **{oos_m['after_harmonized_oos']['bias_pct']:.2f}%** |"
    )
    lines.append(
        f"| Holdout 2021–2024 (Mensual) | Correlación ($r$) | {oos_m['before_raw_modis_vs_viirs']['pearson_r']:.4f} | "
        f"{oos_m['before_unharmonized_cells']['pearson_r']:.4f} | **{oos_m['after_harmonized_oos']['pearson_r']:.4f}** |"
    )
    lines.append(
        f"| Holdout 2021–2024 (Anual) | MAPE (%) | {oos_a['before_raw_modis_vs_viirs']['mape_pct']:.2f}% | "
        f"{oos_a['before_unharmonized_cells']['mape_pct']:.2f}% | **{oos_a['after_harmonized_oos']['mape_pct']:.2f}%** |"
    )
    lines.append(
        f"| Solapamiento Completo 2013–2025 (Anual) | MAPE (%) | {ov_a['before_raw_modis_vs_viirs']['mape_pct']:.2f}% | "
        f"{ov_a['before_unharmonized_cells']['mape_pct']:.2f}% | **{ov_a['after_harmonized']['mape_pct']:.2f}%** |"
    )
    lines.append(
        f"| Solapamiento Completo 2013–2025 (Anual) | Sesgo (%) | {ov_a['before_raw_modis_vs_viirs']['bias_pct']:.2f}% | "
        f"{ov_a['before_unharmonized_cells']['bias_pct']:.2f}% | **{ov_a['after_harmonized']['bias_pct']:.2f}%** |"
    )
    lines.append("")

    # 5. Tabla comparativa anual 2000-2026
    lines.append("## 5. Serie Anual Comparativa (2000–2026): Crudo vs. Armonizado")
    lines.append("")
    lines.append(
        "Comprobación visual de continuidad entre regímenes de sensores: "
        "`2000` (parcial nov-dic), `2001` (completo solo Terra), `2011 → 2012` (inicio VIIRS S-NPP), `2017 → 2018` (entrada NOAA-20), `2022 → 2023` (entrada NOAA-21) y `2026` (parcial hasta 14-nov)."
    )
    lines.append("")
    lines.append(
        "| Año | `raw_modis` | `raw_viirs` | `cell_days_unharmonized` | `harmonized_fire_activity` | MODIS Calibrado (Validación) | `harmonized_frp` (MW) | Régimen / Notas |"
    )
    lines.append("|---:|---:|---:|---:|---:|---:|---:|---|")

    regime_notes = {
        2000: "Parcial (`is_partial_year=true`): Solo Terra (nov-dic 2000)",
        2001: "Solo Terra + `SENSOR_OUTAGE` jun-jul",
        2002: "Terra hasta jul-03; Terra+Aqua desde jul-04",
        2007: "MODIS Terra+Aqua + `SENSOR_OUTAGE` ago",
        2009: "MODIS Terra+Aqua + `SENSOR_OUTAGE` abr 21-22",
        2012: "Transición a VIIRS S-NPP (desde ene-20)",
        2018: "Entrada NOAA-20 (2 satélites VIIRS)",
        2023: "Entrada NOAA-21 (3 satélites VIIRS)",
        2025: "3 VIIRS (deriva orbital MODIS observada)",
        2026: "Parcial (`is_partial_year=true`): hasta 2026-11-14 (S-NPP hasta 2026-11-01)",
    }

    for rec in annual_records:
        y = rec["year"]
        note = regime_notes.get(
            y,
            "MODIS Terra+Aqua"
            if y < 2012
            else ("VIIRS 1-sat" if y < 2018 else ("VIIRS 2-sat" if y < 2023 else "VIIRS 3-sat")),
        )
        modis_cal_str = (
            f"{rec['modis_calibrated_activity']:,.0f}"
            if rec["modis_calibrated_activity"] > 0
            else "—"
        )
        lines.append(
            f"| {y} | {rec['raw_modis']:,} | {rec['raw_viirs']:,} | "
            f"{rec['cell_days_unharmonized']:,} | **{rec['harmonized_fire_activity']:,.1f}** | "
            f"{modis_cal_str} | {rec['harmonized_frp']:,.1f} | {note} |"
        )
    lines.append("")

    # 6. Control de calidad y limitaciones
    lines.append("## 6. Control de Calidad de Fechas (`SENSOR_OUTAGE`) y Limitaciones Declaradas")
    lines.append("")
    lines.append(
        f"- **Banderas `SENSOR_OUTAGE`:** Se marcaron **{outage_rows_flagged:,}** registros diarios MODIS en las ventanas documentadas de `readme data.txt`: "
        "`2001-06-14..2001-07-05` (20 días sin detecciones jun-jul 2001), `2007-08-15..2007-08-19` (corte 17 ago 2007) y `2009-04-20..2009-04-22` (corte parcial 21 abr y total 22 abr 2009)."
    )
    lines.append(
        "- **Banderas `is_partial_year`:** En `calendar_summary.json` se marcan explícitamente `2000` (solo nov–dic) y `2026` (hasta el 14 de noviembre) con `\"is_partial_year\": true`."
    )
    lines.append(
        "- **Enriquecimiento departamental:** Cada celda H3 Res 6 en `h3_spatial_grid.json` y `harmonized_fires.parquet` incluye su `department` (24 departamentos del Perú) y `natural_region` (`Costa`, `Sierra`, `Selva`)."
    )
    lines.append(
        "- **2025–2026 (Deriva orbital MODIS):** Durante 2025–2026, los conteos de MODIS (`raw_modis`: 7,419 en 2025 vs 19,147 en 2024) caen proporcionalmente más que VIIRS debido a la deriva orbital de fin de vida útil de Terra/Aqua; al emplear VIIRS normalizado como serie primaria desde 2012, la serie armonizada no sufre ese sesgo de degradación."
    )
    lines.append(
        "- **Interpretación física:** Un foco de calor (`Hotspot`) ni una `ActiveCellDay` equivalen a superficie quemada ni a número de incendios individuales; ausencia de detección puede deberse a cobertura nubosa o humo denso."
    )
    lines.append("")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    run_pipeline()
