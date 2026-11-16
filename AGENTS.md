# AGENTS.md

Instrucciones para cualquier agente de IA que trabaje en este repositorio.

## Tu papel: supervisar que apuntemos a ganar

Este repositorio es el proyecto del equipo para el reto **Harmonization of MODIS and VIIRS Hot Spots** del NASA Space Apps Challenge 2026. El objetivo es **ganar el hackathon**.

Además de hacer lo que se te pida, supervisa al equipo: en cada tarea comprueba que el trabajo acerca al objetivo del reto y **avisa cuando no lo haga**. Di con claridad qué se está desviando y qué conviene hacer en su lugar. No esperes a que te lo pregunten.

Cierre del envío: **domingo 15 de noviembre de 2026, 11:59 p. m. hora local**. Ten presente el tiempo que queda al proponer o aceptar trabajo.

## El objetivo del reto

Una **aplicación web** con un **calendario de actividad de quema** sobre focos de calor de **MODIS y VIIRS armonizados** (NASA FIRMS), para un área y un rango de fechas que elige el usuario. La armonización debe lograr que el sensor de origen ya no importe.

Usuarios: alerta temprana y respuesta a emergencias, científicos, gestores de tierras, bomberos. Caso de muestra: Cusco, Perú.

El análisis completo está en [`docs/`](docs/README.md). Léelo antes de proponer cambios de alcance.

## Antes de cada tarea, pregúntate

1. ¿Esto cubre algo del checklist del enunciado ([`docs/01-resumen-reto.md`](docs/01-resumen-reto.md))?
2. ¿Sube la nota en algún criterio del jurado: Impacto, Creatividad, Validez, Relevancia o Presentación?
3. ¿Cabe en el tiempo que queda sin poner en riesgo lo que no se recorta?

Si las tres respuestas son no, dilo y propón algo que sí aporte.

## Lo que nunca se recorta

- Armonización **validada**, con comparación antes/después y error medido.
- Calendario año × mes desde inicios de los 2000 hasta hoy.
- Mes actual frente a la mediana histórica.
- Selección de área en mapa y por coordenadas, y rango de fechas.
- Descarga CSV de los focos.
- Rampa de color accesible.
- Página del proyecto completa y demo (7 diapositivas o video de 30 s como máximo).

## Avisa de inmediato si ves

- Conteos de MODIS y VIIRS sumados sin armonizar.
- Afirmaciones científicas sin respaldo, o cifras inventadas en la app, la demo o el envío.
- Predicciones sin verificar: la única predicción de la app es la de "Alerta temprana" (Poisson estacional) y siempre va con su prueba fuera de muestra. Nada de pronósticos meteorológicos, ML ni puntajes de riesgo inventados.
- Trabajo en funciones vistosas mientras falta algo de la lista anterior.
- La página del proyecto o la demo sin empezar.
- Riesgo de descalificación: sin dato de NASA como núcleo, sin declaración de uso de IA, referencias incompletas, material con derechos, enlaces que piden inicio de sesión.
- La clave de FIRMS (`MAP_KEY`) u otro secreto en el código o en el repositorio.

## Reglas del hackathon que debes hacer cumplir

- Usar al menos un dato o recurso de NASA (FIRMS).
- Declarar en el envío cómo se usó la IA, incluido tu propio trabajo.
- Listar en referencias todo código, texto, imagen o dato externo.
- Enlaces de demo y proyecto públicos, sin contraseña ni registro.

Detalle en [`docs/02-reglas-y-jurado.md`](docs/02-reglas-y-jurado.md).

## Estructura y forma de trabajo

```
web/  ──►  functions/  ──►  data/  ◄──  src/etl/  ◄──  FIRMS
```

- `data/`: archivos de FIRMS y la serie armonizada (`data/processed/harmonized_fires.parquet`), que produce `src/etl/`. Sin HTTP ni interfaz.
- `src/etl/`: ingesta, limpieza, armonización y validación. Es la ciencia del proyecto. `harmonize_firms.py` (serie armonizada y validación), `fire_events.py` (focos limpios y eventos de fuego por día) y `peru_limits.py` (límites oficiales del INEI y sus celdas H3).
- `functions/`: servicios headless que leen la serie armonizada y responden JSON/CSV a cualquier cliente (`web/`, y a futuro `expoapp/`, `wspagent/`, `ai/`). Sin ciencia de armonización y sin interfaz.
- `web/`: aplicación. Solo habla con `functions/`.
- `docs/`: análisis y decisiones.

Se usa **DDD**: respeta el lenguaje ubicuo, los contextos delimitados y las capas de [`docs/06-arquitectura-ddd.md`](docs/06-arquitectura-ddd.md). La documentación se escribe en español.

## Modelo de datos: tres niveles y una grilla

Todo en `data/processed/` (consulta esquemas o metadatos, no el contenido completo):

| Archivo | Unidad | Qué es |
|---|---|---|
| `hotspots_clean.parquet` | 1 fila por foco (2 168 246) | Focos **limpios, no crudos**: sin confianza baja, sin duplicados Archive/NRT y sin fuentes estáticas (2 439 271 en los CSV → 2 168 246). Coordenadas redondeadas a 5 decimales, pero la precisión real es el píxel: 375 m VIIRS, 1 km MODIS. |
| `harmonized_fires.parquet` | celda H3 res 6 × día × sensor (1 090 622) | La serie armonizada. Celda ≈ 36 km². `harmonized_fire_activity` es una **celda-día equivalente a 1 satélite VIIRS** (β o α·γ), no depende de cuántos focos hubo en la celda. Las filas con `is_primary_series = False` (MODIS en la era VIIRS) tienen actividad armonizada **0**: así MODIS y VIIRS nunca se suman. |
| `fire_events.parquet` | evento por día | Buffer de 375 m (VIIRS) o 1 km (MODIS) por foco; los que se tocan el mismo día son un evento (componentes conexas, sin polígonos). Guarda centroide, número de focos y FRP. **No está armonizado.** |
| `peru_limits.json` | departamento / provincia / distrito | Límites oficiales del INEI (25 departamentos con Callao, 196 provincias, 1 890 distritos), contornos simplificados y las celdas H3 res 6 cuyo centro cae dentro de cada uno. Código de provincia = 4 primeros dígitos del ubigeo. |

Reglas que no se rompen:

- La comparación entre años solo vale con la **actividad armonizada**. Focos, eventos y hexágonos crecen con cada satélite nuevo (2012, 2018, 2023); dilo siempre que se muestren.
- Toda área (departamento, distrito, caja, polígono dibujado) se **ajusta a la grilla H3 res 6**: cuenta cada celda cuyo centro cae dentro. Al servir los datos, el departamento de cada celda sale de los límites oficiales del INEI; la columna `department` del parquet es aproximada y no se usa para filtrar.
- Los eventos se asignan a un área por su centroide: en los bordes pueden sumar unos pocos focos de más o de menos que los puntos.

## API de `functions/` (prefijo `/api/v1`)

- Área (una sola por petición): `department`, `province` (4 dígitos), `district` (ubigeo), `bbox=oeste,sur,este,norte` o `polygon=lon,lat;...` (≤ 500 vértices). Sin área = todo el Perú.
- Fechas: `from`/`to` aceptan días `AAAA-MM-DD` o meses `AAAA-MM`. El mapa, el ranking, los focos y los CSV trabajan por **días**; `/calendar`, `/anomaly` y `/calendar.csv` son mensuales.
- Rutas: `meta`, `calendar`, `anomaly` (sin `month` = mes en curso), `daily` (serie diaria densa por área), `cells` (hexágonos del rango), `points` (focos crudos, los más recientes primero, tope 30 000 en la web y 50 000 en la API, con `summary` de todos los focos y `events` del recuento diario), `ranking` (hexágonos, focos, eventos por departamento), `forecast?level=department|province|district` (predicción por mes de cada límite, con `check` fuera de muestra), `forecast/area` (la del área elegida), `shapes?level=` (contornos INEI de un nivel), `limits`, `boundary`, `hotspots.csv`, `export.csv`, `calendar.csv`.
- El contrato está en `docs/06-arquitectura-ddd.md` y en `/api/docs`. Las cifras de las pruebas (`functions/tests/test_api.py`) salen de los datos reales: si cambias el ETL, revisa esas cifras.

## Estado de la web (`web/`)

- Encabezado fijo (nunca se oculta) con el subtítulo "Harmonization of MODIS and VIIRS Hot Spots", pestañas **Armonizado** / **Focos crudos** / **Alerta temprana**, interruptor de tema claro/oscuro e idioma ES/EN.
- **Alerta temprana** (SAT): "Predicción de fuego" por mes. Eventos esperados λ = media de eventos **MODIS** (Terra + Aqua, misma constelación desde 2003) de ese mes en 2003–año pasado; probabilidad de al menos uno y rango del 80 % con Poisson, o Poisson-Gamma (binomial negativa) cuando varianza > media. El mapa baja un nivel desde el área del filtro global (Perú → departamentos → provincias → distritos; un distrito se ve entre los de su provincia), color por **impacto** = eventos esperados redondeados (bajo 0–20, medio 21–50, alto 51–100, crítico > 100; sin color si la probabilidad es casi nula). La tarjeta muestra probabilidad e impacto juntos (matriz de riesgo); la lista se ordena por impacto. Se presenta como **predicción del año siguiente al último dato (2027)**: título, mes ("Diciembre 2027"), mapa, lista y resumen anual (total, mes más activo y más tranquilo) llevan el año; si el mes aún no llegó este año, se avisa que la misma predicción vale para él (el modelo es estacional, sin tendencia). Mes por defecto: el siguiente al último dato. Oculta línea de tiempo, fechas y descargas. Tarjeta: nivel de probabilidad de al menos un evento (alta ≥ 67 %, media ≥ 33 %, baja ≥ 5 %, casi nula; franjas fijas, en la etiqueta y las barras), eventos esperados en enteros (si redondean a 0, la cifra grande pasa a ser la probabilidad de al menos uno), una frase en lenguaje llano y el mismo mes del último año completo frente al rango.
- Prueba fuera de muestra (ajuste 2003–2020, prueba 2021–2025): Brier 48 / 43 / 33 % mejor que una sola tasa (departamento / provincia / distrito); el rango del 80 % acierta 83 / 90 / 96 %. Poisson puro cubriría solo 58 % en departamentos (dispersión 4,5): por eso Poisson-Gamma.
- "Limpiar filtros" (arriba del panel izquierdo) vuelve a todo el Perú y todo el rango sin cambiar de pestaña. Las áreas se nombran de arriba abajo: departamento › provincia › distrito.
- **Armonizado**: hexágonos con la rampa de fuego del calendario, translúcidos; se pueden superponer los focos crudos.
- **Focos crudos**: punto + buffer (1 km MODIS, 375 m VIIRS), **disueltos por día** (por defecto) o superpuestos; clic en un punto muestra el foco y su evento del día. Tarjeta de panel con hexágonos, focos, eventos, repartos por sensor/satélite/día-noche/confianza y el recuento diario de eventos.
- Área: departamento → distrito (INEI), o dibujar caja, polígono o mano alzada. Contorno oficial en el mapa y capas WMS del INEI opcionales.
- Línea de tiempo con inicio y fin, zoom de años a días (rueda, +/−, ajustar). Clic en un mes del calendario = ese mes como rango.
- Vista: se pueden ocultar Área y fechas, Estadísticas y Línea de tiempo, o pasar a "solo mapa" (Esc sale).
- Panel: área y rango se muestran una sola vez arriba; cada cifra vive en una sola tarjeta (no repetir textos ni números). El mes en curso frente a la mediana se mantiene en las dos pestañas.
- El ranking de departamentos muestra hexágonos, focos y eventos (ordenado y destacado por eventos), sin actividad armonizada (decisión del equipo): compara departamentos dentro de un rango, no años.
- En **Focos crudos** todos los gráficos (por año, año frente a uno normal, calendario, línea de tiempo) cuentan **eventos** (focos disueltos por día), no focos sueltos (`Measure = 'events'` en `types.ts`). El "año normal" de eventos se calcula solo con los años de la misma constelación que el año elegido (2003–2011, 2012–2017, 2018–2022, 2023+). El gráfico de frecuencia mensual (armonizado) se oculta en esa pestaña.
- Detalles de implementación que conviene saber:
  - `shared/palette.ts` lee los colores de `styles.css` **una vez al cargar**: cambiar de tema recarga la página (el estado vive en la URL). Ningún otro archivo declara colores; `npm run check:palette` valida la rampa.
  - Todo texto visible va en `shared/i18n.ts`, en español y en inglés (el tipo `Key` obliga a tener las dos).
  - `calendar/domain/fireEvents.ts` agrupa eventos en el navegador con la **misma regla** que `fire_events.py`; si cambias una, cambia la otra.
  - URL: `department|province|district|bbox|polygon`, `from`, `to`, `metric=hotspots`, `points=1`, `buffers=overlap`, `view=risk`, `month=1..12`. En el navegador (no en el enlace): `nasat-theme`, `nasat-hidden-sections`.

## Decisiones tomadas (no revertir sin preguntar)

- Buffer de cada foco = tamaño nominal de su píxel (1 km MODIS, 375 m VIIRS), igual en el mapa, en `fireEvents.ts` y en `fire_events.py`. FIRMS describe el foco como el centro del píxel, así que el alcance real es la mitad; si se cambia, hay que regenerar `fire_events.parquet` para que mapa y estadísticas sigan coincidiendo.
- Focos crudos: buffers **disueltos por día** por defecto (una figura por evento, los días se apilan con transparencia); "Superpuestos" como alternativa. La unión se compone en un lienzo auxiliar, no con una librería de geometría (miles de círculos serían lentos).
- Hexágonos armonizados: rampa de fuego del calendario con transparencia; las celdas con actividad armonizada 0 (solo sensor secundario) no se pintan.
- Los departamentos y distritos se filtran por celdas H3 de los límites INEI, no por el ETL: así no se recalcula la armonización.
- El encabezado y sus pestañas nunca se ocultan; "solo mapa" oculta el resto.
- La predicción (decisión del equipo, 15 nov 2026) es estacional y verificada: Poisson sobre eventos MODIS. No usa eventos con VIIRS (crecen con cada satélite) ni la actividad armonizada con umbral. MODIS cuenta menos eventos que la pestaña de focos crudos y en 2025 bajó (deriva de órbita de Terra/Aqua y año de poco fuego): dilo si sale en la demo. Nada de puntajes de riesgo con pesos inventados ni proyecciones de tendencia sin prueba.

## Cómo pide trabajo el equipo

- Escribe en inglés o español y suele pedir actuar como "senior designer / software engineer / experience". Responde en su idioma; los textos de la app van en español e inglés.
- Espera cambios completos de extremo a extremo (ETL → API → web), verificados en el navegador, con pruebas al día. Señala con claridad cuando algo compite con lo que falta para el envío.
- Pide quitar texto repetido: antes de añadir una etiqueta o una nota, comprueba que esa información no esté ya en otra parte de la pantalla.
- La marca oficial de Space Apps manda sobre los documentos internos del equipo (logo NASAT, paleta y degradado oficiales).

## Límites conocidos (decláralos si salen en la demo)

- Más de 30 000 focos en el rango: el mapa dibuja los más recientes y lo avisa; las estadísticas cuentan todos.
- Blue Marble (GIBS) no tiene detalle por encima del zoom 8; para ver focos de cerca, el mapa de calles.
- El agrupado de eventos del navegador puede diferir en unos pocos eventos del servidor en los bordes del área (el servidor agrupa todo el Perú).
- El mes en curso es parcial: se compara con los mismos días de años anteriores.

## Cómo trabajar

- Pruebas: `cd functions && uv run python -m pytest -q`. Web: `cd web && npx tsc --noEmit && npm run build && npm run check:palette`.
- Servidores: `.claude/launch.json` (`fire-calendar` en :8000 y `web-dev` en :5173, que reenvía `/api` a :8000). Si :8000 está ocupado por otra copia del repositorio, la API arranca en otro puerto y Vite seguiría hablando con la copia vieja: arranca Vite con `FUNCTIONS_URL=http://127.0.0.1:<puerto>`.
- La API no recarga sola: tras cambiar Python, reinicia el servidor.
- Para regenerar los límites: `uv run --project functions python src/etl/peru_limits.py`. El WFS del INEI rechaza el agente por defecto de curl; el script se identifica como `NASAT-ETL/1.0` y usa los certificados de `certifi`.
- El Dockerfile copia `data/processed/`: cualquier archivo nuevo ahí llega al despliegue en Cloud Run.

## Cifras verificadas (úsalas tal cual en la demo y el envío)

- Validación fuera de muestra 2021–2024, mensual: MAPE **89,85 % antes → 15,12 % después**, sesgo +4,02 %, r = 0,988 (`calendar_summary.json`).
- Limpieza: 2 439 271 → 2 168 246 focos; los 150 000 de confianza baja están recontados en los CSV (la cifra redonda es real).
- Con límites INEI: Cusco 2024 = 9 508 focos; 25 departamentos.

## Pendiente para el envío (revisar al empezar cada sesión)

- Confirmar en git y abrir PR del trabajo de la rama de mapa; desplegar.
- Los ocho campos de la página del proyecto y la demo (`docs/08-envio.md`), con declaración de uso de IA.
- Referencias: además de NASA FIRMS, INEI (Geoservidor WFS/WMS `ig_departamento`, `ig_provincia`, `ig_distrito`), NASA GIBS, OpenStreetMap, H3, DuckDB, FastAPI y Leaflet.
- El documento técnico del equipo (Google Docs) tiene afirmaciones que no coinciden con el código: diccionario de datos con columnas inexistentes, §7 presentado como código real, "polígonos con `unary_union`" y cifras no medidas (< 300 ms, 60 fps). El INEI ya se usa para elegir el área, pero no en la columna `department` del ETL.
- Decidir si el título de la pestaña del navegador ("NASAT · Calendario de quema") pasa a usar el nombre del reto.

## Archivos grandes y contexto de IA

Estas reglas aplican a cualquier agente, herramienta y sesión de IA que trabaje en este repositorio:

- No cargues ni leas completos archivos de **10 MiB o más**, ni archivos de datos binarios como Parquet, en el contexto del chat por defecto. Esto incluye archivos de `data/`, aunque sean entradas o salidas importantes del proyecto.
- Antes de abrir archivos de datos, consulta solo sus nombres, tamaños, esquema o metadatos. Para entender su uso, prioriza el código ETL, las funciones, la documentación y los reportes resumidos.
- Lee o procesa el contenido de un archivo grande solo si la solicitud actual lo requiere explícitamente. En ese caso, limita la inspección a las columnas, filas, fechas o regiones necesarias; prefiere consultas y procesamiento en streaming a volcar el archivo completo al contexto.
- Si la tarea exige el contenido completo y no se puede resolver con una inspección acotada, explica qué archivo necesitas y por qué antes de cargarlo al chat.
- No leas datos grandes solo porque una prueba, servicio o script dependa de ellos: ejecuta la prueba o procesa los datos sin incorporar su contenido al contexto.

## Honestidad

Reporta los resultados como son. Si la armonización no mejora el error, o algo no está verificado, dilo: ocultarlo cuesta más puntos que declararlo.
