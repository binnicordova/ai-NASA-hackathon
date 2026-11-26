"""Reglas del dominio: no necesitan datos ni infraestructura."""

import pytest

from fire_calendar.calendar.domain import services
from fire_calendar.calendar.domain.model import HarmonizedSeries, MonthlyActivity, Sensor
from fire_calendar.shared.kernel import AreaOfInterest, BoundingBox, DateRange, DomainError, YearMonth

SEASON = [1, 1, 1, 2, 4, 9, 20, 55, 72, 40, 13, 3]


def make_series(first=(2000, 11), last=(2026, 11), last_day=14, scale=lambda year: 1.0) -> HarmonizedSeries:
    months, (year, month) = [], first
    while (year, month) <= last:
        value = SEASON[month - 1] * scale(year)
        months.append(MonthlyActivity(YearMonth(year, month), value, value * 0.9, value * 1.1, int(value * 3), 10, 4))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return HarmonizedSeries(tuple(months), last_day)


def test_year_month_and_ranges_reject_bad_input():
    assert str(YearMonth.parse("2024-09")) == "2024-09"
    for bad in ("2024-13", "septiembre", ""):
        with pytest.raises(DomainError):
            YearMonth.parse(bad)
    with pytest.raises(DomainError):
        DateRange(YearMonth(2024, 5), YearMonth(2024, 4))
    assert DateRange(YearMonth(2023, 11), YearMonth(2024, 2)).months == 4


def test_bounding_box_must_be_ordered_and_on_earth():
    assert BoundingBox.parse("-73.98,-15.46,-70.35,-11.22").north == -11.22
    for bad in ("-70,-15,-73,-11", "-73,-11,-70,-15", "-200,0,10,10", "a,b,c,d", "1,2,3"):
        with pytest.raises(DomainError):
            BoundingBox.parse(bad)
    assert AreaOfInterest.of_department(" Cusco ").department == "Cusco"


def test_primary_sensor_and_low_confidence_follow_the_mission_calendar():
    series = make_series()
    assert series.get(YearMonth(2011, 12)).primary_sensor is Sensor.MODIS
    assert series.get(YearMonth(2012, 1)).primary_sensor is Sensor.VIIRS
    assert series.get(YearMonth(2002, 6)).low_confidence
    assert not series.get(YearMonth(2002, 7)).low_confidence


def test_first_and_last_years_are_partial_and_never_ranked():
    series = make_series(scale=lambda year: 5.0 if year in (2000, 2026) else 1.0 + (year == 2010))
    years = {y.year: y for y in services.yearly_totals(series)}
    assert years[2000].partial and years[2026].partial
    assert years[2000].rank is None and years[2026].rank is None
    assert years[2010].rank == 1 and not years[2010].partial
    assert list(series.reference_years) == list(range(2003, 2026))


def test_anomaly_of_a_normal_month_is_one():
    a = services.anomaly(make_series(), YearMonth(2020, 9))
    assert a.valid and a.ratio == pytest.approx(1.0) and a.month_to_date_days is None


def test_current_month_is_compared_like_for_like():
    series = make_series()
    # Mes en curso incompleto: 14 días. Con meses completos parecería muy por debajo de lo normal.
    naive = services.anomaly(series, YearMonth(2026, 11))
    assert naive.ratio == pytest.approx(1.0)  # la serie sintética ya trae el mes completo
    to_date = {year: 6.0 for year in range(2003, 2026)} | {2026: 9.0}
    fair = services.anomaly(series, YearMonth(2026, 11), to_date)
    assert fair.month_to_date_days == 14
    assert fair.value == 9.0 and fair.median == 6.0 and fair.ratio == pytest.approx(1.5)
    assert fair.percentile == 100


def test_anomaly_needs_enough_history():
    short = make_series(first=(2018, 1), last=(2026, 11))
    assert not services.anomaly(short, YearMonth(2024, 9)).valid


def test_frequency_puts_the_fire_season_in_the_high_levels():
    levels = services.activity_levels(make_series())
    september, march = levels.months[8], levels.months[2]
    assert september.years == 23 and september.counts[3] == 23
    assert march.counts[0] == 23
    assert sum(september.counts) == september.years


def test_peak_season_and_range_summary():
    series = make_series()
    peak = services.peak_season(series)
    assert peak.months == (8, 9, 10) and peak.share >= 0.66
    crossing = services.range_summary(series, DateRange(YearMonth(2010, 1), YearMonth(2013, 12)))
    assert crossing.mixes_sensor_eras and crossing.events == 48 * 10
    assert not services.range_summary(series, DateRange(YearMonth(2020, 1), YearMonth(2020, 12))).mixes_sensor_eras


def test_verdict_follows_the_percentile():
    from fire_calendar.calendar.domain.model import AnomalyCategory

    assert [services.categorize(p) for p in (0, 24, 25, 74, 75, 89, 90, 100)] == [
        AnomalyCategory.BELOW, AnomalyCategory.BELOW, AnomalyCategory.NORMAL, AnomalyCategory.NORMAL,
        AnomalyCategory.ABOVE, AnomalyCategory.ABOVE, AnomalyCategory.WELL_ABOVE, AnomalyCategory.WELL_ABOVE,
    ]
    assert services.anomaly(make_series(first=(2018, 1)), YearMonth(2024, 9)).category is None


def test_month_outlook_says_how_many_if_there_is_fire():
    # Fuego en la mitad de los años, de 1 o 2 eventos: el rango incluye el cero y, si hay fuego, son 1 o 2.
    outlook = services.month_outlook([0, 1, 0, 2, 0, 1, 0, 1, 0, 2, 1, 0], 8)
    assert outlook.forecast.low == 0 and outlook.if_any == (1, 2)
    assert outlook.history[3] == 2 and outlook.in_range == sum(1 for c in outlook.history if c <= outlook.forecast.high)
    # Sin fuego nunca: probabilidad 0 y nada que contar.
    quiet = services.month_outlook([0] * 23, 1)
    assert quiet.forecast.p_any == 0 and quiet.if_any == (0, 0) and quiet.in_range == 23


def test_forecast_check_reports_calibration_by_band():
    # Una unidad con fuego todos los agostos y nunca en enero: lo que dijo y lo que pasó coinciden por franja.
    counts = {(y, 8): 5 for y in range(2003, 2026)}
    check = services.forecast_check({"a": counts}, ["a"], (2003, 2020), (2021, 2025))
    high, none = check.bands[0], check.bands[-1]
    assert high.floor == 0.67 and high.cases == 5 and high.observed == 1
    assert none.floor == 0.0 and none.cases == 55 and none.observed == 0
    assert check.inside == 60
