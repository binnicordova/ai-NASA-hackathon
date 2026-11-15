"""Núcleo compartido: objetos de valor usados por todos los contextos. Sin dependencias externas."""

from __future__ import annotations

from dataclasses import dataclass
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


@dataclass(frozen=True)
class AreaOfInterest:
    """Zona elegida por el usuario: el país, un departamento o una caja dibujada o tecleada."""

    kind: Literal["country", "department", "bbox"]
    department: str | None = None
    bbox: BoundingBox | None = None

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

    @property
    def label(self) -> str:
        if self.kind == "department":
            return self.department or ""
        if self.kind == "bbox" and self.bbox:
            b = self.bbox
            return f"{b.south:.2f}, {b.west:.2f} → {b.north:.2f}, {b.east:.2f}"
        return "Perú"
