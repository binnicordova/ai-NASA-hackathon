"""Textos de la vista previa y de las etiquetas de la página compartida, en español y en inglés."""

from __future__ import annotations

MONTHS = {
    "es": ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
}
SHORT = {
    "es": ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"],
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
}
INITIALS = {"es": "EFMAMJJASOND", "en": "JFMAMJJASOND"}

TEXT = {
    "es": {
        "kicker": "NASAT.SPACE · FICHA DEL DISTRITO",
        "watch": "Meses a vigilar en {year}",
        "calm": "Fuego casi nulo todos los meses",
        "calendar": "Fuego armonizado por mes, {a}–{b}",
        "data": "Datos de NASA FIRMS hasta el {date}",
        "title": "Incendios en {name} ({province}, {department}): calendario y meses a vigilar",
        "share": "{name}: calendario de fuego y meses a vigilar",
        "desc.watch": "{place}: en {year}, vigila {months}. Calendario de focos de calor de NASA FIRMS desde 2000, hasta el {date}. Gratis y sin registro.",
        "desc.calm": "{place}: ningún mes con 5 % o más de probabilidad de fuego. Calendario de focos de calor de NASA FIRMS desde 2000, hasta el {date}. Gratis y sin registro.",
        "watch.lead": "Vigila {months}.",
        "watch.none": "Ningún mes llega al 5 % de probabilidad de fuego.",
        "nearby": "Más distritos de {province}",
        "dataset": "Incendios en {name} ({province}, {department}): calendario de focos de calor {a}–{b}",
        "country": "Perú",
        "map.title": "Incendios en {place}: calendario de quema y focos de calor · NASAT",
        "map.title.country": "NASAT · Calendario de quema",
        "map.desc": "Calendario de incendios de {place} con focos de calor de NASA FIRMS (MODIS y VIIRS armonizados), del {first} al {last}.{season} Mapa, predicción {year} y focos recientes, gratis y sin registro.",
        "map.desc.country": "Calendario de incendios del Perú con focos de calor de NASA FIRMS (MODIS y VIIRS armonizados), del {first} al {last}: mapa por departamento, provincia y distrito, predicción {year} y focos recientes, gratis y sin registro.",
        "map.season": " Temporada: {months}.",
        "and": " y ",
        "missing": "Distrito desconocido",
        "open": "Abrir la ficha",
    },
    "en": {
        "kicker": "NASAT.SPACE · DISTRICT SHEET",
        "watch": "Months to watch in {year}",
        "calm": "Near-zero chance of fire every month",
        "calendar": "Harmonized fire by month, {a}–{b}",
        "data": "NASA FIRMS data to {date}",
        "title": "Wildfires in {name} ({province}, {department}): fire calendar and months to watch",
        "share": "{name}: fire calendar and months to watch",
        "desc.watch": "{place}: in {year}, watch {months}. Calendar of NASA FIRMS hot spots since 2000, up to {date}. Free and with no sign-up.",
        "desc.calm": "{place}: no month with a 5 % or higher chance of fire. Calendar of NASA FIRMS hot spots since 2000, up to {date}. Free and with no sign-up.",
        "watch.lead": "Watch {months}.",
        "watch.none": "No month reaches a 5 % chance of fire.",
        "nearby": "More districts in {province}",
        "dataset": "Wildfires in {name} ({province}, {department}): hot spot calendar {a}–{b}",
        "country": "Peru",
        "map.title": "Wildfires in {place}: burn calendar and hot spots · NASAT",
        "map.title.country": "NASAT · Burn calendar",
        "map.desc": "Wildfire calendar for {place} from NASA FIRMS hot spots (harmonized MODIS and VIIRS), {first} to {last}.{season} Map, {year} forecast and recent hot spots, free and with no sign-up.",
        "map.desc.country": "Wildfire calendar for Peru from NASA FIRMS hot spots (harmonized MODIS and VIIRS), {first} to {last}: map by department, province and district, {year} forecast and recent hot spots, free and with no sign-up.",
        "map.season": " Season: {months}.",
        "and": " and ",
        "missing": "Unknown district",
        "open": "Open the sheet",
    },
}


def lang_of(value: str | None) -> str:
    return "en" if value == "en" else "es"


def day_label(iso: str, lang: str) -> str:
    """"26 nov 2026" / "26 Nov 2026"."""
    year, month, day = int(iso[:4]), int(iso[5:7]), int(iso[8:10])
    return f"{day} {SHORT[lang][month - 1]} {year}"


def percent(p: float) -> str:
    return f"{round(p * 100)} %"


def join(items: list[str], lang: str) -> str:
    """Como Intl.ListFormat en la web: "a, b y c" / "a, b, and c" (la ficha reescribe el mismo texto al cargar)."""
    if len(items) <= 1:
        return "".join(items)
    head = ", ".join(items[:-1])
    if lang == "en" and len(items) > 2:
        head += ","
    return head + TEXT[lang]["and"] + items[-1]
