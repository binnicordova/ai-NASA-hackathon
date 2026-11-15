# Un solo servicio: functions/ responde la API y sirve la web compilada.
# Pensado para Google Cloud Run (PORT lo fija la plataforma; 8080 por defecto).
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
WORKDIR /app
COPY functions/ functions/
RUN cd functions && uv sync --frozen --no-dev
COPY data/processed/ data/processed/
COPY --from=web /app/web/dist web/dist

# El servicio solo lee: los archivos quedan de root y el proceso corre sin privilegios.
RUN useradd --system --no-create-home app
USER app

ENV PORT=8080 \
    FIRE_DATA_DIR=/app/data/processed \
    FIRE_WEB_DIST=/app/web/dist \
    DUCKDB_MEMORY_LIMIT=1GB \
    PATH=/app/functions/.venv/bin:$PATH
EXPOSE 8080
# DuckDB vuelca a disco en ./.tmp cuando una exportación grande no cabe en memoria: carpeta con escritura.
WORKDIR /tmp
# Un solo worker: cada worker carga su propia copia de la serie en DuckDB.
CMD ["sh", "-c", "exec uvicorn --factory fire_calendar.interfaces.http.app:create_app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
