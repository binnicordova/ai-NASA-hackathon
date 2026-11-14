# 01 · Resumen del reto

**Título oficial:** Harmonization of MODIS and VIIRS Hot Spots
**Dificultad:** Intermedio / Avanzado · **Habilidades:** Ciencias de la Tierra, Software
**Fuente:** <https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/?tab=details>

## El problema

Los satélites registran focos de calor activos desde hace más de dos décadas, pero el registro está partido entre sensores que no se pueden comparar directamente:

| | MODIS | VIIRS |
|---|---|---|
| Satélites | Terra, Aqua | S-NPP, NOAA-20, NOAA-21 |
| Resolución | ~1 km | 375 m |
| Registro | 2000 → hoy | 2012 → hoy |
| Situación | Cerca del fin de su vida útil | Es el reemplazo |

Tienen distinta resolución espacial, sensibilidad y horario de observación. Sin armonizar, los gestores de emergencias no tienen una imagen consistente de cuándo y dónde ha habido quema.

## Qué pide NASA

Una **aplicación web** que armonice esos registros en un **calendario de actividad de quema** basado en focos de calor, para que el usuario examine patrones históricos, condiciones inusuales y periodos críticos en un área de interés.

El enunciado propone dos partes:

1. **Armonización** de focos MODIS y VIIRS, de modo que "al final de esa fase el sensor de origen ya no importe" y el foco pase a los patrones, tendencias y anomalías.
2. **Aplicación web** que recibe los datos armonizados. El usuario elige una región y un rango de fechas, y descarga análisis y visualizaciones.

## Público objetivo

Alerta temprana y respuesta a emergencias, científicos, gestores de tierras y bomberos.

## Lista de comprobación de entregables

| Pedido en el enunciado | Entregable | Prioridad |
|---|---|---|
| Armonizar hasta que el sensor no importe | `armonization/`: método documentado y validado, con prueba antes/después | Crítica |
| App web sobre datos armonizados | `web/` | Crítica |
| Elegir región | Dibujar área en el mapa **y** ingresar latitud/longitud | Crítica |
| Elegir rango de fechas | Selector de fechas | Crítica |
| Calendario desde inicios de los 2000 hasta hoy | Matriz año × mes | Crítica |
| Qué periodos del año tienen más fuego | Temporada pico | Alta |
| Qué años tuvieron más quema | Años récord | Alta |
| Mes actual frente a la mediana histórica | Tarjeta de anomalía | Alta |
| Rampas de color accesibles | Rampa apta para daltonismo y número en cada celda | Alta |
| CSV de los focos detectados en la búsqueda | Botón de descarga CSV | Alta |
| Descargar análisis y visualizaciones | Exportar PNG y resumen | Media |
| Comparaciones históricas y anomalías contra promedios multianuales | Gráfico de anomalías | Media |

Las "consideraciones potenciales" son opcionales según el enunciado, pero cubrirlas todas es la forma más directa de puntuar alto en Relevancia.

## Recursos oficiales

La pestaña Resources lista un único recurso: **FIRMS** (Fire Information for Resource Management System) de NASA Earthdata, con focos activos casi en tiempo real e históricos. Ver [03-datos-firms.md](03-datos-firms.md).

## Lectura entre líneas

- El título dice **armonización**, no visualización. Quien solo sume conteos crudos de dos sensores no resolvió el reto.
- La frase "comparar la actividad del mes actual contra la mediana histórica" aparece de forma explícita: esa tarjeta debe verse en la primera pantalla.
- Se pide un foco en **gestores de emergencias**: la interfaz debe responder preguntas, no solo mostrar datos.
