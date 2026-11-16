"""Modelo del contexto Calendario. Lenguaje ubicuo de docs/06-arquitectura-ddd.md."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from fire_calendar.shared.kernel import DateRange, YearMonth

# Primer año con Terra y Aqua completos: desde aquí la serie es fiable como referencia.
REFERENCE_START_YEAR = 2003
# Hasta este mes solo volaba Terra: la actividad se extrapola de muy pocas observaciones.
TERRA_ONLY_UNTIL = YearMonth(2002, 6)
# VIIRS empieza en 2012: antes la serie primaria es MODIS escalado y siempre lleva incertidumbre.
VIIRS_START_YEAR = 2012
# Una anomalía necesita historia suficiente para ser válida.
MIN_YEARS_FOR_ANOMALY = 10


class AnomalyCategory(str, Enum):
    """Lectura en palabras del percentil de un mes frente a su historia."""

    BELOW = "below"  # por debajo de lo habitual (percentil < 25)
    NORMAL = "normal"  # dentro de lo habitual (25 a 74)
    ABOVE = "above"  # por encima de lo habitual (75 a 89)
    WELL_ABOVE = "well_above"  # muy por encima de lo habitual (90 o más)


class Sensor(str, Enum):
    MODIS = "MODIS"
    VIIRS = "VIIRS"


@dataclass(frozen=True)
class MonthlyActivity:
    """Un mes de la serie armonizada para un área de interés."""

    period: YearMonth
    harmonized: float  # celdas-día activas en unidades equivalentes a un satélite VIIRS
    low: float
    high: float
    hotspots: int  # focos crudos, todos los sensores (no comparable entre años)
    events: int | None = None  # eventos de fuego estimados (buffer + disolución diaria)
    events_modis: int | None = None

    @property
    def primary_sensor(self) -> Sensor:
        return Sensor.MODIS if self.period.year < VIIRS_START_YEAR else Sensor.VIIRS

    @property
    def low_confidence(self) -> bool:
        return self.period <= TERRA_ONLY_UNTIL


@dataclass(frozen=True)
class HarmonizedSeries:
    """Serie armonizada mensual continua (sin huecos) de un área, de 2000 a hoy."""

    months: tuple[MonthlyActivity, ...]
    last_day: int  # día del mes de la última observación: el último mes suele estar incompleto

    def __post_init__(self) -> None:
        if not self.months:
            raise ValueError("Una serie armonizada no puede estar vacía")

    @property
    def first(self) -> MonthlyActivity:
        return self.months[0]

    @property
    def last(self) -> MonthlyActivity:
        return self.months[-1]

    @property
    def full_range(self) -> DateRange:
        return DateRange(self.first.period, self.last.period)

    def get(self, period: YearMonth) -> MonthlyActivity | None:
        offset = (period.year - self.first.period.year) * 12 + period.month - self.first.period.month
        return self.months[offset] if 0 <= offset < len(self.months) else None

    def within(self, date_range: DateRange) -> tuple[MonthlyActivity, ...]:
        return tuple(m for m in self.months if date_range.contains(m.period))

    def is_partial_year(self, year: int) -> bool:
        """El primer y el último año no cubren los doce meses: nunca se comparan como años completos."""
        if year == self.first.period.year and self.first.period.month > 1:
            return True
        return year == self.last.period.year

    @property
    def reference_years(self) -> range:
        """Años completos y fiables que forman la línea base (mediana, percentiles, frecuencia)."""
        return range(REFERENCE_START_YEAR, self.last.period.year)

    def reference_values(self, month: int) -> list[float]:
        years = self.reference_years
        return [m.harmonized for m in self.months if m.period.month == month and m.period.year in years]

    def is_month_to_date(self, period: YearMonth) -> bool:
        return period == self.last.period


@dataclass(frozen=True)
class HistoricalMedian:
    month: int
    median: float
    p10: float
    p90: float
    years: int


@dataclass(frozen=True)
class Anomaly:
    """Desviación de un mes frente a su mediana histórica."""

    period: YearMonth
    value: float
    median: float | None
    ratio: float | None
    percentile: int | None
    month_to_date_days: int | None  # si no es None, se compararon los mismos días del mes
    low_confidence: bool
    valid: bool  # False si no hay historia suficiente o la mediana es cero
    category: AnomalyCategory | None = None  # None si la anomalía no es válida


@dataclass(frozen=True)
class MonthFrequency:
    """Cuántos años de la referencia cayó un mes del calendario en cada nivel de actividad."""

    month: int
    counts: tuple[int, int, int, int]  # bajo, moderado, alto, muy alto
    years: int


@dataclass(frozen=True)
class ActivityLevels:
    thresholds: tuple[float, float, float]  # percentiles 50, 75 y 90 de los meses de referencia
    months: tuple[MonthFrequency, ...]


@dataclass(frozen=True)
class YearlyTotal:
    year: int
    harmonized: float
    low: float
    high: float
    hotspots: int
    events: int | None
    events_modis: int | None
    partial: bool
    rank: int | None  # posición entre los años completos; None si el año es parcial


@dataclass(frozen=True)
class PeakSeason:
    months: tuple[int, ...]
    share: float  # fracción de la actividad anual típica que concentran esos meses


@dataclass(frozen=True)
class RangeSummary:
    date_range: DateRange
    hotspots: int
    events: int | None
    events_modis: int | None
    harmonized: float
    mixes_sensor_eras: bool  # el rango cruza 2012: los conteos crudos no son comparables dentro de él


# --- Predicción de fuego: eventos por mes con un modelo de Poisson ---------------------------------------------

# Base de conteo: eventos de fuego de MODIS (Terra + Aqua). Es la única serie de eventos con la misma constelación
# todos los años desde 2003: los eventos con VIIRS crecen con cada satélite nuevo (2012, 2018, 2023) y mezclarlos
# inflaría la predicción.
FORECAST_SENSOR = "MODIS"
# Rango que se muestra: del percentil 10 al 90 de la distribución (80 % de los años deberían caer dentro).
FORECAST_RANGE = (0.10, 0.90)


@dataclass(frozen=True)
class MonthForecast:
    """Lo que cabe esperar en un mes del calendario, según los mismos meses de años anteriores."""

    month: int
    expected: float  # λ: media de eventos por año en ese mes
    p_any: float  # probabilidad de al menos un evento
    low: int  # percentil 10
    high: int  # percentil 90
    years: int
    years_with_events: int
    overdispersed: bool  # varianza > media: se usa Poisson-Gamma (binomial negativa) en vez de Poisson puro


@dataclass(frozen=True)
class UnitForecast:
    """Predicción mensual de un límite oficial (departamento, provincia o distrito)."""

    key: str  # nombre del departamento, código de provincia o ubigeo del distrito
    name: str
    parent: str  # jerarquía de arriba abajo: "Departamento" o "Departamento › Provincia"
    months: tuple[MonthForecast, ...]  # enero a diciembre


@dataclass(frozen=True)
class ForecastCheck:
    """Prueba fuera de muestra: el modelo ajustado con unos años contra lo que pasó en los siguientes."""

    train: tuple[int, int]
    test: tuple[int, int]
    cases: int  # unidades × meses × años de prueba
    brier: float  # error cuadrático de la probabilidad de al menos un evento (0 = perfecto)
    brier_reference: float  # el mismo error con una sola probabilidad para todo el Perú
    coverage: float  # fracción de casos que cayeron dentro del rango del 80 %
    poisson_coverage: float  # la misma fracción si el rango fuera Poisson puro
    dispersion: float  # mediana de varianza / media en los meses con fuego (1 = Poisson)

    @property
    def skill(self) -> float:
        """Mejora frente a la referencia: 0 = igual, 1 = perfecto."""
        return 1 - self.brier / self.brier_reference if self.brier_reference else 0.0


@dataclass(frozen=True)
class ForecastMap:
    level: str  # department | province | district
    years: tuple[int, int]
    units: tuple[UnitForecast, ...]
    check: ForecastCheck | None
