# 06 · Arquitectura con DDD

## Estado actual (14 nov 2026)

La propuesta original de este documento se ajustó a lo que el equipo construyó. Lo que sigue es lo que hay hoy en el repositorio; las secciones posteriores conservan el lenguaje ubicuo y las reglas, que siguen vigentes.

```
data/           archivos de FIRMS y data/processed/harmonized_fires.parquet (serie armonizada)
src/etl/        harmonize_firms.py (armonización y validación) y fire_events.py (eventos de fuego)
functions/      servicios headless: leen la serie armonizada y responden JSON/CSV
web/            aplicación web
docs/           análisis (este directorio)
```

```
web/  ──►  functions/  ──►  data/  ◄──  src/etl/  ◄──  FIRMS
```

- `web/` solo habla con `functions/`, por HTTP. Nunca lee el parquet ni FIRMS.
- `functions/` no armoniza: lee lo que `src/etl/` dejó en `data/processed/` y aplica las reglas del **Calendario** (mediana, anomalía, frecuencia, temporada pico, años récord).
- `src/etl/` no sabe nada de HTTP ni de la interfaz. Lo que antes se llamaba `armonization/` es `src/etl/` más `data/`.

Decisiones tomadas:

| Decisión | Elegido | Motivo |
|---|---|---|
| Contrato `data/` → `functions/` | Datos precalculados (parquet) | Simple y sin cómputo pesado por petición |
| `functions/` | **Python + DuckDB + FastAPI** | Mismo lenguaje que el ETL; DuckDB consulta el parquet directo, también por caja de coordenadas |
| `web/` | **Vite + TypeScript sin framework, Leaflet** | Pocas dependencias, compila a estático |
| Celda de la grilla | H3 resolución 6 (~36 km²) | La que produce el ETL |
| Despliegue | Un solo servicio: `functions/` sirve también `web/dist` | Un enlace público, sin registro |

### `functions/` por capas

```
functions/src/fire_calendar/
  shared/kernel.py                      YearMonth, DateRange, BoundingBox, AreaOfInterest, DomainError
  calendar/domain/model.py              HarmonizedSeries, MonthlyActivity, Anomaly, HistoricalMedian, PeakSeason…
  calendar/domain/services.py           reglas puras: anomalía, frecuencia por niveles, totales anuales, temporada pico
  calendar/domain/ports.py              HarmonizedSeriesGateway (puerto)
  calendar/application/use_cases.py     GetBurnCalendar, GetAnomaly, GetActiveCells, GetDepartmentRanking
  calendar/infrastructure/duckdb_gateway.py   único lugar que conoce las columnas del parquet
  hotspots/application/export_csv.py    ExportActivityCsv
  interfaces/http/                      FastAPI: solo traduce entrada y salida
functions/tests/                        reglas del dominio y API contra el parquet real
```

Reglas de dominio que ya viven en el dominio y tienen prueba:

- El mes en curso se compara con **los mismos días** del mes en años anteriores, no con meses completos.
- Una `Anomaly` necesita al menos 10 años de historia para ser válida.
- El primer y el último año son parciales y nunca entran en el ranking de años.
- Hasta junio de 2002 (solo Terra) la actividad es de baja confianza.
- La línea base (mediana, percentiles, frecuencia) usa los años completos desde 2003.
- Un rango que cruza 2012 mezcla eras de sensores: los conteos crudos no son comparables dentro de él.

### `web/` por contextos

```
web/src/
  area-of-interest/domain/area.ts       AreaOfInterest, BoundingBox, validación inmediata de la caja
  area-of-interest/ui/mapView.ts        mapa Leaflet, celdas del mes, dibujo de la caja
  calendar/domain/types.ts              contrato con functions/
  calendar/infrastructure/calendarApiClient.ts
  calendar/application/calendarController.ts   selección del usuario y carga de datos
  calendar/ui/                          línea de tiempo, calendario, gráficas, tarjetas, ranking
  shared/                               formato, DOM, paleta, estado en la URL
```

`web/` no calcula medianas, anomalías ni niveles: llegan resueltos desde `functions/`.

### API de `functions/` (GET, prefijo `/api/v1`)

| Ruta | Devuelve |
|---|---|
| `/meta` | Fechas disponibles, departamentos, validación antes/después, límites declarados |
| `/calendar?department=\|bbox=&from=&to=` | Serie mensual, totales por año, medianas, niveles de frecuencia, temporada pico, resumen del rango |
| `/anomaly?…&month=AAAA-MM` | Mes frente a su mediana histórica (de igual a igual si es el mes en curso), con su lectura: por debajo, dentro, por encima o muy por encima de lo habitual |
| `/daily?department=\|bbox=` | Serie diaria densa (armonizada, focos y eventos por día): fondo de la línea de tiempo y totales del rango con precisión de días |
| `/cells?…&from=&to=` | GeoJSON de las celdas (hexágonos H3 res 6) con actividad en el rango; `month=AAAA-MM` sigue valiendo como atajo |
| `/points?…&from=&to=&limit=` | Focos crudos sin armonizar, uno por detección, los más recientes primero, con el total y si se recortaron (tope 50 000) |
| `/points` (campo `summary`) | Resumen de todos los focos crudos del área y el rango: por sensor, satélite, día/noche y confianza, días con focos, día con más focos y FRP |
| `/limits` | Departamentos y distritos oficiales del INEI (sin geometría), para elegir el área |
| `/boundary?department=\|district=` | Contorno oficial simplificado del departamento o distrito (Feature GeoJSON) |
| `/ranking?from=&to=` | Departamentos en el rango |
| `/hotspots.csv?…&from=&to=` | CSV de focos de calor, un foco por fila (lo que pide el enunciado) |
| `/export.csv?…&from=&to=` | CSV de celdas-día activas del área y el rango, con la actividad armonizada |
| `/calendar.csv?…&from=&to=` | El análisis en tabla: serie mensual con mediana histórica, razón y rango habitual |

El área es todo el Perú (sin parámetros), un `department`, un `district` (ubigeo de 6 dígitos), una caja `bbox=oeste,sur,este,norte` o un `polygon=lon,lat;lon,lat;...` dibujado (hasta 500 vértices). Departamentos y distritos usan los límites oficiales del INEI (`data/processed/peru_limits.json`, de `src/etl/peru_limits.py`); como los polígonos dibujados, se ajustan a la grilla H3 res 6: cuenta cada celda cuyo centro cae dentro. `from` y `to` aceptan días `AAAA-MM-DD` o meses `AAAA-MM` (primer y último día del mes); `/calendar` y `/calendar.csv` son mensuales y usan el mes de cada fecha. Documentación interactiva en `/api/docs`.

## Propuesta original

Estructura del repositorio:

```
docs/           análisis (este directorio)
armonization/   armonización: ingesta de FIRMS, grilla, calibración, validación
functions/      servicios que consume web/ y que se conectan con armonization/
web/            aplicación web
```

Dirección de las dependencias:

```
web/  ──►  functions/  ──►  armonization/  ──►  FIRMS
```

- `web/` solo habla con `functions/`. Nunca lee FIRMS ni la armonización directamente.
- `functions/` no contiene ciencia: expone servicios y delega en `armonization/`.
- `armonization/` no sabe nada de HTTP ni de la interfaz.

Este documento es una propuesta. El stack queda abierto hasta que el equipo lo confirme.

## Lenguaje ubicuo

Los mismos términos en conversación, documentos y código.

| Término | Significado | Nombre en código |
|---|---|---|
| Foco de calor | Detección térmica de un satélite en un punto y momento | `Hotspot` |
| Sensor | Instrumento que detecta: MODIS o VIIRS | `Sensor` |
| Satélite | Plataforma: Terra, Aqua, S-NPP, NOAA-20, NOAA-21 | `Satellite` |
| Confianza | Fiabilidad de la detección, normalizada entre sensores | `Confidence` |
| Área de interés | Zona elegida por el usuario | `AreaOfInterest` |
| Celda | Unidad de la grilla común | `GridCell` |
| Celda-día activa | Celda con al menos un foco en un día | `ActiveCellDay` |
| Factor de calibración | Relación MODIS → VIIRS por región y mes | `CalibrationFactor` |
| Serie armonizada | Actividad comparable 2000 → hoy | `HarmonizedSeries` |
| Calendario de quema | Matriz año × mes de actividad | `BurnCalendar` |
| Mediana histórica | Valor típico de un mes en todos los años | `HistoricalMedian` |
| Anomalía | Desviación del mes frente a su mediana | `Anomaly` |
| Temporada pico | Meses que concentran la actividad | `PeakSeason` |

## Contextos delimitados

```
 FIRMS ──► Ingesta ──► Armonización ──► Calendario ──► Exportación
            focos        serie            calendario     CSV / PNG
            limpios      armonizada       y anomalías
```

| Contexto | Responsabilidad | Vive en |
|---|---|---|
| **Ingesta** | Traer focos de FIRMS, traducirlos al modelo propio, limpiarlos | `armonization/` |
| **Armonización** | Grilla, celdas-día, calibración, validación | `armonization/` |
| **Calendario** | Agregar por área y fechas, mediana, anomalía, temporada pico | `functions/` (servicio) y `web/` (vista) |
| **Exportación** | CSV de focos e imágenes | `functions/` (servicio) y `web/` (descarga) |
| **Área de interés** | Dibujo en mapa, coordenadas, validación del área | `web/` |

**Capa anticorrupción:** Ingesta es el único lugar que conoce las columnas de FIRMS (`bright_ti4`, `confidence` como letra o número). De ahí en adelante todo usa `Hotspot`.

## Capas en cada contexto

| Capa | Contiene | Regla |
|---|---|---|
| `domain` | Entidades, objetos de valor, servicios de dominio, puertos | Sin dependencias externas |
| `application` | Casos de uso | Orquesta el dominio, no tiene reglas de negocio |
| `infrastructure` | Clientes FIRMS, almacenamiento, adaptadores | Implementa los puertos |
| `interfaces` | HTTP en `functions/`, componentes en `web/`, comandos en `armonization/` | Solo traduce entrada y salida |

Las dependencias apuntan hacia el dominio.

## Estructura propuesta

```
armonization/
  src/
    ingestion/
      domain/          Hotspot, Sensor, Confidence, HotspotSource (puerto)
      application/     ImportCountryArchive, FetchRecentHotspots
      infrastructure/  FirmsArchiveClient, FirmsAreaApiClient, FirmsCsvMapper
    harmonization/
      domain/          GridCell, ActiveCellDay, CalibrationFactor, HarmonizedSeries
      application/     BuildHarmonizedSeries, ValidateHarmonization
      infrastructure/  SeriesRepository
    shared/            DateRange, BoundingBox
    interfaces/        comandos para ejecutar ingesta, armonización y validación

functions/
  src/
    calendar/
      domain/          BurnCalendar, HistoricalMedian, Anomaly, PeakSeason
      application/     GetBurnCalendar, GetAnomaly
      infrastructure/  HarmonizedSeriesGateway (conexión con armonization/)
    hotspots/
      application/     GetHotspotsCsv, GetRecentHotspots
      infrastructure/  HotspotsGateway (conexión con armonization/)
    shared/            DateRange, BoundingBox, Result
    interfaces/http/   getCalendar, getHotspotsCsv, getRecentHotspots

web/
  src/
    area-of-interest/
      domain/          AreaOfInterest, BoundingBox
      application/     SelectAreaOfInterest
      ui/              MapDraw, CoordinateForm
    calendar/
      domain/          BurnCalendar, Anomaly
      application/     LoadBurnCalendar
      infrastructure/  CalendarApiClient
      ui/              CalendarHeatmap, AnomalyCard, PeakSeasonPanel
    export/
      application/     DownloadHotspotsCsv, DownloadChartPng
      ui/              ExportButtons
    shared/
```

## Reglas de dominio que deben vivir en el dominio

- Un `Hotspot` solo es válido si es fuego de vegetación y supera el umbral de confianza.
- `Confidence` unifica la escala numérica de MODIS y la de letras de VIIRS.
- Una `ActiveCellDay` cuenta una vez por celda y día, sin importar cuántos focos tenga.
- Un `CalibrationFactor` pertenece a una región y a un mes del año.
- Una `HarmonizedSeries` anterior a 2012 siempre lleva incertidumbre.
- La `Anomaly` de un mes necesita un mínimo de años de historia para ser válida.

Estas reglas son las que conviene cubrir con pruebas unitarias.

## Opciones de stack

| Parte | Recomendada | Alternativa |
|---|---|---|
| `armonization/` | **Python** (pandas o DuckDB) | TypeScript, para un solo lenguaje en todo el repositorio |
| `functions/` | **TypeScript sobre Firebase Cloud Functions** | Python, igual que `armonization/` |
| `web/` | **React + Vite + TypeScript** con Leaflet | Vue + Vite, o HTML y JS sin framework |
| Datos servidos | Archivos estáticos precalculados | Base de datos si hay tiempo |

Motivos de la recomendación: `armonization/` es trabajo de ciencia de datos y Python lo resuelve más rápido; `web/` y `functions/` comparten TypeScript y tipos; y la clave de FIRMS nunca llega al navegador. NASA no restringe herramientas, así que la decisión depende de lo que el equipo domine.

## Contrato entre `armonization/` y `functions/`

Hay que elegir cómo se conectan:

| Opción | Cómo funciona | Cuándo conviene |
|---|---|---|
| **Datos precalculados** (recomendada) | `armonization/` escribe la serie armonizada y los focos limpios en un almacenamiento; `functions/` los lee | Hackathon: simple, rápido y sin cómputo pesado por petición |
| Llamada directa | `functions/` invoca a `armonization/` como biblioteca o servicio | Si ambos usan el mismo lenguaje o se necesita armonizar bajo demanda |

En los dos casos el contrato es el mismo modelo: `HarmonizedSeries` y `Hotspot`, con el lenguaje ubicuo de este documento.

## Decisiones pendientes

- [ ] Lenguaje de `armonization/`.
- [ ] Lenguaje y plataforma de `functions/`.
- [ ] Contrato entre `armonization/` y `functions/`.
- [ ] Framework de `web/`.
- [ ] Tamaño de celda de la grilla.
- [ ] Dónde se alojan los datos precalculados y la app.
