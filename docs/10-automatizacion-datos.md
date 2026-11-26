# 10 · Automatizar la actualización de datos

Evaluación del 25 nov 2026 (hora de Lima), ajustada a la indicación del equipo: **los datos ya están procesados hasta el 14 nov, así que solo hace falta traer lo último, a la cadencia mínima con que FIRMS lo publica.** Es una propuesta: no se implementó nada y no cambia la app publicada. Lo "medido" sale de pruebas hechas ese día en una copia fuera del repositorio; lo "estimado" lo dice.

## Estado: implementado en la rama `claude/satellite-data-automation-5c7a94`

| Pieza | Dónde | Estado |
|---|---|---|
| Cola de datos nuevos | `src/etl/firms_tail.py`, `src/etl/tail_store.py` | 13 pruebas; comparada con la base del 8 al 12 nov (abajo) |
| ETL compartido | `harmonize_firms.harmonize_daily`, `fire_events.points_frame` | La reconstrucción completa sale idéntica a antes del cambio |
| Factores congelados y corte | `data/processed/frozen_params.json`, `base_manifest.json` | Generados por la corrida completa |
| API: base + cola y recarga en caliente | `functions/.../tail_source.py`, `duckdb_gateway.py`, `app.py` | 38 pruebas (27 previas + 11); con la cola igual a la base, las respuestas son idénticas |
| Web | nota "Última actualización" en el panel Acerca de | `tsc`, `build` y `check:palette` pasan |
| Nube | `infra/setup.sh`, `jobs/tail/` | Ver "Operación" |

**Comparación con la base (8–12 nov, API de FIRMS recortada a Perú contra la descarga manual):** 809 de 813 celdas-día idénticas (actividad armonizada, conteos y régimen sin diferencia); 1 353 de 1 358 focos coinciden; eventos 833 contra 834 (MODIS 55 = 55). Las diferencias son el borde del país (4 y 2 celdas-día, 5 y 3 focos), por recortar con celdas H3 del INEI en vez del polígono de FIRMS. Columnas y tipos de datos idénticos.

## Veredicto

1. **Solo se procesa la cola**: los días desde el **12 nov**. La base ya procesada (hasta el 11 nov) no se toca ni se recalcula; sigue en la imagen.
2. **Cadencia**: un vigilante consulta los feeds de FIRMS cada 15 min con una petición condicional (`ETag`) y solo procesa si cambiaron. El piso lo pone NASA: NRT llega **hasta ~3 h después de la pasada**. Frescura de la web ≈ NRT + ≤ 15 min + segundos de proceso.
3. **Hay un hueco que cerrar una vez**: del 12 al 17 nov. Los feeds públicos solo guardan 7 días y hoy empiezan el 18 nov, pero la **API de FIRMS con la clave del equipo lo cubre**: verificado el 25 nov, con NRT disponible del 1 sep al 25 nov.
4. **Entrega sin deploy**: la cola (unos pocos MB) vive en Cloud Storage; la API la une a la base y la recarga sola. Nada de parquets en git.

## 1. Estado actual (medido)

| Pieza | Estado |
|---|---|
| Entrada | 14 CSV de pedidos manuales a FIRMS (190 MB, versionados en git). |
| Último día | 14 nov, pero **la cola está incompleta**: el 12 nov tiene los cuatro sensores (Aqua 43, NOAA-20 267, NOAA-21 191, Terra 5 focos), el 13 nov no tiene Aqua y el 14 nov solo 2 focos de NOAA-21. Por eso el corte es el 12 nov, con ese día como solape de seguridad. |
| Estándar (SP) vs NRT | El estándar llegaba hasta el 31 jul (VIIRS) y el 31 ago (MODIS): tarda **2,5 a 3,5 meses**. Todo lo posterior es NRT, provisional. |
| Publicación | Los parquets de `data/processed/` (≈ 105 MB) van a git y a la imagen; `deploy.yml` redespliega al fusionar (~2,5 min). |
| Carga en la API | `DuckDbHarmonizedSeriesGateway` lee todo al arrancar y vive lo que el proceso. No hay recarga. |

## 2. Qué publica NASA y con qué ritmo

| Vía | Sirve para | Veredicto |
|---|---|---|
| **Feeds públicos** `data/active_fire/.../*_South_America_{24h,48h,7d}.csv` (sin clave) | Disparador gratuito de cambios y respaldo | Medido: MODIS 0,7 MB, NOAA-20 2,2 MB, NOAA-21 2,6 MB (24 h); en Perú ≈ 110 / 790 / 490 filas. |
| **API de área** `/api/area/csv/MAP_KEY/{FUENTE}/…/{DÍAS}/{FECHA}` (clave gratuita, 5 000 transacciones / 10 min, 1–5 días por llamada) | **Fase 1: los datos** (el puente 12–17 nov y el régimen continuo) y, luego, el estándar (`*_SP`) | **Verificado con la clave del equipo** (abajo). |
| Archivo anual por país | Solo años cerrados | Descartado: `…_2026_Peru.csv` da 404 y el de 2025 salió el 10 oct 2026. |
| Pedido por correo (el de hoy) | Historia | Manual: ya no hace falta para el puente. |

**El hueco, medido hoy:** el feed de 7 días trae en Perú desde el 18 nov (ese primer día, parcial) hasta el 25 nov. Los días **12 a 17 nov no están** en ningún feed público. Cuanto más se espere, más días caen fuera de la ventana de 7 días.

### La clave del equipo, verificada (25 nov)

El correo de NASA FIRMS del 13 nov trae una `MAP_KEY` válida para FIRMS Global (no se copia aquí ni va al repositorio). Pruebas de solo lectura:

- **Cuota**: 5 000 transacciones / 10 min; tras la primera prueba el contador marcaba 11.
- **Disponibilidad** (`data_availability`): NRT de MODIS, NOAA-20 y NOAA-21 del **1 sep al 25 nov**, así que el 12–17 nov entra completo. S-NPP NRT llega al 2 nov. El **estándar (SP) ya llega al 31 ago en todos los sensores**: en nuestra base VIIRS tenía estándar solo hasta el 31 jul, así que agosto de VIIRS ya se puede reemplazar.
- **Equivale a la descarga manual**: para 8–12 nov, los tres sensores devuelven el mismo esquema (con `instrument`, y la confianza de VIIRS en `l/n/h`) y **contienen todos los puntos de la descarga manual** (80 de MODIS, 764 de NOAA-20 y 689 de NOAA-21; 0 faltantes).
- **Cuidado con la caja**: `-82,-19,-68,1` devuelve 58 / 280 / 305 puntos más que la descarga manual y casi todos (≥ 99 %) caen **fuera de Perú** (Bolivia, Brasil, Colombia, Ecuador, Chile): entre 27 % y 42 % de lo que trae la caja no es de Perú. Hay que recortar al país antes del ETL (riesgo 10).

Latencia observada (una sola muestra, 26 nov 01:36 UTC): el archivo de cada feed se había regenerado 1,8 h (MODIS), 4,8 h (NOAA-20) y 5,6 h (NOAA-21) después de su detección más reciente.

**Cadencia de refresco, medida con cabeceras `Last-Modified` durante ~15 min: cada feed se regenera una vez por hora, siempre en el mismo minuto.** NOAA-20 pasó de 00:41:15 a 01:41:16 y NOAA-21 de 00:44:14 a 01:44:07 y MODIS de 00:47:07 a 01:46:53 (UTC). Entre una regeneración y otra el archivo no cambia, así que **el refresco mínimo útil es 1 hora por feed**. Sondear cada 15 min deja un retraso extra máximo de 15 min; la lectura de `Last-Modified` no cuesta nada.

Los satélites pasan por Perú unas pocas veces al día y los datos llegan **por lotes**: consultar más seguido que cada 15 min no aporta. Si el `ETag` no cambió, el vigilante termina en ~1 s.

**S-NPP ya no es fuente**: NOAA cortó su entrega el 1 nov 2026 (NASA dice 2 nov). Sus feeds de 24 h y de 7 días solo traen la cabecera (112 bytes). El vigilante debe tratarlo como "fuente terminada", no como error.

## 3. Por qué basta procesar la cola (medido)

- **Las calibraciones no se mueven con datos nuevos.** β y α usan 2012–2025, la línea base 2001–2020 y la validación 2021–2024. Cada celda-día se calcula sola con esas constantes.
- **Prueba hecha**: reconstruí todo desde los CSV recortados al 31 oct y lo comparé con la reconstrucción completa (hasta el 14 nov). Los **2 164 934 focos** y las **1 088 646 celdas-día** hasta el 31 oct salen idénticos (0 filas distintas en ambos sentidos; en las celdas-día no se comparó la lista de satélites ni los centros de celda); los **2 362 693 eventos** también. Es decir: **agregar días al final no cambia ninguno de los anteriores**. Ese montaje (base hasta el 31 oct + cola del 1 al 14 nov) es además la **prueba de aceptación** del proceso de cola: debe dar exactamente la reconstrucción completa.
- **La reconstrucción completa también es reproducible** (por si hace falta auditar): `hotspots_clean` y `fire_events` idénticos a los versionados, `harmonized_fires` con 0 diferencia en toda columna de actividad; solo cambian los centros de celda en la cifra 14 (≈ 1e-14°).
- **Solo cambian tres archivos**: `harmonized_fires`, `fire_events` y `hotspots_clean`. De los JSON, la API lee únicamente `validation_metrics` de `calendar_summary.json` (la validación 2021–2024, que no cambia). `fire_events_summary.json` y `h3_spatial_grid.json` no los usa ni la API ni la web.
- **Faltan dos insumos congelados** para calcular la cola igual que la base: (a) los factores β, α y γ se guardan redondeados a 4 decimales en `calendar_summary.json`; hay que exportarlos **con toda su precisión** una vez; (b) la máscara de fuentes estáticas (celdas H3 res 7 con `type ≠ 0` en MODIS estándar) no se guarda, solo su conteo; hay que persistirla.
- **Costo de la cola**: la reconstrucción completa tarda 54 + 60 s y usa 4,4 GB de RAM. Los 14 días del 1 al 14 nov son 3 312 focos, 1 976 celdas-día y 4 128 eventos (0,15 % de la base): una cola de ese tamaño es cuestión de **segundos y < 1 GiB (estimado, sin medir)**. El Job no necesita los 8 GiB que pediría la reconstrucción completa.
- **La API**: cargar el gateway toma 0,9 s y ≈ 490 MB de RAM; dos a la vez ≈ 0,93 GB. Cabe en los 2 GiB del servicio, así que se puede construir el gateway nuevo, intercambiarlo y soltar el viejo.

## 4. Opciones

| | A · Cron de GitHub → commit → deploy | **B · Scheduler → Job de cola → GCS → recarga (recomendada)** |
|---|---|---|
| Frescura | Cron "de mejor esfuerzo" + 2,5 min de deploy por cambio | NRT + ≤ 15 min + segundos |
| Git | ≈ 100 MB de parquet nuevo por commit; los parquets no se comprimen en delta. Cada 3 h son ~25 GB/mes; a diario ~3 GB/mes (estimado) | Sin datos en git |
| Servicio | Una revisión nueva por actualización | Una revisión; recarga cada ~5 min |
| Infra nueva | Ninguna | Bucket, Job, Scheduler, 1 cuenta de servicio |
| Costo | Cero | Centavos al mes: ~96 consultas diarias de ~1 s y 6–10 procesos de segundos (estimado; verificar con la calculadora de Google) |
| Cuándo | Parche de un día, **diario** | Destino |

Una reconstrucción completa en cada cambio (2–5 min y 8 GiB en Cloud Run, estimado) queda descartada por el criterio del equipo; sirve solo como auditoría ocasional.

## 5. Arquitectura recomendada

```
Scheduler (cada 15 min)
   └─► Job "cola" (≈ 1 GiB)
        1. GET condicional de los 3 feeds públicos (ETag) ── igual ──► termina (~1 s)
        2. pide a la API las fuentes NRT desde el corte, recorta a Perú y adapta el esquema
        3. limpia con las MISMAS reglas y la máscara estática congelada
        4. celda-día con los factores congelados; eventos del día; focos
        5. escribe 3 parquets de la cola (días ≥ corte) + manifest.json
           { corte, generadoEn, últimaObservaciónPorSensor }
        6. valida y sube a gs://…/cola/v=<fecha-hora>/; al final mueve latest.json

Cloud Run (servicio actual)
   base (imagen, días < corte)  ∪  cola (GCS, días ≥ corte)
   cada ~5 min compara latest.json → gateway nuevo → intercambio
```

- **El puente** (12–17 nov) no necesita un proceso aparte: la primera corrida pide a la API desde el corte hasta hoy (`DAY_RANGE=5` por llamada: 3 fuentes × 3 llamadas) y las siguientes solo piden los últimos días.
- **Reemplazo por día**: un día presente en la cola sustituye al de la base. Esa misma regla resolverá después el estándar sobre NRT (Fase 2).
- **Validar antes de publicar**: mismo esquema; `lastDate` no retrocede; sin celda-día duplicada; ningún sensor activo en silencio más de 48 h (S-NPP se declara terminado). Si falla, `latest.json` no se mueve y salta una alerta.
- **Una sola ejecución a la vez** (precondición de generación en GCS); se conservan las últimas 7 versiones para volver atrás.
- **Visible para el usuario**: `/meta` con `dataUpdatedAt` y la última observación por sensor; la web marca "provisional (NRT)" en los últimos ~4 meses.
- `/tmp` de Cloud Run cuenta contra la memoria; la cola pesa pocos MB, pero se borra la versión vieja tras el intercambio.

## 6. Riesgos y hallazgos que cambian el diseño

1. **Los feeds públicos traen la confianza de VIIRS como `low / nominal / high`**, no `l / n / h` (la API sí usa letras). `normalize_confidence` solo descarta `'l'`: si los feeds se usan como respaldo, **los focos de baja confianza (5,6 % de NOAA-20 y 4,4 % de NOAA-21 hoy) pasarían el filtro sin avisar**. Hay que traducir y probarlo.
2. **NRT y estándar no se pueden deduplicar por coordenadas.** La clave actual solo elimina coincidencias exactas y, con las descargas manuales, quitó apenas 94 filas de 2,29 millones porque FIRMS entrega NRT y estándar sin solaparse. El estándar posterior (órbita definitiva) puede mover la posición y **contar el mismo foco dos veces**. Regla: el estándar sustituye al NRT de los días que cubre.
3. **El cambio de constelación del 1 nov es una suposición sin verificar.** Desde el 2 nov quedan dos VIIRS (NOAA-20 y NOAA-21), pero β para 2 satélites se calibró con S-NPP + NOAA-20 (2018–2023). Se puede comprobar con datos que ya tenemos (mar 2023–oct 2026, cuando había tres): calcular β solo con el par NOAA-20/NOAA-21 y compararlo. **No se hizo.** Hasta entonces, declararlo como supuesto: toda la cola nueva depende de él.
4. **El año nuevo cambia la predicción** (en 36 días): apunta a **2028** y entrena con 2026 (parcial y con MODIS degradado), así que los ejemplos del README (Cusco, agosto de 2027 → 141) cambian. Hay que decidir si rueda o se congela. No verifiqué cómo trata el dominio el cambio de año en el calendario.
5. **MODIS se degrada** (deriva de órbita de Terra y Aqua): la base de la predicción empeora con cada mes nuevo.
6. **El último día es parcial y en UTC.** Lima es UTC−5: el "día" termina a las 19:00 locales. La comparación del mes en curso ya usa los mismos días; hay que conservarlo con varias actualizaciones al día.
7. **Secretos**: la `MAP_KEY` (registrada el 13 nov) va en Secret Manager, nunca en el repositorio ni en la imagen. Llegó por correo: conviene regenerarla si ese correo se reenvía o se comparte.
8. **Pruebas y cifras**: las pruebas de `functions/` usan 2024 y datos sintéticos, así que no se rompen con datos nuevos. Las "cifras verificadas" de AGENTS.md y del README que dependen de 2026 (parcial) o de la predicción sí cambiarían.
9. **Regla del hackathon**: el envío cerró el 15 nov. Poner datos nuevos en producción cambia lo que ve el jurado; requiere un sí explícito del equipo.
10. **La caja de la API no es el país.** La descarga manual venía recortada por país. Recortar con las celdas H3 del INEI de `peru_limits.json` deja fuera 3 de 764 y 5 de 689 puntos de esa descarga (efecto de borde), así que el recorte debe reproducir el de FIRMS. Se prueba con 8–12 nov: tiene que dar **los mismos puntos que la base**.
11. **El 2 nov de S-NPP.** La API trae S-NPP NRT hasta el 2 nov, pero la base llega al 1 nov y `SNPP_END_DATE = 2026-11-01` cuenta solo dos VIIRS desde el 2 nov. Ese día queda con tres satélites a medias: hay que decidir si se incluye.

## 7. Plan por fases (esfuerzos míos, aproximados)

| Fase | Qué | Esfuerzo | Listo cuando |
|---|---|---|---|
| 0 | Bucket, cuenta de servicio, Scheduler; la `MAP_KEY` en Secret Manager | ½ día | El equipo da los accesos |
| 1 | Congelar factores y máscara · adaptador y recorte a Perú (riesgo 10) · Job de cola · publicación en GCS · unión base + cola en la API · `dataUpdatedAt` | 2–3 días | La cola del 1–14 nov sobre la base del 31 oct **coincide con la reconstrucción completa**; la API del 8–12 nov, recortada a Perú, da los mismos puntos que la base; `lastDate` queda a menos de 1 día de hoy; detener el Scheduler dispara la alerta de obsolescencia |
| 2 | Estándar por la API con reemplazo por día · alertas de sensor en silencio · marca "provisional" en la web | 2–3 días | Un mes ya estándar no cambia al reingestar; sin focos dobles |
| 3 | Comprobación de β para el par NOAA-20/NOAA-21 · política de la predicción | según resultado | Decisión del equipo |

## 8. Decisiones que necesito del equipo

1. **El puente 12–17 nov: resuelto.** Se hace con la API y la clave del equipo, verificada el 25 nov.
2. ¿Se puede cambiar la app publicada después del cierre del 15 nov?
3. ¿La predicción 2027 se congela o rueda con el año nuevo?
4. Solo medí NRT para Perú. FIRMS describe modos más rápidos (RT 20–30 min, URT ~1 min) con estaciones en EE. UU. y Puerto Rico y como cobertura de EE. UU. y Canadá; no verifiqué si alcanzan a Perú.

## Fuentes

- NASA, [data latency](https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/data-latency) y [FIRMS URT](https://www.earthdata.nasa.gov/learn/articles/firms-urt-data).
- NASA, [Suomi NPP observations cease November 2, 2026](https://www.earthdata.nasa.gov/data/alerts-outages/suomi-npp-observations-cease-november-2-2026) y NOAA, [cessation of S-NPP data](https://www.nesdis.noaa.gov/news/cessation-of-suomi-national-polar-orbiting-partnership-s-npp-data-users-onafter-november-01-2026).
- FIRMS, [API de área](https://firms.modaps.eosdis.nasa.gov/api/area/) y [feeds de fuego activo](https://firms.modaps.eosdis.nasa.gov/active_fire/).
