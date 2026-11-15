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
- Promesas de predicción de incendios: la app describe, no predice.
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
- `src/etl/`: ingesta, limpieza, armonización y validación. Es la ciencia del proyecto.
- `functions/`: servicios headless que leen la serie armonizada y responden JSON/CSV a cualquier cliente (`web/`, y a futuro `expoapp/`, `wspagent/`, `ai/`). Sin ciencia de armonización y sin interfaz.
- `web/`: aplicación. Solo habla con `functions/`.
- `docs/`: análisis y decisiones.

Se usa **DDD**: respeta el lenguaje ubicuo, los contextos delimitados y las capas de [`docs/06-arquitectura-ddd.md`](docs/06-arquitectura-ddd.md). La documentación se escribe en español.

## Archivos grandes y contexto de IA

Estas reglas aplican a cualquier agente, herramienta y sesión de IA que trabaje en este repositorio:

- No cargues ni leas completos archivos de **10 MiB o más**, ni archivos de datos binarios como Parquet, en el contexto del chat por defecto. Esto incluye archivos de `data/`, aunque sean entradas o salidas importantes del proyecto.
- Antes de abrir archivos de datos, consulta solo sus nombres, tamaños, esquema o metadatos. Para entender su uso, prioriza el código ETL, las funciones, la documentación y los reportes resumidos.
- Lee o procesa el contenido de un archivo grande solo si la solicitud actual lo requiere explícitamente. En ese caso, limita la inspección a las columnas, filas, fechas o regiones necesarias; prefiere consultas y procesamiento en streaming a volcar el archivo completo al contexto.
- Si la tarea exige el contenido completo y no se puede resolver con una inspección acotada, explica qué archivo necesitas y por qué antes de cargarlo al chat.
- No leas datos grandes solo porque una prueba, servicio o script dependa de ellos: ejecuta la prueba o procesa los datos sin incorporar su contenido al contexto.

## Honestidad

Reporta los resultados como son. Si la armonización no mejora el error, o algo no está verificado, dilo: ocultarlo cuesta más puntos que declararlo.
