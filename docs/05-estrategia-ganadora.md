# 05 · Estrategia para ganar

## Dónde está la ventaja

Una búsqueda de repositorios públicos del reto muestra equipos que ya publican un calendario sobre conteos de FIRMS, por ejemplo [FireChronicle](https://github.com/bhavishyaone1/FireChronicle), [fire-harmony](https://github.com/Warren-530/fire-harmony) y [kiln-watch](https://github.com/Aalvee-Aarham/kiln-watch-2026). El calendario es el mínimo esperado.

Lo que separa a un ganador:

| Diferenciador | Criterio que sube |
|---|---|
| Armonización **validada**, con gráfico antes/después | Validez, Relevancia |
| **Incertidumbre visible** en los años solo MODIS | Validez, Creatividad |
| Interfaz que **responde preguntas** de un gestor de emergencias | Impacto, Presentación |
| Caso local real: **Cusco** | Impacto, premio Local Impact |
| Límites declarados con honestidad | Validez |
| Checklist del enunciado cubierto al 100 % | Relevancia |

## Mensaje en una frase

> Un solo calendario de fuego de 26 años para cualquier zona del Perú, donde ya no importa qué satélite vio cada foco, y que dice hoy si este mes es normal o excepcional.

## Las tres preguntas que la app debe responder en la primera pantalla

1. **¿Cuándo quema esta zona?** → calendario año × mes.
2. **¿Este mes es normal?** → tarjeta de anomalía frente a la mediana histórica.
3. **¿Puedo confiar en la comparación entre años?** → interruptor crudo / armonizado y banda de incertidumbre.

## Guion de la demo: 7 diapositivas

| # | Diapositiva | Contenido |
|---|---|---|
| 1 | Portada | Nombre, equipo, reto, una imagen del calendario |
| 2 | El problema | Dos sensores, dos reglas distintas: el salto falso de 2012 en un gráfico |
| 3 | Para quién | Gestor de emergencias en Cusco: qué necesita decidir y cuándo |
| 4 | El método | Celdas-día, par Aqua / S-NPP, calibración por mes, en un solo diagrama |
| 5 | La prueba | Gráfico antes/después con el error en años reservados |
| 6 | La app | Capturas: mapa, calendario, anomalía, descarga CSV |
| 7 | Impacto y siguiente paso | Límites declarados, extensión a todo el país y a otros países |

Regla: una idea por diapositiva y números propios, no genéricos.

Si se opta por video de 30 segundos: 5 s problema, 10 s prueba antes/después, 12 s la app en uso, 3 s cierre.

## Texto base para la página del proyecto

**Resumen de alto nivel** (borrador a completar con cifras reales):

> Construimos una aplicación web que unifica los focos de calor de MODIS (2000–hoy) y VIIRS (2012–hoy) de NASA FIRMS en una sola serie comparable y la muestra como un calendario de actividad de quema para cualquier área del Perú. Los dos sensores no se pueden comparar directamente: VIIRS detecta varias veces más focos por su mayor resolución. Nuestro método convierte ambas series a una unidad común, las calibra en su periodo compartido y valida el resultado con años reservados, reduciendo el error de **[X %]** a **[Y %]**. Un gestor de emergencias puede dibujar su zona, ver qué meses y años concentran el fuego, saber si el mes actual está por encima de la mediana histórica y descargar los focos en CSV.

**Detalles del proyecto:** qué hace, cómo funciona el método (resumen de [04-armonizacion.md](04-armonizacion.md)), beneficios, límites, herramientas y lenguajes.

**Uso de IA:** declarar con precisión qué herramientas de IA se usaron y para qué: análisis del reto, redacción de documentación, apoyo en código. El formulario lo exige.

**Datos de NASA:** FIRMS, archivo por país y API de área, con los productos MODIS y VIIRS exactos y las fechas de descarga.

**Referencias:** bibliotecas de mapa y gráficos, límites departamentales, cualquier imagen o fragmento de código externo.

## Errores que hay que evitar

- Sumar focos de MODIS y VIIRS y llamarlo armonización.
- Dejar la página del proyecto para la última hora.
- Enlaces de demo que piden permiso o inicio de sesión.
- Prometer predicción de incendios: la app no predice.
- Olvidar la declaración de IA o las referencias.
- Rampa de color rojo-verde, ilegible para personas con daltonismo.

## Antes de enviar

- [ ] Los ocho campos de la página del proyecto están completos.
- [ ] Demo y proyecto abren en una ventana privada sin iniciar sesión.
- [ ] El gráfico antes/después está en la app y en la demo.
- [ ] La declaración de IA está escrita.
- [ ] FIRMS figura como dato NASA, con detalle.
- [ ] Las referencias incluyen todo lo externo.
- [ ] Alguien ajeno al equipo entendió la demo sin explicación.
