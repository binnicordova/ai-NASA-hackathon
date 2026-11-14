# 04 · Método de armonización

Objetivo del enunciado: que "el sensor de origen ya no importe". Este documento propone un método defendible en 36 horas y cómo demostrar que funciona.

> Las afirmaciones físicas de esta página vienen de conocimiento general sobre los sensores. Antes de citarlas en el envío hay que respaldarlas con la documentación de FIRMS y con nuestros propios números.

## Por qué los conteos no son comparables

| Causa | Efecto sobre el conteo |
|---|---|
| **Resolución:** VIIRS 375 m, MODIS ~1 km | Un mismo fuego da un píxel en MODIS y varios en VIIRS |
| **Sensibilidad:** VIIRS detecta fuegos más pequeños y fríos | VIIRS ve fuegos que MODIS no registra |
| **Horario:** Terra pasa a media mañana; Aqua y VIIRS a primera hora de la tarde | Terra ve otra fase del ciclo diario del fuego |
| **Número de satélites:** uno, dos o tres VIIRS según el año | El conteo sube sin que haya más fuego |
| **Borde de barrido:** el píxel MODIS crece mucho hacia el borde | Menos detecciones lejos del nadir |
| **Confianza:** 0–100 frente a `l/n/h` | Los filtros no son equivalentes |
| **Cobertura inicial:** 2000 a mediados de 2002 solo Terra | Los primeros años están subestimados |

Sumar los conteos crudos produce un salto artificial en 2012 y otro con cada satélite nuevo.

## Método propuesto

### Paso 1 · Limpieza

- Conservar `type == 0` (fuego de vegetación). Descarta volcanes, fuentes industriales y mar adentro.
- Descartar baja confianza: MODIS `confidence < 30`, VIIRS `confidence == 'l'`.
- Eliminar duplicados exactos.

### Paso 2 · Unidad común: celda-día con fuego

Proyectar cada detección a una **grilla común** y contar **celdas-día activas**: una celda cuenta una vez por día, sin importar cuántos píxeles cayeron en ella.

- Tamaño sugerido: ~1 km (0,01°), cercano a la resolución de MODIS.
- Elimina la inflación por resolución: varios píxeles VIIRS de un mismo fuego colapsan en una celda.
- Elimina parte de la inflación por satélites: dos pasadas el mismo día sobre la misma celda cuentan una vez.

### Paso 3 · Par de referencia

Calibrar con el par de **misma hora de pasada**: **Aqua MODIS** frente a **S-NPP VIIRS**, ambos de primera hora de la tarde. Así la diferencia que queda se debe al sensor y no a la hora del día.

Terra, NOAA-20 y NOAA-21 se incorporan después con su propio factor respecto a la referencia.

### Paso 4 · Calibración cruzada en el periodo común

En el periodo en que ambos sensores observan (2012 → hoy), por **región y mes del año**:

1. Calcular celdas-día de MODIS y de VIIRS.
2. Ajustar la relación MODIS → VIIRS. Empezar por una razón por mes; si hay tiempo, una regresión en escala logarítmica.
3. Guardar el factor y su dispersión.

La dependencia del mes importa: en temporada de quema agrícola hay muchos fuegos pequeños que solo VIIRS ve, y el factor cambia.

### Paso 5 · Serie armonizada

Expresar toda la serie 2000 → hoy en **unidades equivalentes VIIRS**, porque VIIRS es el sensor que continúa:

- 2000–2011: MODIS × factor, con **banda de incertidumbre**.
- 2012 → hoy: VIIRS observado.
- 2000 a mediados de 2002: marcado como "solo Terra", con factor propio o aviso visible.

### Paso 6 · Validación

- Reservar años del periodo común que no se usan para ajustar.
- Predecir VIIRS desde MODIS en esos años y comparar con lo observado.
- Reportar sesgo y error **antes** y **después** de armonizar.
- Repetir en Cusco y en Madre de Dios: si funciona en dos biomas, el método generaliza.

El gráfico antes/después es la pieza central de la demo.

## Indicadores del calendario

| Indicador | Definición |
|---|---|
| Actividad mensual | Celdas-día armonizadas en el área y el mes |
| Mediana histórica | Mediana de ese mes en todos los años |
| Anomalía | Mes actual ÷ mediana histórica, y percentil |
| Temporada pico | Meses que concentran la mayor parte de la actividad anual |
| Años récord | Años ordenados por actividad total |

## Límites que hay que declarar

- **Foco de calor no es incendio.** Un incendio produce muchos focos y un foco puede ser una quema controlada.
- **Sin observación no es cero fuego.** Nubes y humo denso ocultan detecciones.
- **No sumar FRP entre sensores:** contaría dos veces la misma energía.
- El factor es **estadístico**: vale para agregados por región y mes, no para un fuego individual.
- Los primeros años tienen más incertidumbre.
- La app describe el pasado y el presente; **no predice** incendios.

Declarar los límites sube la nota de Validez: muestra que se entiende el dato.

## Camino mínimo si falta tiempo

1. Limpieza + celdas-día + razón mensual por región.
2. Validación con un solo año reservado.
3. Banda de incertidumbre simple a partir de la dispersión de la razón.

Con eso ya hay una armonización real y demostrable.
