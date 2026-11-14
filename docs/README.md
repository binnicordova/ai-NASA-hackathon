# Análisis del reto: Harmonization of MODIS and VIIRS Hot Spots

NASA Space Apps Challenge 2026 · 14–15 de noviembre · cierre de envío: **domingo 15, 11:59 p. m. hora local**.

Este directorio contiene el análisis del reto. El código irá en `armonization/` (armonización de los datos), `functions/` (servicios que consume la web y que se conectan con la armonización) y `web/` (aplicación), con DDD.

## Índice

| Documento | Para qué sirve |
|---|---|
| [01-resumen-reto.md](01-resumen-reto.md) | Qué pide NASA y la lista de comprobación de entregables |
| [02-reglas-y-jurado.md](02-reglas-y-jurado.md) | Reglas, criterios de puntuación, premios, fechas y envío |
| [03-datos-firms.md](03-datos-firms.md) | Fuentes de datos, columnas, límites de la API, descarga para Perú/Cusco |
| [04-armonizacion.md](04-armonizacion.md) | Método científico para armonizar MODIS y VIIRS, y su validación |
| [05-estrategia-ganadora.md](05-estrategia-ganadora.md) | Cómo diferenciarnos, guion de 7 diapositivas, texto base del envío |
| [06-arquitectura-ddd.md](06-arquitectura-ddd.md) | Lenguaje ubicuo, contextos delimitados y capas para `armonization/`, `functions/` y `web/` |
| [07-plan-36h.md](07-plan-36h.md) | Cronograma por fases hasta el cierre |

## Lo esencial en cinco líneas

1. Hay que construir una **app web** con un **calendario de actividad de quema** sobre focos de calor **armonizados** de MODIS (2000→hoy) y VIIRS (2012→hoy).
2. La parte difícil y la que da puntos es la **armonización demostrada**, no el calendario.
3. Único recurso oficial: **NASA FIRMS**. Usarlo como núcleo cumple el requisito de dato NASA.
4. Caso de muestra: **Cusco, Perú**, con Madre de Dios como contraste amazónico.
5. El jurado puntúa sobre todo el **texto de la página del proyecto** y la **demo** (7 diapositivas o video de 30 s).

## Qué no se pudo leer

- **Pestaña Teams** del reto: solo carga con sesión iniciada.
- **Correo de NASA Space Apps**: no estaba en la cuenta de Gmail conectada. Lo permitido se tomó del sitio oficial.

## Fuentes

- Reto: <https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/?tab=details>
- Recursos del reto: <https://www.spaceappschallenge.org/2026/challenges/modis-and-viirs-hot-spots/?tab=resources>
- Guía de jurado y premios: <https://www.spaceappschallenge.org/resources/judging-awards-guide/>
- Guía de envío: <https://www.spaceappschallenge.org/resources/project-submission-guide/>
- Preguntas frecuentes: <https://www.spaceappschallenge.org/resources/participant-faqs/>
- Premios: <https://www.spaceappschallenge.org/awards/>
- Ofertas globales: <https://www.spaceappschallenge.org/2026/global-offers/>
- FIRMS: <https://www.earthdata.nasa.gov/data/tools/firms>
- API de FIRMS: <https://firms.modaps.eosdis.nasa.gov/api/area/>

Consultadas el 14 de noviembre de 2026.
