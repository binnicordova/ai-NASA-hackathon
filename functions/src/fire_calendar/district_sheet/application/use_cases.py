"""Caso de uso de la ficha: arma lo que dicen el Calendario y la Alerta temprana de un distrito."""

from __future__ import annotations

from fire_calendar.calendar.application.use_cases import GetFireForecast
from fire_calendar.calendar.domain import services as calendar_services
from fire_calendar.calendar.domain.ports import HarmonizedSeriesGateway
from fire_calendar.shared.kernel import AreaOfInterest, DomainError

from ..domain import services
from ..domain.model import DistrictName, DistrictSheet


class GetDistrictSheet:
    def __init__(self, gateway: HarmonizedSeriesGateway, forecast: GetFireForecast) -> None:
        self._gateway = gateway
        self._forecast = forecast
        self._names: dict[str, DistrictName] | None = None

    def district(self, ubigeo: str) -> DistrictName:
        area = AreaOfInterest.of_district(ubigeo)  # valida el formato
        if self._names is None:
            limits = self._gateway.limits() or {"districts": []}
            self._names = {
                d["ubigeo"]: DistrictName(d["ubigeo"], d["name"], d["province"], d["department"]) for d in limits["districts"]
            }
        name = self._names.get(area.district or "")
        if name is None:
            raise LookupError(f"Distrito desconocido: {ubigeo}")
        return name

    def __call__(self, ubigeo: str) -> DistrictSheet:
        district = self.district(ubigeo)
        area = AreaOfInterest.of_district(district.ubigeo)
        series = self._gateway.monthly_series(area)
        last_date = self._gateway.date_span()[1]
        forecast = self._forecast.for_area(area)
        months = tuple(o.forecast for o in forecast.months)
        if len(months) != 12:
            raise DomainError("La predicción del distrito no tiene los doce meses")
        return DistrictSheet(
            district=district,
            series=series,
            peak_season=calendar_services.peak_season(series),
            forecast_year=int(last_date[:4]) + 1,
            watch=services.watch_months(months),
            last_date=last_date,
        )
