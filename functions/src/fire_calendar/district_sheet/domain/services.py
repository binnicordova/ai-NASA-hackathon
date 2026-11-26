"""Reglas de la ficha. `watch_months` es la misma regla que `watchMonths` en web/src/calendar/domain/watch.ts:
si cambia una, cambia la otra."""

from __future__ import annotations

from collections.abc import Sequence

from fire_calendar.calendar.domain.model import MonthForecast

from .model import WATCH_COUNT, WATCH_FLOOR


def watch_months(months: Sequence[MonthForecast], count: int = WATCH_COUNT) -> tuple[MonthForecast, ...]:
    """Los meses a vigilar: los `count` de más probabilidad de fuego (al menos WATCH_FLOOR), en orden de calendario."""
    likely = [m for m in months if m.p_any >= WATCH_FLOOR]
    top = sorted(likely, key=lambda m: (-m.p_any, m.month))[:count]
    return tuple(sorted(top, key=lambda m: m.month))
