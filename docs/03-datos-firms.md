# 03 · Datos: NASA FIRMS

Recurso oficial del reto: <https://www.earthdata.nasa.gov/data/tools/firms>

## Dos vías de acceso

| Vía | Para qué | Límite |
|---|---|---|
| **Archivo anual por país** (CSV) | Toda la historia 2000 → año pasado | Un archivo por sensor, año y país |
| **API de área** (CSV) | Los últimos días y el año en curso | 1 a 5 días por llamada |

Regla práctica: **archivo para la historia, API solo para lo reciente**. Reconstruir 26 años con la API costaría unas 1900 llamadas por sensor y área.

## Archivo por país

Patrón de URL comprobado el 14 nov 2026:

```
https://firms.modaps.eosdis.nasa.gov/data/country/modis/2025/modis_2025_Peru.csv
https://firms.modaps.eosdis.nasa.gov/data/country/viirs-snpp/2025/viirs-snpp_2025_Peru.csv
https://firms.modaps.eosdis.nasa.gov/data/country/viirs-jpss1/2023/viirs-jpss1_2023_Peru.csv
```

| Carpeta | Sensor | Comprobado |
|---|---|---|
| `modis` | MODIS Terra + Aqua | 2025 responde. 2000 y 2023 cortaron la conexión en la prueba: reintentar |
| `viirs-snpp` | VIIRS S-NPP | 2012, 2023 y 2025 responden |
| `viirs-jpss1` | VIIRS NOAA-20 | 2023 responde |

Falta confirmar el primer año disponible de cada carpeta y si existe carpeta para NOAA-21.

## Columnas

MODIS:

```
latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight,type
-14.5696,-70.2075,301.4,2.4,1.5,2025-01-02,1434,Terra,MODIS,16,61.03,272.5,16.5,D,0
```

VIIRS:

```
latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight,type
-17.48689,-71.36246,367,0.35,0.56,2023-01-01,1746,N,VIIRS,h,2,294.09,4.34,D,2
```

Diferencias que la armonización debe resolver:

| Campo | MODIS | VIIRS |
|---|---|---|
| Brillo | `brightness`, `bright_t31` | `bright_ti4`, `bright_ti5` |
| `confidence` | Número de 0 a 100 | Letra: `l` baja, `n` nominal, `h` alta |
| `satellite` | `Terra`, `Aqua` | `N` (S-NPP), `N20`, `N21` |
| `scan`, `track` | Píxel de ~1 km que crece hacia el borde | Píxel de ~0,4 km |
| `acq_time` | Hora UTC `HHMM` | Igual |

`type` clasifica la fuente térmica. Según la documentación de FIRMS: `0` fuego de vegetación presunto, `1` volcán activo, `2` otra fuente estática en tierra, `3` mar adentro. En las muestras aparecen los valores 0, 2 y 3. Confirmar esta tabla en la documentación antes de citarla en el envío.

## API de área

```
https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[AREA]/[DAY_RANGE]/[DATE]
```

| Parámetro | Valor |
|---|---|
| `MAP_KEY` | Clave gratuita, obligatoria |
| `SOURCE` | `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_NRT`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_NRT`, `VIIRS_NOAA21_SP`, `LANDSAT_NRT` (solo EE. UU. y Canadá) |
| `AREA` | Caja `oeste,sur,este,norte` o `world` |
| `DAY_RANGE` | Entero de 1 a 5 |
| `DATE` | `YYYY-MM-DD`, opcional. Sin fecha devuelve lo más reciente |

- Límite: **5000 transacciones cada 10 minutos**. Peticiones grandes cuentan como varias.
- Fechas disponibles por producto: `/api/data_availability/`.
- `NRT` es casi en tiempo real; `SP` es el producto estándar, de mayor calidad y con retraso.
- La `MAP_KEY` no debe ir en el código del navegador: se llama desde `functions/`.

## Muestra: Cusco y Madre de Dios

El archivo viene por país, así que se descarga **Perú completo** y se recorta.

| Zona | Caja aproximada (oeste, sur, este, norte) | Por qué |
|---|---|---|
| Cusco | −73,98, −15,46, −70,35, −11,22 | Quema agrícola e incendios de pastizal y bosque andino en temporada seca |
| Madre de Dios | −72,4, −13,4, −68,6, −9,9 | Contraste amazónico: otro bioma, otra señal |

Las cajas son aproximadas. Para el producto final conviene recortar con el polígono oficial del departamento.

## Volumen estimado

Perú completo, todos los sensores y años, son decenas de archivos CSV. Para la app conviene preprocesar a:

- **Agregados armonizados** por celda de grilla y mes (livianos, se sirven estáticos).
- **Focos crudos** particionados por año, para la descarga CSV del área elegida.

## Pendientes de verificar

- Primer y último año de cada carpeta del archivo.
- Existencia de archivo por país para NOAA-21.
- Significado exacto de `type` y de `version`.
- Fecha de inicio real de cada sensor en FIRMS (Terra fines de 2000, Aqua mediados de 2002, S-NPP enero de 2012, según lo que se recuerda).
