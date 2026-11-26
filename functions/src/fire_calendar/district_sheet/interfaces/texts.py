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
        "title": "{name}: calendario de fuego y meses a vigilar",
        "desc.watch": "{parents}. En {year}, vigila {months}. Datos de NASA FIRMS hasta el {date}, gratis y sin registro.",
        "desc.calm": "{parents}. Ningún mes con 5 % o más de probabilidad de fuego. Datos de NASA FIRMS hasta el {date}, gratis y sin registro.",
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
        "title": "{name}: fire calendar and months to watch",
        "desc.watch": "{parents}. In {year}, watch {months}. NASA FIRMS data to {date}, free and with no sign-up.",
        "desc.calm": "{parents}. No month with a 5 % or higher chance of fire. NASA FIRMS data to {date}, free and with no sign-up.",
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
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + TEXT[lang]["and"] + items[-1]
