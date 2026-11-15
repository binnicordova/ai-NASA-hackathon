# 08 · Envío: página del proyecto y demo

Cierre: **domingo 15 de noviembre de 2026, 11:59 p. m.** Todo lo de este documento está listo para copiar; lo que va entre corchetes lo completa el equipo. Las cifras salen de `data/processed/` y de las pruebas de `functions/`, verificadas el 14 de noviembre.

El formulario global está en inglés, así que los textos para pegar van en inglés.

## Antes de enviar

- [ ] Todo confirmado en git y subido (`functions/`, `web/`, `src/etl/fire_events.py`, documentos).
- [x] App desplegada en un enlace público que abre en una ventana privada, sin registro.
- [x] Repositorio público (o enlace público al proyecto final).
- [ ] Los ocho campos de la página, completos y guardados.
- [ ] Demo de 7 diapositivas o video de 30 s como máximo, con enlace público.
- [ ] Uso de IA declarado. Referencias completas.
- [ ] Alguien ajeno al equipo entendió la demo sin explicación.

## Campos de la página del proyecto

### 1. Project name

`[Peru Burn Calendar]` (o el nombre que elija el equipo)

### 2. High-level summary

> Fire managers in Peru cannot compare this year's fire season with past ones, because the satellite record is split between two sensors that count differently: when VIIRS joined MODIS in 2012, raw hot spot counts for Peru jumped ninefold in a single year without any real change in fire. We built a web application that harmonizes 26 years of NASA FIRMS hot spots from MODIS and VIIRS into one comparable series and presents it as a burn calendar. Our method converts both sensors to a common unit (active grid-cell days), calibrates MODIS to VIIRS month by month, corrects for the growing number of VIIRS satellites, and validates the result on years held out of the calibration: the monthly disagreement between sensors falls from 89.9% to 15.1%. A user picks any area of Peru by department, by coordinates or by drawing on the map, picks a date range, and immediately sees whether the current month is normal for that place, which months and years concentrate fire, and how often each month has been highly active. Hot spots, the harmonized series, the analysis and every chart can be downloaded.

### 3. Link to project demo

`[enlace público a las 7 diapositivas o al video de 30 s]`

### 4. Link to final project

App: <https://fire-calendar-538134722054.us-east1.run.app> · Repositorio: <https://github.com/binnicordova/ai-NASA-hackathon>

### 5. Detailed project description

> **What it does.** Peru Burn Calendar is a web application that answers three questions for any area of Peru: when does this place burn, is this month normal, and can years be compared. It shows a year-by-month burn calendar from November 2000 to today, a map of harmonized fire activity for the selected month, a scrollable timeline of every month in the record, the current month against its historical median, the peak season, record years, and a department ranking. Everything can be downloaded: hot spots as CSV (one per row), harmonized activity as CSV, the monthly analysis as CSV, and each chart and the calendar as PNG. The interface is in Spanish and English.
>
> **How it works.** (1) Cleaning: low-confidence detections, archive/near-real-time duplicates and static heat sources (volcanoes, industry) are removed, leaving 2,168,246 hot spots. (2) Common unit: each detection is assigned to an H3 hexagonal cell of about 36 km²; a cell counts once per day no matter how many pixels fall in it, which removes most of the resolution difference between a 1 km MODIS pixel and a 375 m VIIRS pixel. (3) Calibration: over the years both sensors overlap, a monthly factor converts MODIS cell-days to "one VIIRS satellite" equivalents (from 3.4 in September to 7.6 in April, because small agricultural fires that only VIIRS sees vary by season); a second factor removes the inflation from having two and then three VIIRS satellites; a third handles the months when only Terra was flying. (4) Validation: factors fitted on 2012–2020 are tested on 2021–2024.
>
> **Results.** Raw hot spots for Peru go from 9,919 in 2011 to 90,002 in 2012; the harmonized series goes from 28,592 to 41,356, within normal year-to-year variation. On held-out years the MODIS-versus-VIIRS error drops from 89.9% to 15.1% by month and from 86.4% to 5.6% by year, with a 4% bias. The fire season is August to October, which concentrates about two thirds of a typical year's activity.
>
> **Honest limits, stated in the app.** A hot spot is not a confirmed wildfire. No observation (cloud, smoke) is not zero fire. Values before mid-2002, when only Terra was flying, are extrapolated and flagged as low confidence. The current month is compared with the same days of past years, not with full months. Departments use approximate outlines. The tool describes; it does not predict.
>
> **Benefits.** Emergency managers, land managers, firefighters and researchers get one consistent picture of when and where burning happens, can tell an unusual month from a normal one in seconds, and can take the data with them.
>
> **Architecture and tools.** Python (pandas, NumPy, SciPy, H3) for the harmonization pipeline; a headless service in Python with DuckDB and FastAPI, organised with domain-driven design, that any client can call; a web client in TypeScript with Vite and Leaflet, opening on a 3D globe that zooms into Peru. 19 automated tests check the domain rules and the service against the real data.

### 6. Use of Artificial Intelligence

> We used Claude (Anthropic), through Claude Code, as a development assistant. It was used to analyse the challenge statement and judging rules; to review and independently re-check the harmonized dataset produced by the team; to write the fire-event script, the backend service, the web client and their tests; and to draft documentation and this project page. `[Describir aquí qué hizo cada integrante con y sin IA, y cualquier otra herramienta de IA usada.]` The team downloaded the FIRMS data, designed and built the harmonization, decided the product, and reviewed and tested the results. The NASAT product logo (flame and wordmark) was generated with an AI image tool `[nombre de la herramienta de IA usada para el logo]`; it is not presented as NASA or Space Apps artwork. No other AI-generated images, video or audio are used in the project.

### 7. NASA data

> NASA FIRMS (Fire Information for Resource Management System) active fire data for Peru, November 2000 to November 2026: MODIS Collection 6.1 (Terra and Aqua), and VIIRS Collection 2 at 375 m from Suomi NPP, NOAA-20 and NOAA-21, in both standard (archive) and near-real-time versions. FIRMS is the single source of every number in the application. We also used the FIRMS documentation of data attributes, and the FIRMS API (area and data-availability services) to check which sensors are currently reporting. The default satellite basemap is NASA GIBS Blue Marble (shaded relief and bathymetry).

### 8. Space agency partner and other data · References

> Leaflet (BSD-2-Clause); OpenStreetMap map tiles (ODbL, © OpenStreetMap contributors); NASA GIBS imagery (Blue Marble, also wrapped on the opening 3D globe); DuckDB (MIT); FastAPI (MIT); Uvicorn (BSD-3-Clause); H3 by Uber (Apache-2.0); pandas, NumPy and SciPy (BSD-3-Clause); PyArrow (Apache-2.0); Vite (MIT); TypeScript (Apache-2.0). Colour palette, gradient, typography and the official NASA Space Apps Challenge logo used unaltered, per the NASA Space Apps Brand Guidelines (spaceappschallenge.org/brand); fonts Fira Sans and Overpass (SIL Open Font License, via Google Fonts). The heat ramp follows the sequential yellow-orange-red convention (ColorBrewer YlOrRd, Brewer & Harrower). Colour-blindness simulation used to check the colour ramp: Machado, Oliveira & Fernandes (2009), "A Physiologically-based Model for Simulation of Color Vision Deficiency", IEEE TVCG 15(6); perceptual distances in the OKLab colour space (Ottosson, 2020). `[Añadir aquí cualquier imagen, fuente o dato externo usado en las diapositivas.]`

## Demo: 7 diapositivas

Una idea por diapositiva. Las capturas se sacan de la app en español; las gráficas se bajan con su botón PNG.

| # | Título | Qué se ve | Qué se dice (una frase) |
|---|---|---|---|
| 1 | Peru Burn Calendar | Nombre, equipo, reto, captura de la app con el mapa y el calendario | 26 años de fuego en el Perú, en un solo registro comparable. |
| 2 | El problema | PNG "Antes y después de armonizar", solo el panel de arriba, o la app con "Focos crudos" | En 2012 los focos se multiplican por nueve: no hubo más fuego, hubo un sensor nuevo. |
| 3 | Para quién | Captura de la app en Cusco con la lectura "Por encima de lo habitual para sep" | Un gestor de emergencias necesita saber hoy si este mes es normal en su zona. |
| 4 | El método | Diagrama de cuatro pasos: limpiar → celdas-día → calibrar por mes → validar | Llevamos los dos sensores a una unidad común y calibramos MODIS contra VIIRS mes a mes. |
| 5 | La prueba | PNG "Antes y después de armonizar" completo, con 89.9% → 15.1% en grande | En años que el ajuste nunca vio, el error entre sensores baja de 89.9% a 15.1%. |
| 6 | La app | Tres capturas: dibujar un área, calendario con números, descargas | Área por mapa o coordenadas, rango de fechas, calendario, y todo se descarga. |
| 7 | Límites y siguiente paso | Lista corta de límites y dos pasos siguientes | Decimos lo que no sabemos; lo siguiente es actualizar a diario con FIRMS y bajar a nivel de distrito. |

Si se elige video (30 s como máximo): 5 s el salto de 2012 con "Focos crudos"; 8 s cambiar a "Armonizado"; 12 s elegir Cusco, dibujar un área, leer el veredicto del mes y abrir el calendario con números; 5 s descargar el CSV y cerrar con 89.9% → 15.1%.

## Lo que la app cubre del enunciado

| Pedido | Dónde está |
|---|---|
| Armonización validada, antes y después | Gráfica "Antes y después de armonizar" y botón Armonizado / Focos crudos |
| Elegir región en el mapa y por coordenadas | "Dibujar una caja en el mapa" (ratón o dedo) y campos Norte, Sur, Oeste, Este; también por departamento |
| Rango de fechas | Mes inicial y final, atajos, y botones en la línea de tiempo |
| Calendario desde inicios de los 2000 | "Calendario de quema, año × mes", con "Ver números" |
| Qué periodos tienen más fuego | "Temporada pico" y "Con qué frecuencia cada mes es activo" |
| Qué años tuvieron más quema | "Por año", con los tres años completos más altos |
| Mes actual frente a la mediana histórica | Lectura en palabras, razón y percentil del mes elegido |
| Rampas de color accesibles | Un solo tono cálido (rojo marciano a amarillo neón, paleta de Space Apps) con luminosidad siempre creciente; números en la vista ampliada, textos y signos además del color |
| CSV de los focos detectados | "Focos de calor (CSV)", un foco por fila |
| Descargar análisis y visualizaciones | "Análisis mensual (CSV)", "Actividad armonizada (CSV)" y botón PNG en cada gráfica y en el calendario |
| Anomalías frente a promedios multianuales | "… frente a un año normal", con mediana y rango habitual |

**Rampa y temas.** La aplicación sigue el tema claro u oscuro del dispositivo, con la paleta de NASA Space Apps. Los seis colores de la rampa son los mismos en ambos temas y solo cambia el sentido: más fuego es siempre el color más alejado del fondo (el más oscuro en el tema claro, el más brillante en el oscuro), y la leyenda "menos → más" está en cada vista.

Comprobación numérica (`npm --prefix web run check:palette`), hecha por simulación y no con personas:

| Visión | Luminosidad L* de los seis pasos | ΔE (OKLab) entre pasos contiguos |
|---|---|---|
| Normal | 30, 43, 56, 70, 82, 95 | 11.8 a 13.3 |
| Protanopía | 22, 34, 48, 65, 80, 93 | 10.3 a 14.5 |
| Deuteranopía | 34, 48, 61, 73, 84, 94 | 9.1 a 12.1 |
| Tritanopía | 32, 45, 56, 68, 81, 95 | 9.8 a 13.1 |

El número de cada celda tiene un contraste de 4.9:1 o más. Límite conocido: el paso más bajo de la rampa casi se funde con el fondo (1.1:1 en el tema claro, 1.7:1 en el oscuro), por eso las celdas con dato llevan un filo fino que las separa de las vacías.

Pendiente y fuera de lo que cubre el código: probar la rampa con personas con daltonismo, y el nivel de provincia y distrito (necesita límites oficiales).
