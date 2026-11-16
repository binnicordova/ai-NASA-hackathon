# Informe Técnico y Funcional Completo · NASAT (Calendario de Quema · Perú)

> **Proyecto:** *NASAT · Calendario de Quema del Perú* — Reto **Harmonization of MODIS and VIIRS Hot Spots** (NASA Space Apps Challenge 2026).  
> **App pública en producción:** <https://nasat.space> y <https://fire-calendar-538134722054.us-east1.run.app>  
> **Repositorio:** <https://github.com/binnicordova/ai-NASA-hackathon>  
> **Cobertura temporal verificada:** `2000-11-01` al `2026-11-14` (`313` meses, `9,510` días).

---

## 1. Arquitectura General y Capas DDD

El sistema sigue una **Arquitectura Dirigida por el Dominio (DDD)** organizada en cuatro capas y cuatro directorios principales, donde las dependencias siempre apuntan hacia el dominio:

```text
web/ (Vite + TypeScript + Leaflet)
  │  HTTP GET (JSON / GeoJSON / CSV streaming)
  ▼
functions/ (FastAPI + DuckDB + Python 3.12)
  │  Lectura en memoria de artefactos precalculados
  ▼
data/processed/ (3 archivos Parquet + 4 archivos JSON)
  ▲  Generados offline por el pipeline científico
  │
src/etl/ (harmonize_firms.py · fire_events.py · peru_limits.py)
  ▲
  │  14 archivos CSV NASA FIRMS + Servicio WFS oficial del INEI
```

### Separación estricta de responsabilidades
- **`src/etl/` (Ciencia e Ingesta):** Único módulo que conoce el formato crudo de los CSV de NASA FIRMS y los servicios WFS del INEI. Ejecuta limpieza, máscara estática, indexación hexagonal H3, calibración estadística, disolución espacial de eventos y validación fuera de muestra.
- **`data/processed/` (Contrato de Datos):** Contiene los artefactos inmutables versionados y empaquetados dentro de la imagen Docker de producción.
- **`functions/` (Backend Headless DDD):**
  - `shared/kernel.py`: Objetos de valor inmutables (`YearMonth`, `DateRange`, `DayRange`, `BoundingBox`, `AreaOfInterest`, `DomainError`, `parse_polygon`).
  - `calendar/domain/model.py`: Entidades y lenguaje ubicuo (`MonthlyActivity`, `HarmonizedSeries`, `HistoricalMedian`, `Anomaly`, `AnomalyCategory`, `MonthFrequency`, `ActivityLevels`, `YearlyTotal`, `PeakSeason`, `RangeSummary`, `MonthForecast`, `UnitForecast`, `ForecastCheck`, `ForecastMap`).
  - `calendar/domain/services.py`: Reglas científicas y estadísticas puras sin dependencias externas (`quantile`, `categorize`, `historical_medians`, `anomaly`, `activity_levels`, `yearly_totals`, `peak_season`, `range_summary`, `month_forecast`, `forecast_months`, `forecast_check`).
  - `calendar/domain/ports.py`: Interfaces/puertos (`HarmonizedSeriesGateway`) y DTOs (`ActiveCell`, `HotspotPoint`, `HotspotSummary`, `EventSummary`, `HotspotSample`, `DailyActivity`, `DepartmentTotal`).
  - `calendar/application/use_cases.py`: Casos de uso (`GetBurnCalendar`, `GetAnomaly`, `GetActiveCells`, `GetDailyActivity`, `GetHotspotPoints`, `GetDepartmentRanking`, `GetFireForecast`).
  - `hotspots/application/export_csv.py`: Casos de uso de exportación en streaming (`ExportHotspotsCsv`, `ExportActivityCsv`, `stream_csv`).
  - `calendar/infrastructure/duckdb_gateway.py`: Adaptador DuckDB (`DuckDbHarmonizedSeriesGateway`) con caché LRU y consulta espacial/temporal directa sobre los Parquet y JSON.
  - `interfaces/http/app.py` y `presenters.py`: API REST FastAPI bajo `/api/v1` y traducción de objetos de dominio a JSON/GeoJSON/CSV.
- **`web/` (Aplicación Cliente):** Interfaz TypeScript sin framework pesado (DOM modular + Leaflet + SVG + Canvas), organizada por contextos (`area-of-interest/`, `calendar/`, `shared/`). No contiene ciencia de calibración ni consulta directamente a FIRMS; toda lógica de negocio llega resuelta desde `functions/`.

---

## 2. Fuentes de Datos y Pipeline Científico ETL (`src/etl/`)

### 2.1. Ingesta y Auditoría de NASA FIRMS (`harmonize_firms.py`)
Se procesaron **14 archivos CSV** (10 `archive` de calidad científica y 4 `nrt` Near Real-Time) de las carpetas `data/2000 al 2012`, `data/2013 al 2023` y `data/2024 al 2026`, cubriendo Perú completo (`-18.34°S` a `-0.03°S`, `-81.29°W` a `-68.69°W`):
- **MODIS Collection 6.1 (`M-C61`):** Satélites `Terra` (`2000-11-01`+) y `Aqua` (`2002-07-04`+), resolución nominal `~1 km`.
- **VIIRS Collection 2 (`SV-C2`, `J1V-C2`, `J2V-C2`):** Satélites `S-NPP` (`2012-01-20` a `2026-11-01`), `NOAA-20 / N20` (`2018-04-01`+) y `NOAA-21 / N21` (`2023-03-01`+), resolución nominal `375 m`.

#### Etapas de limpieza y contabilidad exacta
| Etapa del pipeline | Registros | Filtrados | Regla implementada |
|---|---:|---:|---|
| Lectura cruda (`14` CSV) | **2,439,271** | — | Estandarización de `brightness`/`bright_ti4` → `bright_mir`, `bright_t31`/`bright_ti5` → `bright_tir`, y normalización de `instrument` (`SNPP` → `VIIRS`) |
| Filtro de baja confianza (`'l'`) | **2,289,271** | `-150,000` | En MODIS: `< 30` → `'l'`, `30..79` → `'n'`, `>= 80` → `'h'`. Se excluye `'l'` en ambos sensores |
| Deduplicación Archive vs. NRT | **2,289,177** | `-94` | Clave `(satellite, acq_date, acq_time, round(lat, 4), round(lon, 4))`, priorizando `archive` sobre `nrt` |
| Máscara estática H3 Res 7 (`MCD14ML`) | **2,184,650** | `-104,527` | `1,131` celdas H3 Res 7 (~5.8 km²) donde MODIS Archive marca `type != 0` (volcanes, industria, mar adentro), aplicadas a MODIS y VIIRS (incluyendo NRT sin columna `type`) |
| Otros `type != 0` residuales (VIIRS Archive) | **2,168,246** | `-16,404` | Detecciones VIIRS Archive `type != 0` fuera de la máscara MODIS Res 7 |
| **Focos limpios finales (`hotspots_clean.parquet`)** | **2,168,246** | — | **`1,839,066` VIIRS** + **`329,180` MODIS** |
| **Agregación diaria `(h3_res6, acq_date, instrument)`** | **1,090,622** | — | Celdas-día activas H3 Res 6 (~36–40 km²); **`952,908` filas** en `is_primary_series = True` |

---

### 2.2. Cálculos y Fórmulas de Armonización (`harmonize_firms.py`)

El objetivo científico es que **el sensor de origen deje de importar**. Toda la serie se expresa en una unidad común comparable: **celdas-día H3 Resolución 6 equivalentes a 1 satélite VIIRS de referencia (S-NPP)**.

1. **Unidad espacial común (`active_cell_day`):**
   - Cada foco se asigna a una celda hexagonal **H3 Resolución 6** (`h3_res6`, ≈ 36 km²).
   - Se agrupa por `(h3_res6, acq_date, instrument)` contando `active_cell_day = 1` por día, eliminando la multiplicación artificial de conteos cuando VIIRS (375 m) detecta varios píxeles dentro de un mismo fuego que MODIS (1 km) ve como uno solo.

2. **Normalización de constelación multi-satélite VIIRS ($\beta_{k,m}$):**
   - Al entrar `NOAA-20` (abril 2018) y `NOAA-21` (marzo 2023), el paso desfasado (~50 min) y distinta geometría/nubosidad eleva las celdas observadas por la unión de 2 o 3 satélites frente a 1 solo satélite.
   - Para cada régimen de constelación operativa $k \in \{1, 2, 3\}$ (con $k=2$ nuevamente desde el `2026-11-02` tras el fin de S-NPP), se calcula el factor empírico mensual en 2012–2025:
     $$\beta_{k,m} = \text{mediana}_{y}\left(\frac{\text{celdas}_{1\text{-sat}, y, m}}{\text{celdas}_{\text{unión } k\text{-sat}, y, m}}\right)$$
     con valores observados $\beta_{2,m} \approx 0.531\text{–}0.635$ y $\beta_{3,m} \approx 0.401\text{–}0.523$ ($\beta_{1,m} = 1.0$).

3. **Calibración estacional MODIS → 1-VIIRS ($\alpha_m$) e incertidumbre (IQR):**
   - En el solapamiento histórico `2012–2025`, se calcula mensualmente:
     $$\alpha_m = \text{mediana}_{y \in [2012, 2025]}\left(\frac{\text{VIIRS}_{1\text{-eq}, y, m}}{\text{MODIS}_{y, m}}\right)$$
   - Captura la estacionalidad física de fuegos pequeños: en temporada húmeda/quemas agrícolas pequeñas (`feb–abr`), $\alpha_m \in [6.805, 7.608]$; en temporada seca pico (`ago–sep`), $\alpha_m \in [3.383, 3.818]$.
   - Los percentiles 25 y 75 de $\alpha_m$ generan la banda de incertidumbre (`harmonized_uncertainty_low`, `harmonized_uncertainty_high`) para todos los años previos a VIIRS (`< 2012-01-20`).

4. **Régimen inicial Solo-Terra (`2000-11-01` a `2002-07-03`):**
   - Antes del lanzamiento de Aqua (`2002-07-04`), solo observaba Terra (pasada matutina ~10:30 h local).
   - Se calcula el factor intra-MODIS $\gamma_{\text{Terra}, m} = \text{mediana}_{2003\text{–}2024}(\text{MODIS}_{\text{Terra+Aqua}} / \text{MODIS}_{\text{Terra}})$ con **regularización por saturación**: cuando $T_{y,m}$ ya iguala o supera la mediana combinada $M_{\text{med},m}$ (o en `2000`), el peso adicional decae hacia `1.0` para no inflar artificialmente noviembre–diciembre de 2000 (`3,972.4` actividad armonizada), manteniendo 2001 en `20,613.9`.

5. **Calibración de Potencia Radiativa del Fuego (`harmonized_frp`, en MW):**
   - En VIIRS (`>= 2012-01-20`): $\text{harmonized\_frp} = \frac{\sum \text{FRP}}{k_{\text{viirs}}}$.
   - En MODIS (`< 2012-01-20`): $\text{harmonized\_frp} = \text{max\_frp} \cdot \alpha_{\text{FRP}, m}$ ($\alpha_{\text{FRP}, m} \in [2.141, 3.260]$).

6. **Control de calidad (`SENSOR_OUTAGE`):**
   - Marca `quality_flag = 'SENSOR_OUTAGE'` (`240` filas diarias MODIS) en las ventanas de corte documentadas por NASA: `2001-06-14..2001-07-05`, `2007-08-15..2007-08-19` y `2009-04-20..2009-04-22`.

---

### 2.3. Eventos de Fuego por Buffer y Disolución (`fire_events.py`)
Partiendo exactamente de los `2,168,246` focos limpios:
1. Cada foco recibe un buffer circular del tamaño nominal de su píxel: **`375 m` (VIIRS)** y **`1,000 m` (MODIS)**.
2. Para cada día (`acq_date`), se construye un grafo espacial (`cKDTree`) conectando pares de focos cuya distancia geodésica local es $\le r_i + r_j$, y se extraen las **componentes conexas** (`scipy.sparse.csgraph.connected_components`), equivalente matemático exacto a la disolución SIG sin construir geometrías costosas.
3. Produce **3 series** en `fire_events.parquet`:
   - `all`: **`1,134,478`** eventos diarios (todos los sensores).
   - `viirs`: **`1,006,353`** eventos diarios (solo VIIRS).
   - `modis`: **`225,990`** eventos diarios (solo MODIS — base estable usada por el modelo de Alerta Temprana).
4. Cada evento guarda centroide (`lat`, `lon`), `n_hotspots`, `sum_frp` y departamento H3 Res 6. Se advierte explícitamente que este conteo **no está armonizado** y que un incendio de varios días cuenta una vez por día.

---

### 2.4. Límites Oficiales del INEI (`peru_limits.py`)
- Descarga directa desde el Geoservidor WFS Interoperabilidad del INEI (`ig_departamento`, `ig_provincia`, `ig_distrito`).
- Simplificación topológica de contornos mediante **Douglas-Peucker** (`TOLERANCE = 0.003°`, ~300 m).
- Indexación exacta sobre la grilla **H3 Resolución 6**: cada celda pertenece al límite oficial donde cae su centro (`h3.h3shape_to_cells`), evitando recalcular el ETL cuando el usuario filtra por cualquier unidad política.
- Cobertura generada en `peru_limits.json` (`2026-11-15`): **`25` departamentos** (incluyendo Callao), **`196` provincias** (código de 4 dígitos) y **`1,890` distritos** (ubigeo de 6 dígitos).

---

## 3. Reglas de Dominio, Cálculos y Métricas (`functions/`)

Todas las reglas estadísticas viven en `functions/src/fire_calendar/calendar/domain/services.py` y `model.py`:

### 3.1. Calendario de Quema, Línea Base y Temporada Pico
- **Periodo de referencia histórico (`reference_years`):** Años completos con Terra + Aqua disponibles: `2003` hasta el último año completo (`2025`, `23` años).
- **Años parciales (`is_partial_year`):** `2000` (solo nov–dic) y el año en curso (`2026`, hasta `2026-11-14`) se marcan como `partial = True` y se excluyen del ranking anual (`rank = None`).
- **Medianas históricas y rango habitual (`historical_medians`):** Para cada mes calendario `1..12` sobre `reference_years`, calcula `median` (`P50`), `p10` y `p90` mediante interpolación lineal de cuantiles (`quantile`).
- **Niveles de actividad y frecuencia (`activity_levels`):** Calcula los umbrales globales `P50`, `P75` y `P90` sobre todos los meses de referencia y clasifica cada mes histórico en 4 niveles (`low`, `moderate`, `high`, `very_high`) para responder *"¿en cuántos años este mes fue alto o muy alto?"*.
- **Temporada pico (`peak_season`):** Ordena los 12 meses de mayor a menor mediana histórica y selecciona el conjunto mínimo de meses cuya suma acumulada alcanza al menos el **66 %** (`PEAK_SEASON_SHARE = 0.66`) de la actividad anual típica. En Perú nacional, la temporada pico es **agosto, septiembre y octubre (`[8, 9, 10]`)**.
- **Resumen del rango (`range_summary`):** Suma `harmonized`, `hotspots`, `events` y `events_modis` en el rango elegido, y activa `mixes_sensor_eras = True` si el rango cruza `2012` (advirtiendo que los conteos crudos internos no son comparables).

### 3.2. Anomalía del Mes y Comparación *Like-for-Like* (`anomaly`)
- **Validación de historia mínima:** Exige al menos `MIN_YEARS_FOR_ANOMALY = 10` años en la referencia (`valid = False` si hay menos o mediana = 0).
- **Comparación justa del mes en curso (*month-to-date*):** Como el último mes (`2026-11`, hasta el día `14`) está incompleto, `GetAnomaly` consulta `month_to_date_by_year(area, month, last_day=14)` en DuckDB para comparar **exactamente los días `1..14` de noviembre de `2026` frente a los días `1..14` de noviembre de `2003..2025`**, evitando sesgos artificiales por mes incompleto.
- **Métricas devueltas:**
  - `ratio = value / median` (ej. `1.0×` = igual a la mediana).
  - `percentile`: porcentaje de años de referencia estrictamente menores al valor observado.
  - **Categorización (`categorize`):**
    - `below`: percentil `< 25` (*Por debajo de lo habitual*, signo `↓`).
    - `normal`: percentil `25..74` (*Dentro de lo habitual*, signo `≈`).
    - `above`: percentil `75..89` (*Por encima de lo habitual*, signo `↑`).
    - `well_above`: percentil `>= 90` (*Muy por encima de lo habitual*, signo `⇈`).

### 3.3. Alerta Temprana · Modelo Predictivo 2027 (`month_forecast` y `forecast_check`)
Implementado en `services.py` y `use_cases.py` (`GetFireForecast`):
- **Serie base estricta:** Usa exclusivamente **eventos diarios MODIS** (`events_modis`) de los años completos `2003–2025` (`23` años), ya que MODIS Terra+Aqua mantiene una constelación constante sin el sesgo de crecimiento de eventos por nuevos satélites VIIRS.
- **Modelo estadístico adaptativo:**
  - $\lambda = \frac{1}{n}\sum_{y} c_{y,m}$ (eventos esperados en el mes $m$).
  - Evalúa sobredispersión interanual: si la varianza muestral $\sigma^2 > 1.05\,\lambda$, utiliza una distribución **Poisson-Gamma (Binomial Negativa)** con parámetro de forma $r = \frac{\lambda^2}{\sigma^2 - \lambda}$; en caso contrario, **Poisson puro**.
  - Calcula la **probabilidad de al menos un evento**:
    $$P_{\text{any}} = \begin{cases} 1 - \left(\frac{r}{r+\lambda}\right)^r & \text{si hay sobredispersión} \\ 1 - e^{-\lambda} & \text{Poisson puro} \end{cases}$$
  - Calcula el **rango esperado del 80 %** (`[low, high]` = cuantiles `P10` y `P90` de la PMF exacta).
- **Verificación fuera de muestra (`forecast_check`):** Entrena con **`2003–2020`** y evalúa sobre **`2021–2025`** midiendo **Brier Score**, **Brier Skill Score** frente a una tasa base nacional uniforme, **cobertura real del intervalo del 80 %** (`coverage` vs `poissonCoverage`) y **mediana de dispersión** ($\sigma^2 / \lambda$).

---

## 4. Servicios HTTP / API REST (`functions/interfaces/http/app.py`)

API FastAPI con compresión `GZipMiddleware` (≥ 2,000 bytes), `CORS` (`GET`), documentación OpenAPI en `/api/docs` y manejo unificado de `DomainError` (HTTP `400`).

### Parámetros universales de filtrado
- **Área (mutuamente excluyente):** `department` (nombre), `province` (código INEI 4 dígitos), `district` (ubigeo 6 dígitos), `bbox=oeste,sur,este,norte` o `polygon=lon,lat;...` (hasta `500` vértices; ajustado a celdas H3 Res 6 cuyo centro cae dentro). Sin parámetro = todo el Perú.
- **Fechas:** `from` y `to` aceptan precisión diaria (`AAAA-MM-DD`) o mensual (`AAAA-MM`).

### Catálogo de los 15 Endpoints (`/api/v1`)

| Método y Ruta | Descripción funcional | Formato / Detalles clave |
|---|---|---|
| `GET /api/v1/meta` | Metadatos globales, rango de fechas, 25 departamentos, fuente, métricas de validación, advertencias (`CAVEATS`) y flag `hasHotspotPoints` | JSON |
| `GET /api/v1/limits` | Catálogo oficial INEI de departamentos, provincias y distritos para los selectores | JSON |
| `GET /api/v1/boundary` | Contorno oficial simplificado de un departamento, provincia o distrito | GeoJSON `Feature` (`MultiPolygon`) |
| `GET /api/v1/shapes?level=` | Todos los contornos de un nivel (`department`, `province`, `district`) | GeoJSON `FeatureCollection` (`Cache-Control: 86400s`) |
| `GET /api/v1/calendar` | Serie mensual completa, totales anuales con ranking, medianas (`P10/P50/P90`), niveles de frecuencia, temporada pico y resumen del rango | JSON |
| `GET /api/v1/anomaly` | Comparación de un mes (por defecto el mes en curso *month-to-date*) contra su mediana histórica | JSON |
| `GET /api/v1/daily` | Serie diaria densa (9,510 días desde `2000-11-01`, incluyendo ceros) de `harmonized`, `hotspots` y `events` | JSON compacto para línea de tiempo |
| `GET /api/v1/cells` | Hexágonos H3 Res 6 activos en un mes (`month=`) o rango de días (`from=`/`to=`) | GeoJSON `FeatureCollection` |
| `GET /api/v1/points` | Focos crudos más recientes primero (tope `limit` configurable hasta `50,000`), más `summary` completo de todo el rango y `events` diarios | JSON compacto por arreglos |
| `GET /api/v1/ranking` | Ranking de los 25 departamentos en el rango de días (hexágonos, focos, eventos y actividad armonizada) | JSON ordenado |
| `GET /api/v1/forecast?level=` | Predicción mensual por unidad (`department`, `province`, `district`) y métricas fuera de muestra (`check`) | JSON (`Cache-Control: 3600s`) |
| `GET /api/v1/forecast/area` | Predicción mensual (12 meses) para cualquier área elegida (incluidos `bbox` o `polygon`) | JSON |
| `GET /api/v1/hotspots.csv` | Descarga de todos los focos limpios detectados en el área y rango de días (1 fila por foco) | CSV en streaming (`64 KB` chunks) |
| `GET /api/v1/calendar.csv` | Descarga de la serie mensual completa con mediana histórica, razón y `P10–P90` | CSV en streaming |
| `GET /api/v1/export.csv` | Descarga de las celdas-día armonizadas `(acq_date, cell_id, instrument)` del área y rango | CSV en streaming |

---

## 5. Aplicación Web Interactiva (`web/`)

Aplicación SPA en TypeScript puro con Vite y Leaflet, bilingüe (**Español / Inglés**, `?lang=en` o botón ES/EN) y con **tema oscuro / claro** (resampa de color invariante entre temas). Todo el estado de selección se sincroniza en el hash de la URL (`urlState.ts`) para compartir vistas exactas mediante enlace.

### 5.1. Experiencia Inicial y Mapas Base
- **Intro Globo 3D (`globeIntro.ts`):** Renderiza la Tierra rotando sobre un `<canvas>` con textura **NASA GIBS Blue Marble**, haciendo transición suave hacia el encuadre del Perú en Leaflet (saltable con clic, tecla o botón, y recordado en `sessionStorage['nasat-intro-seen']`).
- **Mapas base en Leaflet (`mapView.ts`):** NASA GIBS Blue Marble (`Level8`), OpenStreetMap (para detalle a zoom alto > 8) y capa WMS oficial del INEI.

### 5.2. Las 3 Pestañas Principales
1. **Armonizado (Vista científica):**
   - Mapa coroplético de hexágonos H3 Res 6 (~36 km²) con opacidad proporcional al paso de la rampa (`0.5 + 0.07 * level`) y opción de superponer focos crudos encima.
   - Panel derecho con: resumen del rango elegido (actividad armonizada, hexágonos activos, días con actividad y temporada pico), tarjeta **"Mes en curso vs. mediana histórica"** (lectura verbal + signo + razón + percentil), calendario compacto año × mes (con divisor visual en 2012 y vista ampliada en tabla con el número exacto en cada celda), gráfico **Frecuencia por mes** (barras apiladas por nivel), gráfico **Por año** (con bandas de incertidumbre en `< 2012` y barras parciales punteadas en `2000`/`2026`), **Año frente a un año normal** (línea sobre banda `P10–P90`), **Antes y después de armonizar** (comparación crudo vs. armonizado + error holdout) y **Ranking de departamentos** ordenable por hexágonos, focos o eventos.
2. **Focos crudos (Dato bruto sin armonizar):**
   - Oculta el panel de estadísticas y expande el mapa a todo lo ancho.
   - Dibuja cada detección con su buffer físico (`375 m` VIIRS, `1 km` MODIS) en un `<canvas>` de alto rendimiento (`BufferLayer`), en dos modos:
     - **Disueltos por día** (por defecto): composición en lienzo auxiliar sin bordes internos dentro del mismo día y contorno nítido de la unión total.
     - **Superpuestos**: cada círculo translúcido individual.
   - Al hacer clic en un foco, muestra su ficha y agrupa eventos diarios en el navegador (`fireEvents.ts` → `groupDailyEvents`) con la misma regla exacta que `src/etl/fire_events.py`, permitiendo volar al mayor evento del rango.
   - Muestra tope de 30,000 focos en pantalla (avisando si se trunca, mientras las estadísticas y la línea de tiempo cuentan todos los eventos).
3. **Alerta temprana (Predicción 2027):**
   - Mapa coroplético jerárquico que baja automáticamente un nivel desde el filtro global (`Perú → 25 departamentos → 196 provincias → 1,890 distritos`).
   - **Matriz de riesgo de 2 ejes (`riskPanel.ts`):**
     - **Probabilidad** de al menos 1 evento (etiqueta de tarjeta y color de barras): Alta `>= 67%`, Media `>= 33%`, Baja `>= 5%`, Casi nula `< 5%`.
     - **Impacto** (eventos esperados redondeados — color del mapa y del top 5): Bajo `0–20`, Medio `21–50`, Alto `51–100`, Crítico `> 100` (sin color si probabilidad es casi nula).
   - Muestra eventos esperados (o probabilidad si redondea a 0), frase en lenguaje llano, contraste contra el mismo mes del último año completo observado, rango del 80 %, años históricos con fuego, 12 barras mensuales clicables, top 5 de subunidades y bloque **"¿Es confiable?"** con las métricas fuera de muestra.

### 5.3. Selección de Área, Línea de Tiempo, Exportación y Accesibilidad
- **Selección de área:** Selectores en cascada INEI (`Departamento › Provincia › Distrito`), dibujo interactivo en mapa (**caja**, **polígono** y **mano alzada** con simplificación Douglas-Peucker a máx. 300 vértices), formulario manual de coordenadas N/S/O/E y botón **Limpiar filtros**.
- **Línea de tiempo (`RangeBrush`):** Fondo con la serie diaria de `9,510` días, marca del inicio de VIIRS (`2012-01-20`), ventana arrastrable y zoom de años a días (`MIN_VIEW_DAYS = 14`; cambia automáticamente de selección por meses a selección por días bajo `730` días visibles).
- **Exportaciones:**
  - **CSV:** Focos de calor (`hotspots.csv`), celdas-día armonizadas (`export.csv`) y análisis mensual (`calendar.csv`).
  - **PNG (`exportPng.ts`):** Exportación en el navegador a escala **3×** de cualquier gráfica SVG y de la matriz completa del calendario con título, subtítulo, pie y colores del tema activo.
- **Accesibilidad visual verificada (`check:palette`):** Rampa secuencial de 6 pasos amarillo → rojo (`--fire-1 #fff1a8` a `--fire-6 #8e1100`) con contraste de texto de **5.3:1 a 15.3:1** (mínimo WCAG AA `4.5:1`), luminosidad $L^*$ estrictamente decreciente (`95 → 84 → 72 → 59 → 45 → 30`) y distancia perceptual $\Delta E$ en OKLab mínima de `10.2` (normal), `11.6` (protanopia) y `9.3` (deuteranopia y tritanopia).

---

## 6. Infraestructura, Despliegue en Producción y Pruebas

- **Contenedor único (`Dockerfile`):** Multi-stage build (`node:22-slim` compila `web/dist` → `python:3.12-slim` con `uv` instala `functions/` y empaqueta `data/processed/`). Ejecuta con usuario sin privilegios y `DUCKDB_MEMORY_LIMIT=1GB`.
- **Google Cloud Run (`nasat-fire-calendar`, `us-east1`, servicio `fire-calendar`):** `1 vCPU`, `2 GiB RAM`, `0–3` instancias, concurrencia `40`, timeout `900 s` (soporta exportaciones completas de 2.17 M focos).
- **CI/CD en GitHub Actions (`.github/workflows/deploy.yml`):** Autenticación sin secretos mediante **OIDC + Workload Identity Federation** (`github-deployer`). Al fusionar a `main`, ejecuta primero `pytest` y `npm run typecheck` antes de desplegar y validar `/` y `/api/v1/meta`.
- **Pruebas automatizadas verificadas:**
  - `functions/`: **`27` pruebas** (`test_domain.py` + `test_api.py`) cubriendo reglas puras de dominio y todos los contratos HTTP contra los Parquet reales (`pytest -q`: **27 passed**).
  - `web/`: `npm run check:palette` aprobado y chequeo de tipos `tsc --noEmit` configurado en CI.

---

## 7. Resumen de Logros Cuantitativos y Límites Declarados

### Logros medidos
| Dimensión | Resultado verificado |
|---|---|
| **Datos limpios y unificados** | `2,439,271` registros crudos → **`2,168,246` focos limpios** (`1,090,622` celdas-día H3 Res 6; `1,134,478` eventos diarios) |
| **Reducción de error (Holdout 2021–2024 mensual)** | MAPE entre sensores: **`92.89%`** (crudo) / **`89.85%`** (celdas sin calibrar) → **`15.12%`** (armonizado), sesgo **`+4.02%`**, $r = \mathbf{0.9879}$ |
| **Reducción de error (Holdout 2021–2024 anual)** | MAPE anual: **`91.34%`** (crudo) / **`86.40%`** (sin calibrar) → **`5.59%`** (armonizado), $r = \mathbf{0.9522}$ |
| **Continuidad entre transiciones de satélites** | `2011 → 2012`: de `28,592.5` a `41,356.3` (evita el salto crudo `9,919 → 90,002`); estable ante `NOAA-20` (`2018`: `33,641.1`) y `NOAA-21` (`2023`: `42,165.0`) |
| **Cobertura territorial oficial (INEI)** | `25` departamentos, `196` provincias y `1,890` distritos indexados sobre H3 Res 6 (`Cusco 2024 = 9,508` focos) |
| **Alerta temprana 2027 (Holdout 2021–2025)** | Reducción de error de Brier vs. tasa única: **`47.7%`** (departamento), **`42.7%`** (provincia), **`33.2%`** (distrito); cobertura real del intervalo del 80%: **`83.3%` / `90.2%` / `96.4%`** (frente a `57.7% / 83.1% / 95.6%` con Poisson puro; dispersión `4.48 / 2.36 / 1.76`) |
| **Ejemplos de referencia en la app** | Cusco agosto 2027: **`141` eventos esperados** (`47–257`, total anual `~428.2`); Perú septiembre: **`3,198` eventos** (`2,191–4,297`) |

### Límites declarados con honestidad en la app y la API
1. Un foco de calor (`Hotspot`) o evento es una detección térmica satelital, **no** un incendio confirmado ni superficie quemada.
2. Ausencia de detección no implica ausencia de fuego (nubes y humo denso ocultan señal).
3. Datos previos a julio de 2002 (solo Terra) tienen menor cobertura horaria y se marcan con baja confianza/mayor incertidumbre.
4. En **Focos crudos** y **Ranking**, los conteos de focos/eventos no están armonizados entre eras satelitales; por eso solo se comparan años usando la serie armonizada.
5. En áreas con más de `30,000` focos en el rango, el mapa dibuja los más recientes (tope `50,000` en API), aunque las estadísticas resumen todos.
6. NASA GIBS Blue Marble solo ofrece detalle hasta zoom `8`; para detalle local se cambia a OpenStreetMap.
7. La predicción de Alerta Temprana es estrictamente estacional (Poisson / Poisson-Gamma sobre eventos MODIS históricos) y **no** utiliza pronósticos meteorológicos ni tendencias climáticas; en 2025–2026 los eventos MODIS descendieron por deriva orbital de Terra/Aqua.
