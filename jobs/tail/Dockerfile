# Job de la cola de datos nuevos (src/etl/firms_tail.py).
# Contexto de construcción: la raíz del repositorio (ver jobs/tail/cloudbuild.yaml).
FROM python:3.12-slim
WORKDIR /app
COPY jobs/tail/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/etl/*.py src/etl/
# Lo único que el job necesita de la base: factores congelados, corte y límites para recortar a Perú.
COPY data/processed/frozen_params.json data/processed/base_manifest.json data/processed/peru_limits.json data/processed/

RUN useradd --system --no-create-home app
USER app
ENV FIRE_DATA_DIR=/app/data/processed PYTHONUNBUFFERED=1
# FIRMS_MAP_KEY llega de Secret Manager y FIRE_TAIL_STORE (gs://bucket/prefijo) de la configuración del job.
CMD ["python", "src/etl/firms_tail.py"]
