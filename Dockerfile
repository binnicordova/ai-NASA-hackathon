# Un solo servicio: functions/ responde la API y sirve la web compilada.
# No probado todavía en un contenedor; ver README.md para la ejecución local verificada.
FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
RUN pip install --no-cache-dir uv
WORKDIR /app
COPY functions/ functions/
RUN cd functions && uv sync --no-dev
COPY data/processed/ data/processed/
COPY --from=web /app/web/dist web/dist
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "cd functions && uv run --no-dev uvicorn --factory fire_calendar.interfaces.http.app:create_app --host 0.0.0.0 --port ${PORT}"]
