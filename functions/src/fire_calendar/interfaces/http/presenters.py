"""Traduce objetos del dominio al contrato JSON. Sin lógica de negocio."""

from __future__ import annotations

from fire_calendar.calendar.application.use_cases import BurnCalendar
from fire_calendar.calendar.domain.model import Anomaly
from fire_calendar.calendar.domain.ports import ActiveCell, DepartmentTotal
from fire_calendar.shared.kernel import AreaOfInterest

LEVEL_NAMES = ("low", "moderate", "high", "very_high")


def area_json(area: AreaOfInterest) -> dict:
    out: dict = {"kind": area.kind, "label": area.label}
    if area.department:
        out["department"] = area.department
    if area.bbox:
        out["bbox"] = [area.bbox.west, area.bbox.south, area.bbox.east, area.bbox.north]
    return out


def calendar_json(calendar: BurnCalendar) -> dict:
    series, summary = calendar.series, calendar.range_summary
    return {
        "area": area_json(calendar.area),
        "unit": "active cell-days, one-VIIRS-satellite equivalent",
        "lastDay": series.last_day,
        "referenceYears": [series.reference_years.start, series.reference_years.stop - 1],
        "range": {"from": str(calendar.date_range.start), "to": str(calendar.date_range.end), "months": calendar.date_range.months},
        "rangeSummary": {
            "hotspots": summary.hotspots,
            "events": summary.events,
            "eventsModis": summary.events_modis,
            "harmonized": round(summary.harmonized, 1),
            "mixesSensorEras": summary.mixes_sensor_eras,
        },
        "series": [
            {
                "year": m.period.year, "month": m.period.month,
                "harmonized": round(m.harmonized, 1), "low": round(m.low, 1), "high": round(m.high, 1),
                "hotspots": m.hotspots, "events": m.events, "eventsModis": m.events_modis,
                "sensor": m.primary_sensor.value, "lowConfidence": m.low_confidence,
            }
            for m in series.months
        ],
        "years": [
            {
                "year": y.year, "harmonized": round(y.harmonized, 1), "low": round(y.low, 1), "high": round(y.high, 1),
                "hotspots": y.hotspots, "events": y.events, "eventsModis": y.events_modis,
                "partial": y.partial, "rank": y.rank,
            }
            for y in calendar.years
        ],
        "medians": [
            {"month": m.month, "median": round(m.median, 1), "p10": round(m.p10, 1), "p90": round(m.p90, 1), "years": m.years}
            for m in calendar.medians
        ],
        "levels": {
            "names": list(LEVEL_NAMES),
            "thresholds": [round(t, 1) for t in calendar.levels.thresholds],
            "months": [{"month": f.month, "counts": list(f.counts), "years": f.years} for f in calendar.levels.months],
        },
        "peakSeason": {"months": list(calendar.peak_season.months), "share": round(calendar.peak_season.share, 3)},
    }


def anomaly_json(a: Anomaly) -> dict:
    return {
        "year": a.period.year, "month": a.period.month,
        "value": round(a.value, 1),
        "median": None if a.median is None else round(a.median, 1),
        "ratio": None if a.ratio is None else round(a.ratio, 2),
        "percentile": a.percentile,
        "monthToDateDays": a.month_to_date_days,
        "lowConfidence": a.low_confidence,
        "valid": a.valid,
        "category": a.category.value if a.category else None,
    }


SERIES_COLUMNS = (
    "year", "month", "in_selected_range", "harmonized_activity", "harmonized_low", "harmonized_high",
    "raw_hotspots", "fire_events", "fire_events_modis_only", "primary_sensor", "low_confidence",
    "historical_median", "ratio_to_median", "usual_range_p10", "usual_range_p90",
)


def series_rows(calendar: BurnCalendar):
    """El análisis en forma de tabla: la serie mensual con su mediana histórica y su razón."""
    medians = {m.month: m for m in calendar.medians}
    last = calendar.series.last.period
    for m in calendar.series.months:
        ref = medians[m.period.month]
        # El mes en curso está incompleto: su razón frente a meses completos no es comparable.
        ratio = round(m.harmonized / ref.median, 3) if ref.median > 0 and m.period != last else ""
        yield (
            m.period.year, m.period.month, calendar.date_range.contains(m.period),
            round(m.harmonized, 1), round(m.low, 1), round(m.high, 1), m.hotspots,
            "" if m.events is None else m.events, "" if m.events_modis is None else m.events_modis,
            m.primary_sensor.value, m.low_confidence, round(ref.median, 1), ratio, round(ref.p10, 1), round(ref.p90, 1),
        )


def cells_geojson(cells: list[ActiveCell]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": c.cell_id,
                "geometry": {"type": "Polygon", "coordinates": [[*c.boundary, c.boundary[0]]]},
                "properties": {
                    "department": c.department, "harmonized": round(c.harmonized, 2),
                    "hotspots": c.hotspots, "activeDays": c.active_days,
                },
            }
            for c in cells
        ],
    }


def ranking_json(rows: list[DepartmentTotal]) -> list[dict]:
    return [
        {"department": r.department, "harmonized": round(r.harmonized, 1), "hotspots": r.hotspots, "events": r.events}
        for r in rows
    ]
