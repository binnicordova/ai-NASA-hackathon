"""Lugares oficiales con dirección propia: Perú, sus 25 departamentos, 196 provincias y 1 890 distritos (INEI).

Cada uno tiene su mapa (`/mapa/cusco/canchis`) y cada distrito, además, su ficha imprimible. Aquí se resuelve la
dirección legible al área y se arma lo que su página dice a los buscadores: el lugar, su temporada y la fecha.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from fire_calendar.calendar.domain import services as calendar_services
from fire_calendar.calendar.domain.ports import HarmonizedSeriesGateway
from fire_calendar.shared.kernel import AreaOfInterest

from ..interfaces.urls import slugify


@dataclass(frozen=True)
class Place:
    kind: str  # country | department | province | district
    key: str  # "" | nombre del departamento | código de provincia | ubigeo
    names: tuple[str, ...]  # de arriba abajo: departamento, provincia, distrito

    @property
    def slugs(self) -> tuple[str, ...]:
        return tuple(slugify(n) for n in self.names)

    @property
    def area(self) -> AreaOfInterest:
        if self.kind == "department":
            return AreaOfInterest.of_department(self.key)
        if self.kind == "province":
            return AreaOfInterest.of_province(self.key)
        if self.kind == "district":
            return AreaOfInterest.of_district(self.key)
        return AreaOfInterest.country()

    def web_area(self) -> dict:
        """El área con la forma que usa la web (`AreaOfInterest` en area-of-interest/domain/area.ts)."""
        if self.kind == "department":
            return {"kind": "department", "department": self.key}
        if self.kind == "province":
            return {"kind": "province", "code": self.key, "name": self.names[1], "department": self.names[0]}
        if self.kind == "district":
            return {"kind": "district", "ubigeo": self.key, "name": self.names[2], "department": self.names[0], "province": self.names[1]}
        return {"kind": "country"}

    @property
    def title(self) -> str:
        """"Sicuani (Canchis, Cusco)", "Canchis (Cusco)", "Cusco": como `placeTitle` en la web."""
        if not self.names:
            return ""
        top, *rest = reversed(self.names)
        return f"{top} ({', '.join(rest)})" if rest else top


COUNTRY = Place("country", "", ())


@dataclass(frozen=True)
class PlaceFacts:
    season: tuple[int, ...]  # meses de la temporada (los que concentran el fuego de un año típico)
    first_date: str
    last_date: str


class Places:
    def __init__(self, gateway: HarmonizedSeriesGateway) -> None:
        self._gateway = gateway
        self._all: list[Place] | None = None
        self._by_slugs: dict[tuple[str, ...], Place] = {}

    def all(self) -> list[Place]:
        if self._all is None:
            limits = self._gateway.limits() or {"departments": [], "provinces": [], "districts": []}
            places = [Place("department", d["name"], (d["name"],)) for d in limits["departments"]]
            places += [Place("province", p["code"], (p["department"], p["name"])) for p in limits["provinces"]]
            places += [Place("district", d["ubigeo"], (d["department"], d["province"], d["name"])) for d in limits["districts"]]
            self._all = places
            self._by_slugs = {p.slugs: p for p in places}
        return self._all

    def find(self, parts: tuple[str, ...]) -> Place | None:
        """El lugar de una dirección: acepta mayúsculas y tildes (la ruta canónica se decide afuera)."""
        self.all()
        return self._by_slugs.get(tuple(slugify(p) for p in parts))

    def facts(self, place: Place) -> PlaceFacts:
        first, last = self._gateway.date_span()
        return PlaceFacts(self._season(place, last), first, last)

    @lru_cache(maxsize=4096)
    def _season(self, place: Place, last_date: str) -> tuple[int, ...]:
        series = self._gateway.monthly_series(place.area)
        return tuple(calendar_services.peak_season(series).months)
