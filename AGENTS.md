# AGENTS.md

Instrucciones para cualquier agente de IA que trabaje en este repositorio.

## Empieza aquí (estado al 15 nov 2026, 22:50)

- **App en producción**: <https://nasat.space> y <https://fire-calendar-538134722054.us-east1.run.app> (Cloud Run, proyecto `nasat-fire-calendar`, `us-east1`). Sirve lo que hay en `main`.
- **Hecho y fusionado** (PR #8, #9 y #10): armonización validada, calendario, mes frente a la mediana, áreas oficiales del INEI (departamento › provincia › distrito, o dibujadas), rangos por días, focos crudos con buffers disueltos en eventos, descargas CSV/PNG, **Alerta temprana** (predicción de fuego 2027) y README con una captura por criterio del reto.
- **Falta para el envío** (no es código): los ocho campos de la página del proyecto, la demo (video de 30 s o 7 diapositivas), la declaración de uso de IA y las referencias. Borradores en [`docs/08-envio.md`](docs/08-envio.md). Si piden más funciones antes del cierre, recuérdalo.
- **Cierre**: domingo 15 de noviembre de 2026, 11:59 p. m. hora local. Si ya pasó, no toques nada que cambie lo enviado (app desplegada, README, enlaces) sin que el equipo lo pida de forma explícita.
- Antes de proponer trabajo, revisa la sección "Pendiente" del final y `git log --oneline -5 origin/main`.

## Tu papel: supervisar que apuntemos a ganar

Este repositorio es el proyecto del equipo para el reto **Harmonization of MODIS and VIIRS Hot Spots** del NASA Space Apps Challenge 2026. El objetivo es **ganar el hackathon**.

Además de hacer lo que se te pida, supervisa al equipo: en cada tarea comprueba que el trabajo acerca al objetivo del reto y **avisa cuando no lo haga**. Di con claridad qué se está desviando y qué conviene hacer en su lugar. No esperes a que te lo pregunten. Ten presente el tiempo que queda al proponer o aceptar trabajo.

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
- Predicciones sin verificar: la única predicción de la app es la de **Alerta temprana** (Poisson estacional) y siempre va con su prueba fuera de muestra. Nada de pronósticos meteorológicos, ML ni puntajes de riesgo con pesos inventados.
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

## Estructura

```
web/  ──►  functions/  ──►  data/  ◄──  src/etl/  ◄──  FIRMS, INEI
```

- `data/`: archivos de FIRMS y lo que produce `src/etl/` en `data/processed/` (versionado en git y copiado a la imagen de Cloud Run). Sin HTTP ni interfaz.
- `src/etl/`: la ciencia del proyecto. `harmonize_firms.py` (serie armonizada y validación), `fire_events.py` (focos limpios y eventos de fuego por día), `peru_limits.py` (límites oficiales del INEI y sus celdas H3) y `firms_tail.py` (la cola de datos nuevos, ver más abajo).
- `jobs/tail/` e `infra/`: imagen del job de la cola y `infra/setup.sh`, que crea el bucket, el job, el Scheduler y los permisos en Google Cloud.
- `functions/`: servicios headless (Python, DuckDB, FastAPI) que leen `data/processed/` y responden JSON/CSV a cualquier cliente. Sin ciencia de armonización y sin interfaz. Única excepción: `district_sheet/` sirve la ficha del distrito en su dirección legible (la página compilada con su HTML para buscadores y vistas previas), `sitemap.xml` y `robots.txt`, y dibuja la imagen de vista previa con Pillow.
- `web/`: aplicación (Vite, TypeScript, Leaflet). Solo habla con `functions/`.
- `docs/`: análisis y decisiones. `docs/img/`: capturas del README.

Se usa **DDD**: respeta el lenguaje ubicuo, los contextos delimitados y las capas de [`docs/06-arquitectura-ddd.md`](docs/06-arquitectura-ddd.md) (`shared/kernel` → `domain` → `application` → `infrastructure` / `interfaces`). Las reglas viven en `domain/services.py`; los presentadores solo traducen. La documentación y los comentarios se escriben en español.

## Modelo de datos: tres niveles y una grilla

Todo en `data/processed/` (consulta esquemas o metadatos, no el contenido completo):

| Archivo | Unidad | Qué es |
|---|---|---|
| `hotspots_clean.parquet` | 1 fila por foco (2 168 246) | Focos **limpios, no crudos**: sin confianza baja, sin duplicados Archive/NRT y sin fuentes estáticas (2 439 271 en los CSV → 2 168 246). Coordenadas a 5 decimales, pero la precisión real es el píxel: 375 m VIIRS, 1 km MODIS. |
| `harmonized_fires.parquet` | celda H3 res 6 × día × sensor (1 090 622) | La serie armonizada. Celda ≈ 36 km². `harmonized_fire_activity` es una **celda-día equivalente a 1 satélite VIIRS** (β o α·γ). Una celda-día MODIS vale ~3,4–5,6 (MODIS ve solo los fuegos más grandes) y una VIIRS ~0,5–1 (percentiles 10–90). Las filas con `is_primary_series = False` (MODIS en la era VIIRS) valen **0**: MODIS y VIIRS nunca se suman. |
| `fire_events.parquet` | evento por día | Buffer de 375 m (VIIRS) o 1 km (MODIS) por foco; los que se tocan el mismo día son un evento (componentes conexas). Centroide, focos, FRP. `sensor_set = 'all'` (todos los sensores) o `'modis'` (solo MODIS, la base de la predicción). **No está armonizado.** |
| `peru_limits.json` | departamento / provincia / distrito | Límites oficiales del INEI (25 departamentos con Callao, 196 provincias, 1 890 distritos): contornos simplificados y celdas H3 res 6 cuyo centro cae dentro. Código de provincia = 4 primeros dígitos del ubigeo. Los nombres de provincias y distritos vienen del INEI sin tildes (`La Convencion`). |

Reglas que no se rompen:

- La comparación entre años solo vale con la **actividad armonizada**. Focos, eventos y hexágonos crecen con cada satélite nuevo (2012 S-NPP, 2018 NOAA-20, 2023 NOAA-21); dilo siempre que se muestren.
- Toda área se **ajusta a la grilla H3 res 6**: cuenta cada celda cuyo centro cae dentro. El departamento de cada celda sale de los límites del INEI al cargar la API; la columna `department` del parquet es aproximada y no se usa para filtrar.
- Los eventos se asignan a un área por su centroide: en los bordes pueden sumar unos pocos focos de más o de menos que los puntos.

## Datos al día: base + cola

La base de `data/processed/` llega hasta el día anterior al corte de `base_manifest.json` (hoy 2026-11-12); **no se recalcula**. Lo posterior vive en una cola pequeña en `gs://nasat-fire-calendar-data/tail/` que el job `fire-tail` (Cloud Run Job, lanzado por Cloud Scheduler cada 15 min) rehace con `src/etl/firms_tail.py`:

- Mira el ETag de los tres feeds públicos de FIRMS; si no cambiaron (se regeneran una vez por hora), termina. Si cambiaron, pide a la API de área (NRT: MODIS, NOAA-20, NOAA-21) los días desde el corte, **recorta a Perú con las celdas del INEI** (la caja de la API trae vecinos), limpia y armoniza con el mismo código (`harmonize_daily`, `points_frame`, `build_events`) y los factores congelados de `frozen_params.json`, valida y publica `v=<versión>/` y, al final, `latest.json`.
- `functions/` une base (días < corte) y cola (días ≥ corte) con `FIRE_TAIL_URI` y cambia de gateway en caliente (`ReloadingGateway`, revisa cada 120 s al atender peticiones). Sin la variable, sirve solo la base. `/api/v1/meta` trae `dataUpdatedAt` y `tail`.
- La `MAP_KEY` vive en Secret Manager (`firms-map-key`), nunca en el repositorio.
- Si cambias `harmonize_firms.py`, regenera `frozen_params.json` (la corrida completa lo escribe) y comprueba que la reconstrucción completa siga igual a la base.
- Los últimos ~3 meses son NRT y provisionales: NASA los reemplaza por datos estándar (SP). La cola aún no hace esa restitución: si la ventana NRT deja de cubrir el corte, el job falla a propósito (hay que restituir con SP).
- Cada celda-día se calcula sola con los factores congelados, así que agregar días no cambia los anteriores (comprobado). Evaluación y números en [`docs/10-automatizacion-datos.md`](docs/10-automatizacion-datos.md).

## API de `functions/` (prefijo `/api/v1`)

- Área (una sola por petición): `department` (nombre), `province` (4 dígitos), `district` (ubigeo), `bbox=oeste,sur,este,norte` o `polygon=lon,lat;...` (≤ 500 vértices). Sin área = todo el Perú.
- Fechas: `from`/`to` aceptan días `AAAA-MM-DD` o meses `AAAA-MM`. Mapa, ranking, focos y CSV trabajan por **días**; `/calendar`, `/anomaly` y `/calendar.csv` son mensuales.
- Rutas:
  - `meta`, `limits` (departamentos, provincias y distritos), `boundary` (contorno de un área oficial), `shapes?level=` (contornos de todo un nivel).
  - `calendar`, `anomaly` (sin `month` = mes en curso), `daily` (serie diaria densa), `cells` (hexágonos del rango), `ranking` (hexágonos, focos y eventos por departamento).
  - `points`: focos crudos, los más recientes primero (tope 30 000 en la web, 50 000 en la API), con `summary` de todos y `events` del recuento diario.
  - `forecast?level=department|province|district`: predicción por mes de cada límite (`expected`, `pAny`, `low`, `high`) y `check` fuera de muestra, con `bands` (calibración: por franja de probabilidad, lo que dijo y lo que pasó). `forecast/area`: la del área elegida, con `history` (eventos de ese mes, año por año, 2003–año pasado), `inRange`, `ifAny` (rango del 80 % si hay fuego) y su propio `check` hecho solo en esa área.
  - `hotspots.csv`, `export.csv`, `calendar.csv`.
  - `preview/district/<ubigeo>.png` (`?lang=en`): imagen de 1200 × 630 de la ficha del distrito. Fuera del prefijo: `/incendios/<departamento>/<provincia>/<distrito>` y `/en/wildfires/…`, la ficha imprimible; `/d/<ubigeo>` (`?lang=en`) redirige (301) a ella, igual que una dirección con mayúsculas o tildes; con un distrito que no existe, la misma página con 404. `/sitemap.xml` (portada + 1 890 fichas × 2 idiomas, con hreflang) y `/robots.txt` (sin `/api/` salvo las vistas previas).
- El contrato está en `docs/06-arquitectura-ddd.md` y en `/api/docs`. Las cifras de `functions/tests/test_api.py` salen de los datos reales: si cambias el ETL, revisa esas cifras.

## La web por pestañas (`web/`)

Común a las tres:

- Encabezado fijo (nunca se oculta) con el subtítulo "Harmonization of MODIS and VIIRS Hot Spots", las pestañas, tema claro/oscuro e idioma ES/EN.
- Panel izquierdo: **Limpiar filtros** (vuelve a todo el Perú y todo el rango, sin cambiar de pestaña); área por departamento › provincia › distrito (INEI), o dibujar caja, polígono o mano alzada, o coordenadas. Las áreas se nombran de arriba abajo (`Cusco › La Convencion › Echarate`).
- Panel derecho (Armonizado y Alerta temprana): área y rango una sola vez arriba; cada cifra vive en una sola tarjeta. El mes en curso frente a su mediana aparece en las dos.
- Vista: se pueden ocultar Área y fechas, Estadísticas y Línea de tiempo, o pasar a "solo mapa" (Esc sale).

**Armonizado** (la vista científica):

- Hexágonos con la rampa de fuego del calendario, translúcidos; las celdas con actividad armonizada 0 no se pintan. Se pueden superponer los focos crudos.
- Tarjetas: rango elegido, frecuencia por mes, por año, año frente a uno normal, calendario año × mes, antes y después de armonizar, ranking de departamentos.
- Línea de tiempo con inicio y fin, zoom de años a días. Clic en un mes del calendario = ese mes como rango.

**Focos crudos** (lo que vio el satélite, sin armonizar):

- Es dato bruto: **sin panel de estadísticas ni gráficos** (decisión del equipo). Solo el mapa a todo lo ancho, el panel de área y fechas y la línea de tiempo.
- Punto + buffer (1 km MODIS, 375 m VIIRS), **disueltos por día** (por defecto) o superpuestos; clic en un punto muestra el foco y su evento del día.
- La línea de tiempo cuenta **eventos** (focos disueltos por día), no focos sueltos (`Measure = 'events'` en `calendar/domain/types.ts`). El código de gráficos por eventos (año normal por constelación, `CONSTELLATION_ERAS` en `charts.ts`) queda para el calendario ampliado y por si el panel vuelve.
- La tarjeta "Focos crudos en el rango" (`#rawCard`) solo aparece en Armonizado al superponer los focos.
- El ancho del mapa depende de la pestaña: `main.ts` aplica `.tab-raw` desde la URL **antes** de crear el mapa y llama a `map.resize()` al cambiar de pestaña (si no, Leaflet y el lienzo de los focos quedan con el tamaño viejo).

**Alerta temprana** (predicción de fuego 2027):

- Modelo (`functions/.../domain/services.py`: `month_forecast`, `forecast_check`; caso de uso `GetFireForecast`): para cada mes, λ = media de eventos **MODIS** de ese mes en 2003–año pasado. Probabilidad de al menos uno y rango del 80 % con Poisson, o Poisson-Gamma (binomial negativa, misma media) si varianza > media.
- Se presenta como **predicción del año siguiente al último dato (2027)**: título, mes ("Agosto 2027"), mapa, lista y resumen anual llevan el año. Es estacional, sin tendencia: si el mes aún no llegó este año, la tarjeta avisa que la misma predicción vale para él. Mes por defecto: el siguiente al último dato.
- Dos ejes, como una matriz de riesgo (umbrales en `web/src/calendar/ui/riskPanel.ts`):
  - **Probabilidad** de al menos un evento: alta ≥ 67 %, media ≥ 33 %, baja ≥ 5 %, casi nula < 5 %. Etiqueta de la tarjeta y color de las barras.
  - **Impacto** = eventos esperados redondeados: bajo 0–20, medio 21–50, alto 51–100, crítico > 100. Color del mapa y de la lista; sin color si la probabilidad es casi nula.
- El mapa baja un nivel desde el área del filtro global: Perú → departamentos, departamento → provincias, provincia → distritos; un distrito se ve entre los de su provincia. Clic en un límite lo elige como área.
- Tarjeta: la cifra grande depende del rango del 80 % (`countIsTheNews` en `riskPanel.ts`). Si incluye el cero (puede no haber fuego), va la **probabilidad de fuego** y la frase dice cuántos eventos serían si lo hay (`ifAny`); nunca "1 evento esperado": un evento puede darse en cualquier parte, y en los distritos con 1 esperado no hubo ninguno el 57 % de las veces (2021–2025). Si no incluye el cero, van los **eventos esperados** en enteros y la frase dice cuántos años de la historia cayeron en el rango. Debajo, la historia del mes año por año con el rango como franja (el último año aparte, con contorno), el mismo mes del último año completo, KPIs (rango 80 %, años con fuego, **Probado aquí**: meses de 2021–2025 dentro del rango en esa área), 12 barras del año, top 5 (con píldora de eventos solo si habrá fuego casi seguro; si no, por probabilidad) y "¿Es confiable?" con la calibración de la franja de la etiqueta.
- Oculta la línea de tiempo, las fechas, las descargas y el calendario.

**Caso Sicuani** (video y recorrido de primera visita, `web/src/sample-case/`):

- Botón "Caso Sicuani" en el encabezado (en el teléfono, solo el ▶ en la fila de los logos). Se abre solo en la primera visita a la portada (sin área ni fechas en el enlace), después del globo, y si la persona no eligió ya otra área o pestaña.
- Bienvenida: el video de 30 s en YouTube, en el idioma de la interfaz (ES `xsZsKkPtBvs`, EN `dJ5Ccd7tOqI`; `hl` pone el reproductor en ese idioma). Debajo del video, "Watch in English" / "Ver en español" cambia la app, el video y el recorrido a la vez (el velo tapa el botón del encabezado); el recorrido vuelve a escribir el paso abierto en el idioma nuevo. La portada es local (`web/public/tour/`, con su crédito Copernicus); el reproductor `youtube-nocookie` carga solo al pulsarla.
- Ocho pasos con driver.js: seis sobre el incendio de Sicuani (ubigeo 080601), del 3 al 7 de octubre de 2026 (el lugar, en la lista de riesgo muy alto del Plan Multisectorial 2025–2027; los días; focos crudos por sensor; antes y después de armonizar; el calendario; la Alerta temprana en su mes de más probabilidad), luego **lo más reciente en todo el Perú** (los dos últimos días de focos crudos, en el mapa) y el cierre en todo el Perú para elegir el distrito propio, con la oferta de un piloto antes de mayo. La historia va del pasado al presente: Sicuani ardió, y NASAT vigila lo último para que quien protege vidas lo vea el mismo día. "En vivo" (la línea de la bienvenida y el paso 7) solo aparece si `/api/v1/meta` trae `tail` (los datos que se refrescan solos, PR #16): nombra el satélite y la hora (de Perú) de la última detección, y dice que FIRMS se revisa cada 15 minutos con 2 a 6 horas de retraso. Sin `tail`, el paso dice solo hasta qué día llegan los datos. Siempre aclara que un foco no es un incendio confirmado; nunca promete avisos (no hay canal de alertas).
- Cada paso lleva la app a su estado (área, fechas, pestaña) y escribe sus cifras con los datos ya cargados (`sample-case/domain/sicuani.ts`): ninguna cifra va escrita a mano, así coinciden con la pantalla aunque cambien los datos. El "3 contra 90" del video es Sicuani más San Pablo el 5 de octubre; el recorrido muestra solo Sicuani, del 3 al 7 (VIIRS 162, MODIS 12).

**Ficha del distrito** (`/incendios/cusco/canchis/sicuani`, `web/sheet.html` y `web/src/district-sheet/`; servidor en `functions/src/fire_calendar/district_sheet/`):

- Una hoja A4 que un gestor de riesgos imprime, guarda en PDF, adjunta a su plan o reenvía. Junta lo que ya dice la app, sin cálculos nuevos: el calendario armonizado año × mes con su temporada, los meses a vigilar del año siguiente (las 12 probabilidades escritas encima de sus barras) con "Probado aquí", los focos de los últimos 30 días sobre el contorno del distrito (focos, eventos, días con fuego, último foco) y, al pie, el código QR del enlace corto, la fuente y la fecha. Siempre en tema claro; sale en una página A4.
- Se abre desde el panel de área ("Ficha del distrito para imprimir", solo con un distrito elegido) y desde su dirección. En desarrollo: `sheet.html?district=080601` en Vite (sin el HTML del servidor).
- **Direcciones legibles (SEO)**: `/incendios/<departamento>/<provincia>/<distrito>` en español y `/en/wildfires/…` en inglés, con la regla `slugify` (minúsculas, sin tildes, guiones) igual en `district_sheet/interfaces/urls.py` y `district-sheet/domain/sheet.ts` (comprobado con los 1 792 nombres del INEI). Los tres niveles hacen falta: 100 nombres de distrito se repiten. El código QR, el botón de compartir y el enlace de la app usan esta dirección; `/d/<ubigeo>` queda como atajo con 301.
- El servidor escribe lo que un buscador lee sin JavaScript (marcadores `<!--ssr:…-->` de `sheet.html`): título ("Incendios en Sicuani (Canchis, Cusco): calendario y meses a vigilar"), descripción que empieza por el lugar, canónica y hreflang (es, en, x-default), `<html lang>`, nombre, meses a vigilar, los demás distritos de la provincia como enlaces y datos estructurados schema.org `Dataset` (lugar con su caja, periodo, fuente FIRMS, descarga CSV). La web conserva ese título y cambia de idioma yendo a la otra dirección. Las direcciones canónicas usan `FIRE_PUBLIC_URL` (https://nasat.space en `deploy.yml`), no el dominio `run.app`.
- La dirección lleva etiquetas Open Graph del distrito ("Sicuani: calendario de fuego y meses a vigilar", con los meses y la fecha de los datos) y una imagen de vista previa: lo que WhatsApp, LinkedIn o el correo muestran al pegarlo, para que el grupo vea su temporada sin abrir nada. La imagen cambia de dirección (`?v=<último día>`) cuando llegan datos nuevos.
- Los meses a vigilar son una sola regla en dos lugares: `watchMonths` (`web/src/calendar/domain/watch.ts`) y `watch_months` (`district_sheet/domain/services.py`): los 3 de más probabilidad, al menos 5 %, en orden del año (empate: el mes anterior).
- Los colores de la imagen no se declaran en Python: se leen de `web/src/styles.css` (o del CSS compilado en `web/dist/assets/` dentro de la imagen de Cloud Run). Las letras (Fira Sans, Overpass, OFL) van en `district_sheet/interfaces/fonts/`.
- En la ficha y en la vista previa, la rampa del calendario se reparte con los cuantiles de los meses **con fuego** (los meses sin fuego van aparte): con todos los meses, en un distrito que casi no arde, un solo foco saldría del color más oscuro. El calendario de la app sigue con los cuantiles de todos los meses.
- Si la cuota de la temporada sale 100 % (la mediana de los demás meses es 0), la ficha no la escribe: se leería como "nunca arde en otro mes".

Detalles de implementación que conviene saber:

- `shared/palette.ts` lee los colores de `styles.css` **una vez al cargar**: cambiar de tema recarga la página (el estado vive en la URL). Ningún otro archivo declara colores; `npm run check:palette` valida la rampa.
- Todo texto visible va en `shared/i18n.ts`, en español y en inglés (el tipo `Key` obliga a tener las dos). Textos breves y amables; en español, los meses van en minúscula dentro de las frases.
- `calendar/domain/fireEvents.ts` agrupa eventos en el navegador con la **misma regla** que `fire_events.py`; si cambias una, cambia la otra.
- Elementos que no aplican a una pestaña: CSS `.app.tab-risk .not-risk`, `.app.tab-raw .not-raw` y `data-risk` (lo único visible del panel en Alerta temprana).
- URL: `department|province|district|bbox|polygon`, `from`, `to`, `metric=hotspots`, `points=1`, `buffers=overlap`, `view=risk`, `month=1..12`. En el navegador (no en el enlace): `nasat-theme`, `nasat-hidden-sections`, `fire-calendar-lang`, `nasat-tour-seen` (el recorrido ya se abrió) y `nasat-intro-seen` (sesión).
- driver.js va fijado en una versión exacta (1.12.1, sin `^`) y se carga aparte, solo al abrir el recorrido. Sus popovers toman los colores del tema en `styles.css` (`.nasat-tour`, velo `--tour-overlay`); en escritorio, el paso del mapa pone el popover dentro del mapa (`.tour-in-map`) porque a su lado no cabe.

## Decisiones tomadas (no revertir sin preguntar)

- Buffer de cada foco = tamaño nominal de su píxel (1 km MODIS, 375 m VIIRS), igual en el mapa, en `fireEvents.ts` y en `fire_events.py`. Si se cambia, hay que regenerar `fire_events.parquet` para que mapa y estadísticas sigan coincidiendo.
- Focos crudos: buffers **disueltos por día** por defecto; la unión se compone en un lienzo auxiliar, no con una librería de geometría (miles de círculos serían lentos).
- Áreas oficiales por celdas H3 de los límites del INEI, no por el ETL: así no se recalcula la armonización.
- El encabezado y sus pestañas nunca se ocultan; "solo mapa" oculta el resto.
- El ranking de departamentos no muestra actividad armonizada (compara departamentos dentro de un rango, no años).
- **Predicción** (decisión del equipo, 15 nov 2026; antes "la web describe, no predice"): estacional y verificada, Poisson sobre eventos MODIS. No usa eventos con VIIRS (crecen con cada satélite) ni actividad armonizada con umbral, ni clima, ni tendencia. Se descartó el plan del documento del equipo (Theil-Sen a 12 meses y puntaje de riesgo 0–100) por no estar verificado.
- **Cifra de la Alerta temprana** (pedido del equipo, 26 nov 2026: "un evento puede darse en cualquier parte"): si el rango del 80 % incluye el cero, la cifra grande es la probabilidad y se dice cuántos eventos si hay fuego; la tarjeta muestra la historia del mes, la prueba en el área y la calibración de la franja. El modelo no cambió.
- **Ficha del distrito** (pedido del equipo, 26 nov 2026, después del cierre, para vender a CENEPRED, INDECI y municipios): una hoja por distrito que sirve de anexo a sus planes y un enlace corto con vista previa para sus grupos de WhatsApp. No promete alertas (no hay canal) y no compara con la lista de riesgo de CENEPRED en público.
- **Caso Sicuani** (pedido del equipo, 26 nov 2026, después del cierre): video y recorrido de primera visita con driver.js. El recorrido nunca dice que NASAT predijo ese incendio: la Alerta temprana dice qué meses vigilar. El enlace del piloto ("escríbenos") apunta a la publicación de LinkedIn del 24 nov 2026, que ya pide a cada autoridad su distrito; cámbialo en `SICUANI.contact` si el equipo tiene un correo.

## Cómo pide trabajo el equipo

- Escribe en inglés o español y suele pedir actuar como "senior designer / software engineer / experience / ideal senior role". Responde en su idioma; los textos de la app van en español e inglés.
- Itera rápido en pedidos cortos sobre lo último que vio en pantalla. Espera cambios completos de extremo a extremo (ETL → API → web), verificados en el navegador, con pruebas al día.
- Pide quitar texto repetido: antes de añadir una etiqueta o una nota, comprueba que esa información no esté ya en otra parte de la pantalla.
- Cuando un pedido choca con una regla de este archivo (p. ej. predecir), dilo, propone la versión defendible y regístrala en "Decisiones tomadas".
- La marca oficial de Space Apps manda sobre los documentos internos del equipo (logo NASAT, paleta y degradado oficiales). Los documentos del equipo en Google Docs pueden traer cifras o código que no coinciden con el repositorio: contrástalos antes de usarlos.

## Límites conocidos (decláralos si salen en la demo)

- Más de 30 000 focos en el rango: el mapa dibuja los más recientes y lo avisa; las estadísticas cuentan todos.
- Blue Marble (GIBS) no tiene detalle por encima del zoom 8; para ver focos de cerca, el mapa de calles.
- En el panel de navegador de la app de escritorio de Claude, al abrir un enlace con área, el mapa a veces no se acerca al área (también en producción); en Chrome normal y headless sí. No es de la app; para verificar el encuadre usa puppeteer o recarga.
- El agrupado de eventos del navegador puede diferir en unos pocos eventos del servidor en los bordes del área (el servidor agrupa todo el Perú).
- El mes en curso es parcial: se compara con los mismos días de años anteriores.
- Los eventos MODIS bajaron en 2025–2026 (deriva de órbita de Terra y Aqua y un año de poco fuego): la línea "mismo mes del año pasado" de Alerta temprana puede decir "menos de lo esperado" (p. ej. Perú, septiembre de 2026: 1 236 frente a 2 191–4 297).
- La predicción cuenta menos eventos que Focos crudos porque solo usa MODIS.
- A nivel de departamento la probabilidad de al menos un evento suele ser 100 %: por eso el mapa se pinta por impacto.

## Cómo trabajar

- Pruebas: `cd functions && uv run python -m pytest -q` (48) y, para la cola, `uv run --with pytest --with pandas --with numpy --with scipy --with h3 --with pyarrow pytest src/etl/tests -q` (13). Web: `cd web && npx tsc --noEmit && npm run build && npm run check:palette`.
- Servidores: `.claude/launch.json` (`fire-calendar` en :8000 y `web-dev` en :5173, que reenvía `/api` a :8000). Si :8000 está ocupado por otra copia del repositorio, añade una configuración temporal en otro puerto (p. ej. :8001, que también sirve `web/dist` compilado), o arranca Vite con `FUNCTIONS_URL=http://127.0.0.1:<puerto>`; deshaz el cambio de `launch.json` antes de confirmar.
- La API no recarga sola: tras cambiar Python, reinicia el servidor. Tras cambiar `web/`, `npm run build` si la ves servida por la API.
- Regenerar los límites: `uv run --project functions python src/etl/peru_limits.py` (~35 s). El WFS del INEI rechaza el agente por defecto de curl; el script se identifica como `NASAT-ETL/1.0` y usa los certificados de `certifi`.
- Git: una rama por tarea desde `origin/main` y PR a `main`. Antes de empujar más commits a una rama con PR, comprueba que el PR siga abierto (`gh pr view <n>`): un commit empujado después de fusionar se queda fuera de `main` (pasó con el README de #9; se resolvió con #10).
- **Despliegue automático**: `.github/workflows/deploy.yml` corre pruebas y tipos y despliega en Cloud Run al fusionar en `main` cambios en `functions/`, `web/`, `data/processed/`, `Dockerfile` o `.gcloudignore` (~2,5 min; `gh run list --workflow deploy.yml`). Cambios solo de docs no despliegan. Manual, si hiciera falta: el comando `gcloud run deploy` del README (siempre con `--project nasat-fire-calendar`; el proyecto activo de gcloud en esta máquina es otro).
- Capturas del README (`docs/img/01…14`): se tomaron de producción con `puppeteer-core` sobre el Chrome instalado, a 1440×900, en español y tema oscuro (05 en claro), saltando la intro con `sessionStorage['nasat-intro-seen']` (y, desde el caso Sicuani, el recorrido con `localStorage['nasat-tour-seen'] = '1'`). El script no está en el repositorio: si cambias la interfaz de forma visible, rehazlas con las mismas vistas (lista en la tabla de criterios del README).

## Cifras verificadas (úsalas tal cual en la demo y el envío)

- Armonización, validación fuera de muestra 2021–2024, mensual: MAPE **89,85 % antes → 15,12 % después**, sesgo +4,02 %, r = 0,988 (`calendar_summary.json`).
- Limpieza: 2 439 271 → 2 168 246 focos; los 150 000 de confianza baja están recontados en los CSV (la cifra redonda es real).
- Con límites INEI: Cusco 2024 = 9 508 focos; 25 departamentos, 196 provincias, 1 890 distritos.
- Predicción, prueba fuera de muestra (ajuste 2003–2020, prueba 2021–2025), departamento / provincia / distrito: error de Brier **48 / 43 / 33 %** menor que una sola tasa para todo el Perú; rango del 80 % cumplido **83 / 90 / 96 %**; con Poisson puro, 58 / 83 / 96 % (dispersión 4,5 / 2,4 / 1,8).
- Calibración fuera de muestra (distritos, 2021–2025): cuando dijo alta, hubo fuego el **81 %** de las veces; media, **42 %**; baja, **12 %**; casi nula, **2 %** (provincias 87 / 53 / 21 / 5 %; departamentos 96 / 70 / 29 / 2 %).
- Prueba en el área (ajuste 2003–2020, 60 meses de 2021–2025 dentro del rango): Sicuani **54/60**, Cusco 48/60, Perú 48/60. Sicuani, agosto: fuego en 11 de 23 años, 48 %, si lo hay de 1 a 2 eventos.
- Ejemplos de la app: Cusco, agosto de 2027 → 141 eventos esperados (47–257); todo 2027 → ~428; Perú, septiembre → 3 198.

## Pendiente para el envío (revisar al empezar cada sesión)

- Los ocho campos de la página del proyecto y la demo (`docs/08-envio.md`), con la declaración de uso de IA (incluye el trabajo de los agentes: armonización, API, web, predicción, capturas).
- Referencias: NASA FIRMS (MODIS C6.1, VIIRS C2), INEI (Geoservidor WFS/WMS `ig_departamento`, `ig_provincia`, `ig_distrito`), NASA GIBS, OpenStreetMap, H3, DuckDB, FastAPI, Leaflet, puppeteer-core (solo para las capturas).
- Las capturas de `docs/img/` sirven para la demo.
- El documento técnico del equipo (Google Docs) tiene afirmaciones que no coinciden con el código: diccionario de datos con columnas inexistentes, §7 presentado como código real, "polígonos con `unary_union`", cifras no medidas (< 300 ms, 60 fps) y "MAPE anual 5,59 %". El INEI ya se usa para elegir el área, pero no en la columna `department` del ETL.
- Decidir si el título de la pestaña del navegador ("NASAT · Calendario de quema") pasa a usar el nombre del reto.

## Archivos grandes y contexto de IA

Estas reglas aplican a cualquier agente, herramienta y sesión de IA que trabaje en este repositorio:

- No cargues ni leas completos archivos de **10 MiB o más**, ni archivos de datos binarios como Parquet, en el contexto del chat por defecto. Esto incluye archivos de `data/`, aunque sean entradas o salidas importantes del proyecto.
- Antes de abrir archivos de datos, consulta solo sus nombres, tamaños, esquema o metadatos. Para entender su uso, prioriza el código ETL, las funciones, la documentación y los reportes resumidos.
- Lee o procesa el contenido de un archivo grande solo si la solicitud actual lo requiere explícitamente. En ese caso, limita la inspección a las columnas, filas, fechas o regiones necesarias; prefiere consultas y procesamiento en streaming (DuckDB sobre el parquet) a volcar el archivo completo al contexto.
- Si la tarea exige el contenido completo y no se puede resolver con una inspección acotada, explica qué archivo necesitas y por qué antes de cargarlo al chat.
- No leas datos grandes solo porque una prueba, servicio o script dependa de ellos: ejecuta la prueba o procesa los datos sin incorporar su contenido al contexto.

## Honestidad

Reporta los resultados como son. Si la armonización o la predicción no mejoran el error, o algo no está verificado, dilo: ocultarlo cuesta más puntos que declararlo.
