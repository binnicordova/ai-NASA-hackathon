# 07 · Plan hasta el cierre

Cierre: **domingo 15 de noviembre, 11:59 p. m. hora local**. Meta interna: enviar a las **9:00 p. m.** y usar el resto como margen.

El plan va por fases con presupuesto de horas, no por reloj, para que sirva sin importar a qué hora se empiece.

## Fases

| Fase | Horas | Resultado | Señal de avance |
|---|---|---|---|
| 0 · Arranque | 1 | Stack decidido, clave FIRMS, roles, repositorio listo | Todos pueden ejecutar el proyecto |
| 1 · Datos | 3 | Perú descargado, focos limpios en el modelo propio | Conteos por sensor y año revisados |
| 2 · Armonización | 5 | Celdas-día, factores por mes, serie armonizada | Gráfico antes/después en Cusco |
| 3 · Validación | 2 | Error en años reservados, Cusco y Madre de Dios | Dos números: error antes y después |
| 4 · App base | 6 | Mapa, área de interés, fechas, calendario | Se dibuja Cusco y aparece el calendario |
| 5 · Valor | 4 | Anomalía, temporada pico, años récord, CSV | Checklist del enunciado completo |
| 6 · Pulido | 3 | Rampa accesible, crudo / armonizado, página de método | Prueba con alguien ajeno al equipo |
| 7 · Entrega | 4 | Página del proyecto, 7 diapositivas, enlaces públicos | Todo abre en ventana privada |

Total: 28 horas de trabajo. El resto es descanso y margen.

## Trabajo en paralelo

| Rol | Fases 1–3 | Fases 4–6 | Fase 7 |
|---|---|---|---|
| Datos y ciencia | Ingesta y armonización | Validación y página de método | Texto del método |
| Backend | `functions/`: modelo de dominio e ingesta | Consultas de calendario y CSV | Despliegue |
| Frontend | Maqueta con datos de prueba | Mapa, calendario, exportación | Capturas |
| Historia y diseño | Borrador de la página del proyecto | Diapositivas | Revisión final y envío |

La página del proyecto se empieza **el primer día**, no al final.

## Orden de recorte si falta tiempo

Se sacrifica de abajo hacia arriba:

1. Exportación a PNG.
2. Vista diaria del calendario.
3. Madre de Dios como segundo caso.
4. Datos de los últimos días por la API.
5. Regresión avanzada: queda la razón mensual.

No se recorta nunca: armonización validada, calendario, anomalía frente a la mediana, selección de área, CSV, página del proyecto y demo.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Las descargas de FIRMS fallan o son lentas | Descargar todo en la fase 1 y guardarlo; reintentar los años que corten |
| La armonización no mejora el error | Mostrarlo igual, con explicación; la honestidad puntúa en Validez |
| Los datos pesan demasiado para el navegador | Servir agregados por celda y mes; focos crudos por año bajo demanda |
| La clave de FIRMS queda expuesta | Llamar a la API solo desde `functions/` |
| Dos personas editan la página del proyecto a la vez | Usar el candado de edición y guardar seguido |
| El despliegue falla a última hora | Desplegar una versión mínima el primer día |

## Puntos de control

- **Fin de la fase 3:** ¿hay gráfico antes/después con números? Si no, recortar alcance de la app, no de la ciencia.
- **Fin de la fase 5:** ¿el checklist del enunciado está completo? Congelar funciones nuevas.
- **Cuatro horas antes del cierre:** solo entrega. Nada de código nuevo.

## Próximo paso inmediato

1. Confirmar el stack ([06-arquitectura-ddd.md](06-arquitectura-ddd.md)).
2. Pedir la `MAP_KEY` de FIRMS.
3. Descargar el archivo de Perú, todos los sensores y años.
4. Crear la estructura de `web/` y `functions/`.
