# 06 · Arquitectura con DDD

Estructura del repositorio:

```
docs/        análisis (este directorio)
web/         aplicación web
functions/   backend: ingesta, armonización y consultas
```

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
| **Ingesta** | Traer focos de FIRMS, traducirlos al modelo propio, limpiarlos | `functions/` |
| **Armonización** | Grilla, celdas-día, calibración, validación | `functions/` |
| **Calendario** | Agregar por área y fechas, mediana, anomalía, temporada pico | `functions/` y `web/` |
| **Exportación** | CSV de focos e imágenes | `web/` y `functions/` |
| **Área de interés** | Dibujo en mapa, coordenadas, validación del área | `web/` |

**Capa anticorrupción:** Ingesta es el único lugar que conoce las columnas de FIRMS (`bright_ti4`, `confidence` como letra o número). De ahí en adelante todo usa `Hotspot`.

## Capas en cada contexto

| Capa | Contiene | Regla |
|---|---|---|
| `domain` | Entidades, objetos de valor, servicios de dominio, puertos | Sin dependencias externas |
| `application` | Casos de uso | Orquesta el dominio, no tiene reglas de negocio |
| `infrastructure` | Clientes FIRMS, almacenamiento, adaptadores | Implementa los puertos |
| `interfaces` | HTTP en `functions/`, componentes en `web/` | Solo traduce entrada y salida |

Las dependencias apuntan hacia el dominio.

## Estructura propuesta

```
functions/
  src/
    ingestion/
      domain/          Hotspot, Sensor, Confidence, HotspotSource (puerto)
      application/     ImportCountryArchive, FetchRecentHotspots
      infrastructure/  FirmsArchiveClient, FirmsAreaApiClient, FirmsCsvMapper
    harmonization/
      domain/          GridCell, ActiveCellDay, CalibrationFactor, HarmonizedSeries
      application/     BuildHarmonizedSeries, ValidateHarmonization
      infrastructure/  SeriesRepository
    calendar/
      domain/          BurnCalendar, HistoricalMedian, Anomaly, PeakSeason
      application/     GetBurnCalendar, GetAnomaly
      infrastructure/
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
| `functions/` | **TypeScript sobre Firebase Cloud Functions** | Python si el equipo prefiere pandas para la armonización |
| `web/` | **React + Vite + TypeScript** con Leaflet | Vue + Vite, o HTML y JS sin framework |
| Datos servidos | Archivos estáticos precalculados | Base de datos si hay tiempo |

Motivos de la recomendación: un solo lenguaje permite compartir el modelo de dominio entre `web/` y `functions/`, y `functions/` oculta la clave de FIRMS. NASA no restringe herramientas, así que la decisión depende de lo que el equipo domine.

Si la armonización se hace en Python, se mantiene el mismo lenguaje ubicuo y se ejecuta como proceso de preparación de datos.

## Decisiones pendientes

- [ ] Lenguaje y plataforma de `functions/`.
- [ ] Framework de `web/`.
- [ ] Tamaño de celda de la grilla.
- [ ] Dónde se alojan los datos precalculados y la app.
