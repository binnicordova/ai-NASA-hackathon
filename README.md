# Calendario de quema · Perú

Proyecto del reto **Harmonization of MODIS and VIIRS Hot Spots** (NASA Space Apps Challenge 2026).
Aplicación web con un calendario de actividad de quema sobre focos de calor de MODIS y VIIRS armonizados (NASA FIRMS), para el área y el rango de fechas que elige el usuario.

```
web/  ──►  functions/  ──►  data/  ◄──  src/etl/  ◄──  FIRMS
```

| Carpeta | Qué es |
|---|---|
| `data/` | Archivos de FIRMS y `data/processed/harmonized_fires.parquet` (serie armonizada) |
| `src/etl/` | `harmonize_firms.py` (armonización y validación) y `fire_events.py` (eventos de fuego por buffer y disolución diaria) |
| `functions/` | Servicios headless (Python, DuckDB, FastAPI): JSON y CSV para cualquier cliente |
| `web/` | Aplicación (Vite, TypeScript, Leaflet). Solo habla con `functions/` |
| `docs/` | Análisis del reto, método y arquitectura ([docs/06-arquitectura-ddd.md](docs/06-arquitectura-ddd.md)) |

## Ejecutar

Requisitos: [uv](https://docs.astral.sh/uv/) y Node 20 o superior.

Todo en un solo servidor (la API sirve también la web compilada):

```bash
npm --prefix web install && npm --prefix web run build
```

```bash
cd functions && uv run uvicorn --factory fire_calendar.interfaces.http.app:create_app --port 8000
```

Abrir <http://localhost:8000>. La API queda en `/api/v1` y su documentación en `/api/docs`.

Para desarrollar la web con recarga automática, dejar la API en el puerto 8000 y en otra terminal:

```bash
npm --prefix web run dev
```

## Pruebas

```bash
cd functions && uv run pytest
```

```bash
npm --prefix web run typecheck
```

Las pruebas de `functions/` cubren las reglas del dominio y la API contra el parquet real.

## Regenerar los datos

```bash
uv run --with pandas --with numpy --with h3 --with pyarrow python src/etl/harmonize_firms.py
```

```bash
uv run --with pandas --with numpy --with scipy --with h3 --with pyarrow python src/etl/fire_events.py
```

`fire_events.py` escribe `fire_events.parquet` (eventos de fuego) y `hotspots_clean.parquet` (focos limpios, uno por fila, para la descarga CSV de focos). Ambos son opcionales: sin ellos la app funciona, muestra los eventos como no disponibles y oculta la descarga de focos.

## Desplegar

El `Dockerfile` de la raíz construye la web y arranca `functions/` sirviendo ambas cosas en un solo puerto:

```bash
docker build -t fire-calendar . && docker run --rm -p 8000:8000 fire-calendar
```

- **No está probado en contenedor**: en la máquina donde se escribió no había un servicio de Docker en marcha. La ejecución local sin contenedor sí está verificada.
- Memoria: el servicio usó unos 490 MB en una prueba con exportaciones grandes. Reservar **1 GB** (por ejemplo Cloud Run con 1 GiB, o un plan equivalente en Render o Fly.io).
- El enlace público no debe pedir registro ni contraseña. Probarlo en una ventana privada antes de enviar.
- La interfaz abre en español; `?lang=en` la abre en inglés.

## Límites que la app declara

- Un foco de calor es una detección térmica, no un incendio confirmado.
- Sin observación (nubes, humo) no significa cero fuego.
- Un evento de fuego es un grupo de focos cuyos buffers se tocan el mismo día; un incendio de varios días cuenta una vez por día.
- Los focos crudos y los eventos no son comparables entre años; la actividad armonizada sí.
- Antes de mediados de 2002 solo volaba Terra: esos valores son de baja confianza.
- Los departamentos se asignan con contornos aproximados.
- La app describe; no predice incendios.

## Para la página del proyecto

**Datos de NASA:** FIRMS (Fire Information for Resource Management System): MODIS Collection 6.1 (Terra, Aqua) y VIIRS Collection 2 (S-NPP, NOAA-20, NOAA-21), archivo y casi tiempo real, Perú, noviembre de 2000 a noviembre de 2026. Imagen de fondo opcional del mapa: NASA GIBS, Blue Marble.

**Referencias externas (código y datos):**

- Leaflet (BSD-2-Clause) · mapa
- OpenStreetMap (ODbL) · teselas del mapa base
- DuckDB (MIT) · consultas sobre el parquet
- FastAPI (MIT), Uvicorn (BSD-3-Clause) · servicio HTTP
- H3 de Uber (Apache-2.0) · grilla hexagonal
- pandas, NumPy, SciPy (BSD-3-Clause), PyArrow (Apache-2.0) · ETL
- Vite (MIT), TypeScript (Apache-2.0) · compilación de la web

**Uso de IA:** se usó Claude (Anthropic), mediante Claude Code, para analizar el enunciado y las reglas, revisar la serie armonizada, escribir `src/etl/fire_events.py`, `functions/` y `web/`, y redactar documentación. El equipo descargó los datos de FIRMS, construyó la armonización (`src/etl/harmonize_firms.py`) y revisó los resultados. Completar con el uso real de cada integrante antes de enviar.
