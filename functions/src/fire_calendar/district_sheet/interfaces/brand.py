"""Colores de la marca para lo que se dibuja en el servidor (la imagen de vista previa).

No se declaran aquí: se leen de la hoja de estilos de la web, la única que declara colores (`web/src/styles.css`
en el repositorio, o su versión compilada en `web/dist/assets/` dentro de la imagen de Cloud Run).
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

_DECLARATION = re.compile(r"--([a-z0-9-]+)\s*:\s*([^;}]+)")
_VAR = re.compile(r"var\(--([a-z0-9-]+)\)")


def _stylesheets(repo_root: Path, web_dist: Path) -> list[Path]:
    source = repo_root / "web" / "src" / "styles.css"
    built = sorted((web_dist / "assets").glob("*.css")) if (web_dist / "assets").exists() else []
    return ([source] if source.exists() else []) + built


@lru_cache(maxsize=4)
def brand_tokens(repo_root: Path, web_dist: Path) -> dict[str, str]:
    """Primera declaración de cada token (el tema claro de `:root`; la rampa de fuego es igual en los dos temas)."""
    for sheet in _stylesheets(repo_root, web_dist):
        tokens: dict[str, str] = {}
        for name, value in _DECLARATION.findall(sheet.read_text(encoding="utf-8")):
            tokens.setdefault(name, value.strip())
        if "fire-1" in tokens:
            return tokens
    raise FileNotFoundError("No se encontró la hoja de estilos de la web para leer los colores de la marca")


def color(tokens: dict[str, str], name: str) -> tuple[int, int, int]:
    """Un token como RGB, siguiendo `var(--otro)` hasta un color #rrggbb."""
    value = tokens[name]
    for _ in range(5):
        match = _VAR.fullmatch(value)
        if not match:
            break
        value = tokens[match.group(1)]
    hex_value = value.lstrip("#")
    if len(hex_value) == 3:
        hex_value = "".join(c * 2 for c in hex_value)
    return int(hex_value[0:2], 16), int(hex_value[2:4], 16), int(hex_value[4:6], 16)


def mix(a: tuple[int, int, int], b: tuple[int, int, int], share_a: float) -> tuple[int, int, int]:
    return tuple(round(x * share_a + y * (1 - share_a)) for x, y in zip(a, b))  # type: ignore[return-value]
