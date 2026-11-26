"""Pruebas de la cola de datos nuevos (sin red: la API de FIRMS se reemplaza por texto fabricado).

    uv run --with pytest --with pandas --with numpy --with scipy --with h3 --with pyarrow pytest src/etl/tests -q
"""

from __future__ import annotations

import http.client
import io
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import firms_tail as ft  # noqa: E402
import harmonize_firms as hf  # noqa: E402
from tail_store import LocalStore  # noqa: E402

VIIRS_HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight"
MODIS_HEADER = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight"
MADRE_DE_DIOS = (-8.717, -74.976)  # dentro de Perú y fuera de fuentes estáticas (Puerto Maldonado, -12.6/-69.2, sí es estática)
BOLIVIA = (-14.50, -63.00)  # dentro de la caja de la API, fuera del país


def viirs_row(day: str, lat: float, lon: float, conf: str = "n", sat: str = "N20", time_: str = "1803", frp: float = 3.1) -> str:
    return f"{lat},{lon},340.1,0.4,0.4,{day},{time_},{sat},VIIRS,{conf},2.0NRT,290.2,{frp},D"


def modis_row(day: str, lat: float, lon: float, conf: str = "80", sat: str = "Terra") -> str:
    return f"{lat},{lon},330.2,1.1,1.0,{day},1330,{sat},MODIS,{conf},6.1NRT,290.1,18.5,D"


def api_text(source: str, day: date, days: int) -> str:
    """Una API de mentira: cada día pedido trae focos de Perú, uno de baja confianza y uno de Bolivia."""
    header = MODIS_HEADER if source.startswith("MODIS") else VIIRS_HEADER
    rows = []
    for i in range(days):
        d = (day + timedelta(days=i)).isoformat()
        if source.startswith("MODIS"):
            rows += [modis_row(d, *MADRE_DE_DIOS), modis_row(d, *BOLIVIA)]
        else:
            sat = "N20" if "NOAA20" in source else "N21"
            rows += [
                viirs_row(d, MADRE_DE_DIOS[0], MADRE_DE_DIOS[1], sat=sat),
                viirs_row(d, MADRE_DE_DIOS[0] + 0.5, MADRE_DE_DIOS[1], sat=sat, conf="l"),
                viirs_row(d, BOLIVIA[0], BOLIVIA[1], sat=sat),
            ]
    return header + "\n" + "\n".join(rows) + "\n"


def fake_fetch(url: str) -> str:
    match = re.search(r"/api/area/csv/[^/]+/([A-Z0-9_]+)/[^/]+/(\d)/(\d{4}-\d{2}-\d{2})$", url)
    assert match, url
    return api_text(match.group(1), date.fromisoformat(match.group(3)), int(match.group(2)))


@pytest.fixture(scope="module")
def frozen():
    factors, static = hf.load_frozen_params(ft.DATA_DIR / "frozen_params.json")
    return factors, static, ft.peru_cells(ft.DATA_DIR / "peru_limits.json")


def test_frozen_params_round_trip_with_full_precision(frozen):
    factors, static, _ = frozen
    assert (2, 8) in factors["beta_constellation"] and 12 in factors["alpha_month"]
    assert len(static) == 1131
    summary = json.loads((ft.DATA_DIR / "calendar_summary.json").read_text())
    rounded = summary["calibration_factors"]["beta_constellation_viirs"]["k2_m1"]
    assert factors["beta_constellation"][(2, 1)] == pytest.approx(rounded, abs=5e-5)
    assert factors["beta_constellation"][(2, 1)] != rounded  # el JSON del resumen está redondeado; este no


def test_confidence_words_from_public_feeds_are_translated():
    raw = pd.read_csv(io.StringIO(VIIRS_HEADER + "\n" + "\n".join([
        viirs_row("2026-11-20", *MADRE_DE_DIOS, conf="low"),
        viirs_row("2026-11-20", *MADRE_DE_DIOS, conf="nominal", time_="1804"),
        viirs_row("2026-11-20", *MADRE_DE_DIOS, conf="high", time_="1805"),
    ])))
    std = ft.to_standard(raw, "J1V-C2", 0)
    assert list(std["confidence"]) == ["l", "n", "h"]
    assert (std["instrument"] == "VIIRS").all() and not std["is_archive"].any()


def test_clean_rows_drops_low_confidence_duplicates_and_foreign_points(frozen):
    _, static, cells = frozen
    rows = [
        viirs_row("2026-11-20", *MADRE_DE_DIOS),
        viirs_row("2026-11-20", *MADRE_DE_DIOS),  # duplicado exacto
        viirs_row("2026-11-20", MADRE_DE_DIOS[0] + 0.5, MADRE_DE_DIOS[1], conf="l"),  # confianza baja
        viirs_row("2026-11-20", *BOLIVIA),  # fuera de Perú
    ]
    raw = pd.read_csv(io.StringIO(VIIRS_HEADER + "\n" + "\n".join(rows)))
    clean = ft.clean_rows(ft.to_standard(raw, "J1V-C2", 0), static, cells)
    assert len(clean) == 1
    assert clean.iloc[0]["k_viirs"] == 2  # tras el fin de S-NPP quedan dos VIIRS
    assert clean.iloc[0]["h3_res6"] in cells


def test_static_sources_are_removed(frozen):
    _, static, cells = frozen
    import h3

    cell7 = sorted(static)[0]
    lat, lon = h3.cell_to_latlng(cell7)
    raw = pd.read_csv(io.StringIO(VIIRS_HEADER + "\n" + viirs_row("2026-11-20", lat, lon)))
    std = ft.to_standard(raw, "J1V-C2", 0)
    all_cells = frozenset({h3.cell_to_parent(cell7, 6)})  # que el recorte a Perú no sea lo que lo saque
    assert ft.clean_rows(std, static, all_cells).empty


def test_new_rows_have_the_same_schema_as_the_base(frozen):
    factors, static, cells = frozen
    raw = {p.source: pd.read_csv(io.StringIO(api_text(p.source, date(2026, 11, 20), 2))) for p in ft.PRODUCTS}
    new = ft.build_new_rows(raw, factors=factors, static_h3_res7=static, cells=cells)
    base = {n: pd.read_parquet(ft.DATA_DIR / f"{n}.parquet").head(5) for n in ft.TABLES}
    for name, table in new.tables().items():
        assert list(table.columns) == list(base[name].columns), name
        assert (table.dtypes.astype(str) == base[name].dtypes.astype(str)).all(), name
    h = new.harmonized_fires
    assert set(h["acq_date"]) == {"2026-11-20", "2026-11-21"}
    assert (h.loc[h["instrument"] == "VIIRS", "calibration_regime"] == "VIIRS_2SAT").all()
    assert h.loc[h["is_primary_series"], "harmonized_fire_activity"].gt(0).all()


def test_merge_replaces_days_from_start_and_keeps_older_ones(frozen):
    factors, static, cells = frozen
    raw = {p.source: pd.read_csv(io.StringIO(api_text(p.source, date(2026, 11, 20), 3))) for p in ft.PRODUCTS}
    first = ft.build_new_rows(raw, factors=factors, static_h3_res7=static, cells=cells)
    previous = ft.merge_tail(None, first, "2026-11-20")
    raw2 = {p.source: pd.read_csv(io.StringIO(api_text(p.source, date(2026, 11, 21), 3))) for p in ft.PRODUCTS}
    second = ft.build_new_rows(raw2, factors=factors, static_h3_res7=static, cells=cells)
    merged = ft.merge_tail(previous, second, "2026-11-21")
    days = sorted(merged["harmonized_fires"]["acq_date"].unique())
    assert days == ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23"]
    assert not merged["harmonized_fires"].duplicated(["h3_res6", "acq_date", "instrument"]).any()


def test_validation_refuses_to_publish_bad_tables(frozen):
    factors, static, cells = frozen
    raw = {p.source: pd.read_csv(io.StringIO(api_text(p.source, date(2026, 11, 20), 2))) for p in ft.PRODUCTS}
    tables = ft.merge_tail(None, ft.build_new_rows(raw, factors=factors, static_h3_res7=static, cells=cells), "2026-11-20")
    assert ft.validate(tables, cutoff="2026-11-12", previous_last="2026-11-21", today=date(2026, 11, 22)) == []
    with pytest.raises(ft.TailError, match="retrocede"):
        ft.validate(tables, cutoff="2026-11-12", previous_last="2026-11-25", today=None)
    with pytest.raises(ft.TailError, match="anteriores al corte"):
        ft.validate(tables, cutoff="2026-11-21", previous_last=None, today=None)
    with pytest.raises(ft.TailError, match="no llegan a hoy"):
        ft.validate(tables, cutoff="2026-11-12", previous_last=None, today=date(2026, 12, 15))
    dup = {**tables, "harmonized_fires": pd.concat([tables["harmonized_fires"]] * 2, ignore_index=True)}
    with pytest.raises(ft.TailError, match="duplicadas"):
        ft.validate(dup, cutoff="2026-11-12", previous_last=None, today=None)


def test_run_publishes_skips_when_feeds_are_unchanged_and_updates_when_they_change(tmp_path):
    store = LocalStore(tmp_path / "tail")
    window = lambda key: {p.source: ("2026-09-01", "2026-11-25") for p in ft.PRODUCTS}
    marks_a = {p.source: {"etag": "a", "lastModified": "x"} for p in ft.PRODUCTS}
    marks_b = {p.source: {"etag": "b", "lastModified": "y"} for p in ft.PRODUCTS}
    common = dict(key="KEY", fetch=fake_fetch, window=window)

    one = ft.run(store, now=datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc), marks=lambda: marks_a, **common)
    assert one["status"] == "published" and one["cutoff"] == "2026-11-12" and one["lastDate"] == "2026-11-21"
    latest = json.loads(store.read("latest.json"))
    assert latest["version"] == one["version"] == "20261121T120000Z"
    assert latest["lastObservation"].keys() == {"MODIS", "N20", "N21"}

    same = ft.run(store, now=datetime(2026, 11, 21, 12, 15, tzinfo=timezone.utc), marks=lambda: marks_a, **common)
    assert same["status"] == "unchanged"
    assert json.loads(store.read("latest.json"))["version"] == one["version"]

    two = ft.run(store, now=datetime(2026, 11, 23, 9, 0, tzinfo=timezone.utc), marks=lambda: marks_b, **common)
    assert two["status"] == "published" and two["lastDate"] == "2026-11-23"
    days = sorted(pd.read_parquet(tmp_path / "tail" / f"v={two['version']}" / "harmonized_fires.parquet")["acq_date"].unique())
    assert days[0] == "2026-11-12" and days[-1] == "2026-11-23" and len(days) == len(set(days))
    assert store.versions() == [one["version"], two["version"]]


def test_run_refuses_when_the_nrt_window_no_longer_reaches_the_cutoff(tmp_path):
    store = LocalStore(tmp_path / "tail")
    window = lambda key: {p.source: ("2026-11-15", "2026-11-25") for p in ft.PRODUCTS}
    with pytest.raises(ft.TailError, match="restituir"):
        ft.run(store, key="KEY", fetch=fake_fetch, window=window, marks=lambda: {},
               now=datetime(2026, 11, 21, tzinfo=timezone.utc))
    assert store.read("latest.json") is None


def test_errors_never_print_the_key():
    with pytest.raises(ft.TailError) as err:
        ft.fetch_raw(ft.PRODUCTS[0], date(2026, 11, 20), date(2026, 11, 20), "SECRETKEY", lambda url: "Invalid MAP_KEY")
    assert "SECRETKEY" not in str(err.value)


def test_main_refuses_a_malformed_key_without_printing_it(monkeypatch, capsys, tmp_path):
    bad = 'export AWS_SECRET="no-es-una-clave"'
    monkeypatch.setenv("FIRMS_MAP_KEY", bad)
    monkeypatch.setattr(sys, "argv", ["firms_tail.py", "--store", str(tmp_path)])
    assert ft.main() == 2
    out = capsys.readouterr().out
    assert "formato" in out and "AWS_SECRET" not in out and "no-es-una-clave" not in out


def test_unexpected_errors_are_reported_without_the_key(monkeypatch, capsys, tmp_path):
    key = "0123456789abcdef0123456789abcdef"
    monkeypatch.setenv("FIRMS_MAP_KEY", key)
    monkeypatch.setattr(sys, "argv", ["firms_tail.py", "--store", str(tmp_path)])

    def boom(*args, **kwargs):
        raise ValueError(f"URL rota: /api/area/csv/{key}/MODIS_NRT")

    monkeypatch.setattr(ft, "run", boom)
    assert ft.main() == 1
    out = capsys.readouterr().out
    assert key not in out and "<MAP_KEY>" in out and "ValueError" in out


def test_http_failures_do_not_leak_the_key_in_the_url(monkeypatch):
    key = "0123456789abcdef0123456789abcdef"

    def broken(request, timeout=None):
        raise http.client.InvalidURL(f"URL rota: {request.full_url}")

    monkeypatch.setattr(urllib.request, "urlopen", broken)
    monkeypatch.setattr(ft.time, "sleep", lambda s: None)
    with pytest.raises(ft.TailError) as err:
        ft.http(f"{ft.FIRMS}/api/data_availability/csv/{key}/ALL", secret=key)
    assert key not in str(err.value) and "InvalidURL" in str(err.value)
