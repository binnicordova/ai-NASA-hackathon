"""Imagen de vista previa (1200 × 630) de la ficha de un distrito: la que WhatsApp, LinkedIn o un correo muestran
al pegar el enlace corto. Lleva el nombre, los meses a vigilar y el calendario año × mes, para que el grupo vea su
temporada de fuego antes de abrir nada."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..domain.model import DistrictSheet
from .brand import color, mix
from .texts import INITIALS, SHORT, TEXT, day_label, percent

WIDTH, HEIGHT = 1200, 630
FONTS = Path(__file__).with_name("fonts")
# Los mismos cortes por cuantiles que `quantileBreaks` en web/src/shared/palette.ts.
QUANTILES = (0.3, 0.5, 0.7, 0.85, 0.95)
# Paso de la rampa por nivel de probabilidad: el mismo que LEVEL_STEP en web/src/calendar/ui/riskPanel.ts.
LEVEL_STEP = ((0.67, 6), (0.33, 4), (0.05, 2))


def _font(name: str, size: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONTS / name), size)
    if weight is not None:
        font.set_variation_by_axes([weight])
    return font


def _breaks(values: list[float]) -> list[float]:
    ordered = sorted(values)
    return [ordered[int(q * (len(ordered) - 1))] if ordered else 0.0 for q in QUANTILES]


def _ramp_index(value: float, breaks: list[float]) -> int:
    index = 0
    while index < len(breaks) and value > breaks[index]:
        index += 1
    return index


def _fit(draw: ImageDraw.ImageDraw, text: str, name: str, size: int, width: int, weight: int | None = None) -> ImageFont.FreeTypeFont:
    """La letra más grande (hasta `size`) con la que el texto cabe en `width`."""
    while size > 18:
        font = _font(name, size, weight)
        if draw.textlength(text, font=font) <= width:
            return font
        size -= 4
    return _font(name, size, weight)


def render_preview(sheet: DistrictSheet, tokens: dict[str, str], lang: str, short_url: str) -> bytes:
    text = TEXT[lang]
    ground = color(tokens, "deep-blue")
    white = color(tokens, "white")
    accent = color(tokens, "neon-yellow")
    dim = mix(white, ground, 0.72)
    faint = mix(white, ground, 0.12)
    ramp = [color(tokens, f"fire-{step}") for step in range(1, 7)]
    ink = [color(tokens, f"fire-ink-{step}") for step in range(1, 7)]

    image = Image.new("RGB", (WIDTH, HEIGHT), ground)
    draw = ImageDraw.Draw(image)
    left, top, column = 64, 58, 640

    draw.text((left, top), text["kicker"], font=_font("FiraSans-Bold.ttf", 24), fill=accent)
    name_font = _fit(draw, sheet.district.name, "FiraSans-Bold.ttf", 96, column)
    draw.text((left, top + 40), sheet.district.name, font=name_font, fill=white)
    draw.text((left, top + 160), sheet.district.parents, font=_font("Overpass.ttf", 34, 400), fill=dim)

    # Meses a vigilar: una pastilla por mes, del color de su nivel de probabilidad (como las barras de la web).
    y = top + 250
    if sheet.watch:
        draw.text((left, y), text["watch"].format(year=sheet.forecast_year), font=_font("Overpass.ttf", 30, 700), fill=white)
        x, pill_font = left, _font("FiraSans-Bold.ttf", 38)
        for month in sheet.watch:
            step = next(s for floor, s in LEVEL_STEP if month.p_any >= floor)
            label = f"{SHORT[lang][month.month - 1]} {percent(month.p_any)}"
            width = draw.textlength(label, font=pill_font) + 40
            draw.rounded_rectangle((x, y + 50, x + width, y + 120), radius=35, fill=ramp[step - 1])
            draw.text((x + 20, y + 85), label, font=pill_font, fill=ink[step - 1], anchor="lm")
            x += width + 16
    else:
        draw.text((left, y), text["calm"], font=_font("Overpass.ttf", 30, 700), fill=white)

    footer = _font("Overpass.ttf", 24, 400)
    draw.text((left, HEIGHT - 110), text["data"].format(date=day_label(sheet.last_date, lang)), font=footer, fill=dim)
    draw.text((left, HEIGHT - 76), short_url, font=_fit(draw, short_url, "Overpass.ttf", 26, WIDTH - left - 420, 700), fill=accent)

    # Calendario año × mes, con la rampa de la web: cada fila un año, cada columna un mes.
    months = sheet.series.months
    first, last = months[0].period.year, months[-1].period.year
    values = {(m.period.year, m.period.month): m.harmonized for m in months}
    # Cuantiles solo de los meses con fuego, como la ficha (`sheetBreaks`): los meses sin fuego van aparte.
    breaks = _breaks([m.harmonized for m in months if m.harmonized > 0])
    small = _font("Overpass.ttf", 17, 400)
    grid_left, grid_top, grid_bottom = 790, 104, HEIGHT - 58
    rows = last - first + 1
    cell_w, gap = 26, 3
    cell_h = (grid_bottom - grid_top - 6) / rows - gap
    draw.text((grid_left - 46, top - 4), text["calendar"].format(a=first, b=last), font=_font("Overpass.ttf", 20, 700), fill=dim)
    for col, initial in enumerate(INITIALS[lang]):
        draw.text((grid_left + col * (cell_w + gap) + cell_w / 2, grid_top - 8), initial, font=small, fill=dim, anchor="ms")
    for row, year in enumerate(range(first, last + 1)):
        y0 = grid_top + row * (cell_h + gap) + (6 if year >= 2012 else 0)  # hueco: desde 2012 mira VIIRS
        # Cada cinco años, más el primero y el último (sin pisar la etiqueta del último).
        if year in (first, last) or (year % 5 == 0 and last - year > 1 and year - first > 1):
            draw.text((grid_left - 10, y0 + cell_h / 2), str(year), font=small, fill=dim, anchor="rm")
        for month in range(1, 13):
            value = values.get((year, month))
            if value is None:
                continue
            x0 = grid_left + (month - 1) * (cell_w + gap)
            fill = ramp[_ramp_index(value, breaks)] if value > 0 else faint
            draw.rectangle((x0, y0, x0 + cell_w, y0 + cell_h), fill=fill)

    out = io.BytesIO()
    image.save(out, format="PNG", optimize=True)
    return out.getvalue()
