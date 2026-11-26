"""La cola de datos nuevos vista desde la API: dónde está, cómo bajarla y cómo cambiarla en caliente.

El job `src/etl/firms_tail.py` publica en un almacén (Cloud Storage o una carpeta) tres parquets con los
días desde el corte y un `latest.json` que apunta a la versión vigente. Aquí se leen sin dependencias
extra: en Cloud Run el token sale del servidor de metadatos.
"""

from __future__ import annotations

import json
import shutil
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

TABLES = ("harmonized_fires", "fire_events", "hotspots_clean")
METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"


@dataclass(frozen=True)
class TailSnapshot:
    """Una versión de la cola ya descargada."""

    version: str
    cutoff: str
    directory: Path
    manifest: dict

    def file(self, table: str) -> Path:
        return self.directory / f"{table}.parquet"

    def describe(self) -> dict:
        m = self.manifest
        return {
            "version": self.version, "cutoff": self.cutoff, "generatedAt": m.get("generatedAt"),
            "lastDate": m.get("lastDate"), "lastObservation": m.get("lastObservation", {}),
            "warnings": m.get("warnings", []),
        }


class TailSource:
    """Lee `latest.json` y los parquets de una carpeta local o de `gs://bucket/prefijo`."""

    def __init__(self, uri: str, cache_dir: Path, token: Callable[[], str] | None = None) -> None:
        self._uri = uri
        self._cache = Path(cache_dir)
        self._token_fn = token or self._metadata_token
        self._token: tuple[str, float] | None = None
        if uri.startswith("gs://"):
            bucket, _, prefix = uri[5:].partition("/")
            self._bucket, self._prefix = bucket, prefix.strip("/")
        else:
            self._bucket = None
            self._root = Path(uri)

    # --- lectura ---------------------------------------------------------------

    def _metadata_token(self) -> str:
        import os

        if override := os.environ.get("FIRE_TAIL_TOKEN"):  # pruebas locales: gcloud auth print-access-token
            return override
        now = time.time()
        if self._token and now < self._token[1] - 60:
            return self._token[0]
        request = urllib.request.Request(METADATA_TOKEN, headers={"Metadata-Flavor": "Google"})
        with urllib.request.urlopen(request, timeout=5) as response:
            data = json.load(response)
        self._token = (data["access_token"], now + float(data["expires_in"]))
        return self._token[0]

    def read(self, name: str) -> bytes | None:
        if self._bucket is None:
            path = self._root / name
            return path.read_bytes() if path.exists() else None
        key = f"{self._prefix}/{name}" if self._prefix else name
        url = f"https://storage.googleapis.com/storage/v1/b/{self._bucket}/o/{urllib.parse.quote(key, safe='')}?alt=media"
        request = urllib.request.Request(url, headers={"Authorization": f"Bearer {self._token_fn()}"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None
            raise

    def latest(self) -> dict | None:
        raw = self.read("latest.json")
        return json.loads(raw) if raw else None

    def snapshot(self, manifest: dict | None = None) -> TailSnapshot | None:
        """Descarga (si hace falta) la versión vigente a la caché local. None si aún no hay cola."""
        manifest = manifest or self.latest()
        if manifest is None:
            return None
        version = manifest["version"]
        target = self._cache / f"tail-{version}"  # sin "=": DuckDB lo tomaría por una partición Hive
        if not all((target / f"{t}.parquet").exists() for t in TABLES):
            staging = self._cache / f"tail-{version}.partial"
            shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True)
            for table in TABLES:
                data = self.read(f"v={version}/{table}.parquet")
                if not data:
                    raise FileNotFoundError(f"la versión {version} no tiene {table}.parquet")
                (staging / f"{table}.parquet").write_bytes(data)
            shutil.rmtree(target, ignore_errors=True)
            staging.replace(target)
        self._prune_cache(keep={version})
        return TailSnapshot(version=version, cutoff=manifest["cutoff"], directory=target, manifest=manifest)

    def _prune_cache(self, keep: set[str]) -> None:
        """Deja la versión en uso y la anterior: un gateway viejo puede seguir atendiendo una descarga."""
        folders = sorted(p for p in self._cache.glob("tail-*") if p.is_dir() and not p.name.endswith(".partial"))
        for old in folders[:-2]:
            if old.name[len("tail-"):] not in keep:
                shutil.rmtree(old, ignore_errors=True)


class ReloadingGateway:
    """Delega en un gateway y lo cambia por otro nuevo cuando el job publicó una cola más reciente.

    No hay hilo de fondo: Cloud Run casi no da CPU entre peticiones, y un hilo así se quedaría a medias.
    Cada petición pregunta `refresh_due()`; a lo sumo cada `interval` segundos una de ellas (y solo una)
    ejecuta `refresh()` en su propio turno: lee `latest.json` y, si cambió, arma el gateway nuevo y lo
    intercambia. Las demás peticiones siguen con el gateway anterior. Las cachés viven en cada gateway,
    así que el cambio las invalida solas.
    """

    def __init__(self, build: Callable[[TailSnapshot | None], object], source: TailSource, *, interval: float = 120.0,
                 log: Callable[[str], None] = lambda message: print(message, flush=True)) -> None:
        self._build = build
        self._source = source
        self._interval = interval
        self._log = log
        self._busy = False
        self._claim = threading.Lock()
        self._checked = time.monotonic()
        snapshot = self._load()
        self._current = build(snapshot)
        self._version = snapshot.version if snapshot else None

    def _load(self) -> TailSnapshot | None:
        try:
            return self._source.snapshot()
        except Exception as exc:  # sin cola, la API sirve la base: mejor datos viejos que ninguno
            self._log(f"cola no disponible, se sirve solo la base: {type(exc).__name__}: {exc}")
            return None

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._current, name)

    @property
    def version(self) -> str | None:
        return self._version

    def refresh_due(self) -> bool:
        """True para una sola petición cada `interval` segundos: la que debe ejecutar `refresh()`."""
        with self._claim:
            if self._busy or time.monotonic() - self._checked < self._interval:
                return False
            self._busy = True
            self._checked = time.monotonic()
            return True

    def refresh(self) -> bool:
        """Mira si hay una versión nueva y, de haberla, cambia de gateway. True si cambió."""
        try:
            manifest = self._source.latest()
            if not manifest or manifest.get("version") == self._version:
                return False
            snapshot = self._source.snapshot(manifest)
            fresh = self._build(snapshot)
            self._current, self._version = fresh, snapshot.version
            self._log(f"cola actualizada: versión {snapshot.version}, último día {manifest.get('lastDate')}")
            return True
        except Exception as exc:
            self._log(f"no se pudo actualizar la cola: {type(exc).__name__}: {exc}")
            return False
        finally:
            self._busy = False
