"""Almacén de la cola: una carpeta local (pruebas) o un prefijo de Cloud Storage (producción).

Disposición bajo el prefijo:

    latest.json                 puntero a la versión vigente (se escribe al final)
    state.json                  ETag de los feeds públicos vistos en la última corrida
    v=<versión>/manifest.json   lo mismo que latest.json, congelado
    v=<versión>/*.parquet       harmonized_fires, fire_events, hotspots_clean (solo días >= corte)

Una versión se publica completa y recién entonces se mueve `latest.json`: quien lee nunca ve a medias.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol


class Store(Protocol):
    def read(self, name: str) -> bytes | None: ...
    def generation(self, name: str) -> int: ...
    def write(self, name: str, data: bytes, *, if_generation: int | None = None) -> None: ...
    def delete_prefix(self, prefix: str) -> None: ...
    def versions(self) -> list[str]: ...


class StoreConflict(RuntimeError):
    """Otra corrida movió el puntero mientras esta construía su versión."""


class LocalStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def read(self, name: str) -> bytes | None:
        path = self.root / name
        return path.read_bytes() if path.exists() else None

    def generation(self, name: str) -> int:
        path = self.root / name
        return path.stat().st_mtime_ns if path.exists() else 0

    def write(self, name: str, data: bytes, *, if_generation: int | None = None) -> None:
        path = self.root / name
        if if_generation is not None and self.generation(name) != if_generation:
            raise StoreConflict(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)

    def delete_prefix(self, prefix: str) -> None:
        target = self.root / prefix
        if target.is_dir():
            shutil.rmtree(target)

    def versions(self) -> list[str]:
        return sorted(p.name[2:] for p in self.root.glob("v=*") if p.is_dir())


class GcsStore:
    def __init__(self, bucket: str, prefix: str) -> None:
        from google.cloud import storage  # solo en la imagen del Job

        self._bucket = storage.Client().bucket(bucket)
        self._prefix = prefix.strip("/")

    def _key(self, name: str) -> str:
        return f"{self._prefix}/{name}" if self._prefix else name

    def read(self, name: str) -> bytes | None:
        blob = self._bucket.blob(self._key(name))
        return blob.download_as_bytes() if blob.exists() else None

    def generation(self, name: str) -> int:
        blob = self._bucket.get_blob(self._key(name))
        return int(blob.generation) if blob else 0

    def write(self, name: str, data: bytes, *, if_generation: int | None = None) -> None:
        from google.api_core.exceptions import PreconditionFailed

        blob = self._bucket.blob(self._key(name))
        kind = "application/json" if name.endswith(".json") else "application/octet-stream"
        try:
            blob.upload_from_string(data, content_type=kind, if_generation_match=if_generation)
        except PreconditionFailed as exc:
            raise StoreConflict(name) from exc

    def delete_prefix(self, prefix: str) -> None:
        for blob in self._bucket.list_blobs(prefix=self._key(prefix.rstrip("/") + "/")):
            blob.delete()

    def versions(self) -> list[str]:
        found = set()
        for blob in self._bucket.list_blobs(prefix=self._key("v="), delimiter=None):
            rest = blob.name[len(self._key("")):]
            found.add(rest.split("/", 1)[0][2:])
        return sorted(found)


def open_store(uri: str) -> Store:
    if uri.startswith("gs://"):
        bucket, _, prefix = uri[5:].partition("/")
        return GcsStore(bucket, prefix)
    return LocalStore(Path(uri))
