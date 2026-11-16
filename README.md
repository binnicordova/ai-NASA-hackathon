# Calendario de quema · Perú

<p align="center">
  <a href="https://youtu.be/a8X_l8E2iQA" title="Ver el demo de NASAT.space en YouTube">
    <img src="docs/img/demo-youtube.jpg" alt="Demo de NASAT.space (30 s): SAT · alerta temprana y armonización de MODIS y VIIRS" width="860">
  </a>
  <br>
  <a href="https://youtu.be/a8X_l8E2iQA"><b>▶ Ver el demo en YouTube (30 s)</b></a> · <a href="https://nasat.space">nasat.space</a>
</p>

Proyecto del reto **Harmonization of MODIS and VIIRS Hot Spots** (NASA Space Apps Challenge 2026).
Aplicación web con un calendario de actividad de quema sobre focos de calor de MODIS y VIIRS armonizados (NASA FIRMS), para el área y el rango de fechas que elige el usuario.

```
web/  ──►  functions/  ──►  data/  ◄──  src/etl/  ◄──  FIRMS
```

## Capturas

La interfaz usa la paleta de NASA Space Apps y sigue el tema claro u oscuro del dispositivo. Las primeras cuatro capturas son del tema oscuro.

**Todo el Perú, mes en curso.** Mapa de celdas armonizadas, lectura del mes frente a su mediana, totales del rango y línea de tiempo.

![Vista nacional](docs/img/01-peru.jpg)

**Cusco, septiembre de 2024.** Área por departamento, rango de fechas y veredicto "por encima de lo habitual".

![Cusco, septiembre de 2024](docs/img/02-cusco.jpg)

**Calendario de quema con el número en cada celda.** En cursiva, los años solo-MODIS (estimados).

![Calendario año × mes](docs/img/03-calendario.jpg)

**Ranking de departamentos y límites declarados.**

![Ranking y límites](docs/img/04-ranking-limites.jpg)

**Tema claro, para uso en campo.** La misma vista de Cusco: la rampa es la misma en los dos temas, de amarillo pálido (poca actividad) a rojo oscuro (mucha).

![Cusco en tema claro](docs/img/05-tema-claro.jpg)

## Criterios del hackathon y estado

Estado al 15 de noviembre de 2026. El cierre del envío es el domingo 15 de noviembre a las 11:59 p. m.

### Lo que pide el enunciado

| Criterio | Estado | Dónde |
|---|---|---|
| Armonizar MODIS y VIIRS hasta que el sensor no importe | ✅ Cumplido | `src/etl/harmonize_firms.py`; error mensual entre sensores de 89.9 % a 15.1 % en años reservados |
| Aplicación web sobre los datos armonizados | ✅ Cumplido | `web/` + `functions/`, desplegada en Cloud Run |
| Elegir región en el mapa y por coordenadas | ✅ Cumplido | Dibujar una caja, coordenadas N/S/O/E o departamento |
| Elegir rango de fechas | ✅ Cumplido | Mes inicial y final, atajos y línea de tiempo |
| Calendario desde inicios de los 2000 hasta hoy | ✅ Cumplido | Noviembre de 2000 a noviembre de 2026 |
| Qué periodos del año tienen más fuego | ✅ Cumplido | Temporada pico y frecuencia por mes |
| Qué años tuvieron más quema | ✅ Cumplido | Gráfica "Por año" |
| Mes actual frente a la mediana histórica | ✅ Cumplido | Lectura, razón y percentil, comparando los mismos días del mes |
| Rampas de color accesibles | ✅ Cumplido | Rampa de calor secuencial amarillo → rojo (rojo = más, igual en los dos temas), de luminosidad siempre decreciente, y número en cada celda. Comprobada con simulación de daltonismo (`npm --prefix web run check:palette`), no con personas |
| CSV de los focos detectados en la búsqueda | ✅ Cumplido | "Focos de calor (CSV)", un foco por fila |
| Descargar análisis y visualizaciones | ✅ Cumplido | CSV del análisis mensual y PNG de cada gráfica y del calendario |
| Anomalías frente a promedios multianuales | ✅ Cumplido | Año frente a un año normal, con mediana y rango habitual |

### Reglas del envío

| Regla | Estado |
|---|---|
| Usar al menos un dato de NASA | ✅ Todo sale de NASA FIRMS |
| Trabajo original hecho durante el hackathon | ✅ |
| Enlace público a la app, sin registro | ✅ <https://fire-calendar-538134722054.us-east1.run.app> (Cloud Run) |
| Página del proyecto con sus ocho campos | ❌ Pendiente: textos listos en [docs/08-envio.md](docs/08-envio.md) |
| Demo de 7 diapositivas o video de 30 s | ✅ Video de 30 s en YouTube, público: <https://youtu.be/a8X_l8E2iQA> |
| Declarar el uso de IA | ⚠️ Borrador listo; falta lo que hizo cada integrante |
| Referencias de todo lo externo | ⚠️ Borrador listo, más abajo |
| Equipo de seis personas como máximo | Por confirmar por el equipo |

### Criterios del jurado (1 a 5 cada uno)

| Criterio | Cómo lo cubre el proyecto | Estado |
|---|---|---|
| Impacto | Gestores de emergencias en el Perú; caso Cusco; interfaz en español | Cubierto en la app |
| Creatividad | Armonización con incertidumbre visible, eventos de fuego por buffer y disolución, lectura en palabras del mes | Cubierto en la app |
| Validez | Validación en años reservados y límites declarados en pantalla | Cubierto en la app |
| Relevancia | Checklist del enunciado completo; FIRMS es todo el dato | Cubierto en la app |
| Presentación | Interfaz con la paleta de NASA Space Apps, en tema claro y oscuro. El resto depende de la página del proyecto y la demo | ⚠️ Interfaz lista; página y demo sin empezar |

## Estructura

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

`peru_limits.py` descarga los límites oficiales del INEI (Geoservidor WFS Interoperabilidad: departamentos, provincias y distritos) y escribe `peru_limits.json`: contornos simplificados y, para cada departamento y distrito, las celdas H3 res 6 cuyo centro cae dentro. Con este archivo la app elige el área por límites oficiales; sin él, usa el departamento aproximado de la serie.

## Desplegar

**App pública:** <https://fire-calendar-538134722054.us-east1.run.app> (sin registro; `?lang=en` la abre en inglés).

Un solo contenedor en **Google Cloud Run** (proyecto `nasat-fire-calendar`, región `us-east1`). El `Dockerfile` construye la web y arranca `functions/`, que sirve la API y la web en el mismo puerto. Los datos de `data/processed/` van dentro de la imagen: cada revisión lleva el código y los datos que le corresponden, y volver atrás mueve ambos.

```
Navegador ──HTTPS──► Cloud Run "fire-calendar" (1 vCPU, 2 GiB, 0–3 instancias)
                      uvicorn + FastAPI: /api/v1 (JSON, CSV) y / (web compilada)
                      DuckDB en memoria ◄── data/processed/ dentro de la imagen
Teselas del mapa: el navegador las pide directo a NASA GIBS y OpenStreetMap.
```

Probar la imagen en local:

```bash
docker build -t fire-calendar . && docker run --rm -p 8080:8080 fire-calendar
```

Publicar una nueva versión (por ejemplo, tras regenerar los datos):

```bash
gcloud run deploy fire-calendar --source . --project nasat-fire-calendar --region us-east1 --allow-unauthenticated --memory 2Gi --cpu 1 --concurrency 40 --min-instances 0 --max-instances 3 --timeout 900
```

- Arranca en ~1 s y usa ~370 MB. Tres exportaciones completas a la vez llegaron a ~1 GB, así que DuckDB queda limitado a 1 GB (`DUCKDB_MEMORY_LIMIT`) y el servicio tiene 2 GiB. Lo que no cabe se escribe a `/tmp`.
- La exportación CSV de todos los focos (2,2 millones de filas) tarda ~3 min; el tiempo máximo por petición es de 15 min.
- Escala a cero: tras un rato sin visitas, la primera carga tarda unos segundos más. Para una demo en vivo, `--min-instances 1` y luego volver a 0.
- Presupuesto con alertas al 50 % y 100 % de S/ 40 al mes en la cuenta de facturación del proyecto.
- `.gcloudignore` evita subir a Cloud Build los CSV crudos de FIRMS.

### Despliegue continuo

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publica una revisión nueva cada vez que llega a `main` un cambio en `Dockerfile`, `.gcloudignore`, `functions/`, `web/`, `data/processed/` o el propio workflow. Primero corre las pruebas de `functions/` y el chequeo de tipos de `web/`; si fallan, no despliega. Después del despliegue comprueba que `/` y `/api/v1/meta` respondan. También se puede lanzar a mano desde la pestaña Actions ("Run workflow").

GitHub entra a Google Cloud sin claves guardadas: el token OIDC del workflow se cambia por credenciales cortas de la cuenta de servicio `github-deployer` (Workload Identity Federation). El proveedor solo acepta tokens de este repositorio y de la rama `main`. La cuenta tiene los permisos mínimos para desplegar desde código fuente: `roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer` y `roles/iam.serviceAccountUser` sobre la cuenta con la que corre el servicio.

Configuración única (ya hecha; sirve para rehacerla en otro proyecto):

```bash
PROJECT=nasat-fire-calendar; NUM=538134722054; REPO=binnicordova/ai-NASA-hackathon
SA=github-deployer@$PROJECT.iam.gserviceaccount.com
gcloud services enable sts.googleapis.com iamcredentials.googleapis.com --project $PROJECT
gcloud iam service-accounts create github-deployer --project $PROJECT --display-name "GitHub Actions: despliegue a Cloud Run"
for ROLE in roles/run.sourceDeveloper roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding $PROJECT --member "serviceAccount:$SA" --role $ROLE --condition None
done
gcloud iam service-accounts add-iam-policy-binding $NUM-compute@developer.gserviceaccount.com --project $PROJECT --member "serviceAccount:$SA" --role roles/iam.serviceAccountUser
gcloud iam workload-identity-pools create github --project $PROJECT --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-oidc --project $PROJECT --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

## Límites que la app declara

- Un foco de calor es una detección térmica, no un incendio confirmado.
- Sin observación (nubes, humo) no significa cero fuego.
- Un evento de fuego es un grupo de focos cuyos buffers se tocan el mismo día; un incendio de varios días cuenta una vez por día.
- Los focos crudos y los eventos no son comparables entre años; la actividad armonizada sí.
- Antes de mediados de 2002 solo volaba Terra: esos valores son de baja confianza.
- Los departamentos se asignan con contornos aproximados.
- La app describe; no predice incendios.

## Para la página del proyecto

**Datos de NASA:** FIRMS (Fire Information for Resource Management System): MODIS Collection 6.1 (Terra, Aqua) y VIIRS Collection 2 (S-NPP, NOAA-20, NOAA-21), archivo y casi tiempo real, Perú, noviembre de 2000 a noviembre de 2026. Mapa base por defecto y globo 3D de la intro: NASA GIBS, Blue Marble.

**Referencias externas (código y datos):**

- Leaflet (BSD-2-Clause) · mapa
- Logo oficial de NASA Space Apps, sin alterar, y paleta, degradado y tipografías de su guía de marca · Fira Sans y Overpass (SIL OFL, Google Fonts)
- OpenStreetMap (ODbL) · teselas del mapa base
- DuckDB (MIT) · consultas sobre el parquet
- FastAPI (MIT), Uvicorn (BSD-3-Clause) · servicio HTTP
- H3 de Uber (Apache-2.0) · grilla hexagonal
- pandas, NumPy, SciPy (BSD-3-Clause), PyArrow (Apache-2.0) · ETL
- Vite (MIT), TypeScript (Apache-2.0) · compilación de la web

**Uso de IA:** se usó Claude (Anthropic), mediante Claude Code, para analizar el enunciado y las reglas, revisar la serie armonizada, escribir `src/etl/fire_events.py`, `functions/` y `web/`, y redactar documentación. El equipo descargó los datos de FIRMS, construyó la armonización (`src/etl/harmonize_firms.py`) y revisó los resultados. El logo de NASAT se generó con una herramienta de IA de imágenes (indicar cuál). Completar con el uso real de cada integrante antes de enviar.
