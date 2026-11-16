"""Núcleo compartido: objetos de valor usados por todos los contextos. Sin dependencias externas."""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal


class DomainError(ValueError):
    """Entrada que viola una regla del dominio. La capa de interfaz la traduce a un 400."""


@dataclass(frozen=True, order=True)
class YearMonth:
    year: int
    month: int

    def __post_init__(self) -> None:
        if not 1 <= self.month <= 12:
            raise DomainError(f"Mes inválido: {self.month}")
        if not 1900 <= self.year <= 2200:
            raise DomainError(f"Año inválido: {self.year}")

    @classmethod
    def parse(cls, text: str) -> "YearMonth":
        try:
            year, month = text.strip().split("-")[:2]
            return cls(int(year), int(month))
        except (ValueError, AttributeError) as exc:
            raise DomainError(f"Fecha inválida, se espera AAAA-MM: {text!r}") from exc

    def __str__(self) -> str:
        return f"{self.year:04d}-{self.month:02d}"


@dataclass(frozen=True)
class DateRange:
    """Rango de meses, ambos extremos incluidos."""

    start: YearMonth
    end: YearMonth

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise DomainError("El inicio del rango es posterior al fin")

    def contains(self, period: YearMonth) -> bool:
        return self.start <= period <= self.end

    @property
    def months(self) -> int:
        return (self.end.year - self.start.year) * 12 + self.end.month - self.start.month + 1


def _parse_day(text: str, end_of_period: bool) -> date:
    """`AAAA-MM-DD` es ese día; `AAAA-MM` es el primer día del mes (o el último, si cierra el rango)."""
    text = text.strip()
    try:
        if len(text) == 7:
            ym = YearMonth.parse(text)
            day = calendar.monthrange(ym.year, ym.month)[1] if end_of_period else 1
            return date(ym.year, ym.month, day)
        return date.fromisoformat(text)
    except (ValueError, DomainError) as exc:
        raise DomainError(f"Fecha inválida, se espera AAAA-MM-DD o AAAA-MM: {text!r}") from exc


@dataclass(frozen=True)
class DayRange:
    """Rango de días, ambos extremos incluidos. Es la precisión del mapa, de los focos y de las descargas."""

    start: date
    end: date

    def __post_init__(self) -> None:
        if self.start > self.end:
            raise DomainError("El inicio del rango es posterior al fin")

    @classmethod
    def parse(cls, start: str | None, end: str | None, first: date, last: date) -> "DayRange":
        """Lee el rango pedido y lo recorta a los datos disponibles [first, last]."""
        s = max(_parse_day(start, False) if start else first, first)
        e = min(_parse_day(end, True) if end else last, last)
        if s > e:
            raise DomainError("El rango pedido queda fuera de los datos disponibles")
        return cls(s, e)

    @classmethod
    def of_month(cls, period: YearMonth) -> "DayRange":
        return cls(date(period.year, period.month, 1), date(period.year, period.month, calendar.monthrange(period.year, period.month)[1]))

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def __str__(self) -> str:
        return f"{self.start.isoformat()}_{self.end.isoformat()}"


@dataclass(frozen=True)
class BoundingBox:
    """Caja geográfica en grados decimales (WGS84)."""

    west: float
    south: float
    east: float
    north: float

    def __post_init__(self) -> None:
        if not (-180 <= self.west < self.east <= 180):
            raise DomainError("Longitudes inválidas: se espera oeste < este, entre -180 y 180")
        if not (-90 <= self.south < self.north <= 90):
            raise DomainError("Latitudes inválidas: se espera sur < norte, entre -90 y 90")

    @classmethod
    def parse(cls, text: str) -> "BoundingBox":
        try:
            west, south, east, north = (float(part) for part in text.split(","))
        except ValueError as exc:
            raise DomainError("Caja inválida, se espera oeste,sur,este,norte") from exc
        return cls(west, south, east, north)


MAX_POLYGON_VERTICES = 500


def parse_polygon(text: str) -> tuple[tuple[float, float], ...]:
    """`lon,lat;lon,lat;...` → anillo de vértices (lon, lat). Se cierra solo; al menos 3 vértices distintos."""
    try:
        ring = tuple((float(lon), float(lat)) for lon, lat in (pair.split(",") for pair in text.strip().strip(";").split(";")))
    except ValueError as exc:
        raise DomainError("Polígono inválido, se espera lon,lat;lon,lat;...") from exc
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if len(set(ring)) < 3:
        raise DomainError("Un polígono necesita al menos 3 vértices")
    if len(ring) > MAX_POLYGON_VERTICES:
        raise DomainError(f"El polígono tiene más de {MAX_POLYGON_VERTICES} vértices")
    if not all(-180 <= lon <= 180 and -90 <= lat <= 90 for lon, lat in ring):
        raise DomainError("Coordenadas del polígono fuera de rango")
    return ring


@dataclass(frozen=True)
class AreaOfInterest:
    """Zona elegida por el usuario: el país, un departamento, un distrito (ubigeo), una caja o un polígono dibujado."""

    kind: Literal["country", "department", "district", "bbox", "polygon"]
    department: str | None = None
    bbox: BoundingBox | None = None
    district: str | None = None
    polygon: tuple[tuple[float, float], ...] | None = None

    @classmethod
    def country(cls) -> "AreaOfInterest":
        return cls("country")

    @classmethod
    def of_department(cls, name: str) -> "AreaOfInterest":
        if not name.strip():
            raise DomainError("Departamento vacío")
        return cls("department", department=name.strip())

    @classmethod
    def of_bbox(cls, bbox: BoundingBox) -> "AreaOfInterest":
        return cls("bbox", bbox=bbox)

    @classmethod
    def of_district(cls, ubigeo: str) -> "AreaOfInterest":
        ubigeo = ubigeo.strip()
        if not (len(ubigeo) == 6 and ubigeo.isdigit()):
            raise DomainError("Ubigeo de distrito inválido: se esperan 6 dígitos")
        return cls("district", district=ubigeo)

    @classmethod
    def of_polygon(cls, ring: tuple[tuple[float, float], ...]) -> "AreaOfInterest":
        return cls("polygon", polygon=ring)

    @property
    def label(self) -> str:
        if self.kind == "department":
            return self.department or ""
        if self.kind == "bbox" and self.bbox:
            b = self.bbox
            return f"{b.south:.2f}, {b.west:.2f} → {b.north:.2f}, {b.east:.2f}"
        if self.kind == "district":
            return f"Distrito {self.district}"
        if self.kind == "polygon" and self.polygon:
            return f"Polígono de {len(self.polygon)} vértices"
        return "Perú"
