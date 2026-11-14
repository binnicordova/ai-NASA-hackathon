# Reporte de Auditoría y Armonización NASA FIRMS (2000–2026)

Este documento registra la auditoría exhaustiva de los archivos fuente de NASA FIRMS para Perú, la contabilidad exacta de limpieza y filtrado, el método de armonización espacio-temporal H3 con normalización multi-satélite y la validación cuantitativa antes/después.

## 1. Contabilidad Global de Limpieza y Deduplicación

| Etapa del Pipeline | Registros | Delta / Filtrados | Descripción |
|---|---:|---:|---|
| Lectura cruda (`14` CSV) | 2,439,271 | — | Total de detecciones en `data/2000 al 2012`, `2013 al 2023` y `2024 al 2026` |
| Filtro de baja confianza (`'l'`) | 2,289,271 | -150,000 | MODIS `< 30` y VIIRS `'l'` descartados para eliminar falsos positivos |
| Deduplicación Archive vs NRT | 2,289,177 | -94 | Clave `(satellite, acq_date, acq_time, round(lat,4), round(lon,4))` priorizando `archive` |
| Máscara estática H3 Res 7 (`MCD14ML`) | 2,184,650 | -104,527 | 1,131 hexágonos H3 Res 7 donde MODIS Archive reporta `type != 0` (volcanes, industria, mar) aplicados a MODIS y VIIRS |
| Otros `type != 0` residuales (VIIRS Archive) | 2,168,246 | -16,404 | Detecciones VIIRS Archive `type != 0` fuera de la máscara MODIS Res 7 |
| **Agregación diaria `(h3_res6, acq_date, instrument)`** | **1,090,622** | — | Celdas-día activas (`952,908` filas en la serie primaria continua) |

## 2. Auditoría Detallada por Archivo Fuente

| Archivo | Producto | Tipo | Filas Crudas | Baja Confianza (`l`) | Máscara Estática + `type!=0` | Filas Limpias (est.) | Rango `acq_date` | Satélites | Versiones |
|---|---|---|---:|---:|---:|---:|---|---|---|
| `fire_archive_M-C61_849537.csv` | `M-C61` | `archive` | 163,029 | 10,076 | 5,642 | 147,311 | `2000-11-01` → `2012-12-31` | Aqua, Terra | 6.03 |
| `fire_archive_SV-C2_849540.csv` | `SV-C2` | `archive` | 80,482 | 4,043 | 3,319 | 73,120 | `2012-01-20` → `2012-12-31` | SNPP | 2 |
| `fire_archive_J1V-C2_849110.csv` | `J1V-C2` | `archive` | 470,596 | 29,456 | 24,163 | 416,977 | `2018-04-01` → `2023-12-31` | N20 | 2 |
| `fire_archive_J2V-C2_849111.csv` | `J2V-C2` | `archive` | 75,327 | 4,866 | 3,955 | 66,506 | `2023-03-01` → `2023-12-31` | N21 | 2 |
| `fire_archive_M-C61_849109.csv` | `M-C61` | `archive` | 165,859 | 9,914 | 7,730 | 148,215 | `2013-01-01` → `2023-12-31` | Aqua, Terra | 6.03, 61.03 |
| `fire_archive_SV-C2_849112.csv` | `SV-C2` | `archive` | 813,081 | 47,203 | 42,233 | 723,645 | `2013-01-01` → `2023-12-31` | SNPP | 2 |
| `fire_archive_J1V-C2_849120.csv` | `J1V-C2` | `archive` | 171,349 | 11,263 | 10,158 | 149,928 | `2024-01-01` → `2026-07-31` | N20 | 2 |
| `fire_nrt_J1V-C2_849120.csv` | `J1V-C2` | `nrt` | 44,689 | 3,643 | 870 | 40,176 | `2026-08-01` → `2026-11-13` | N20 | 2.0NRT |
| `fire_archive_J2V-C2_849121.csv` | `J2V-C2` | `archive` | 167,714 | 10,397 | 9,807 | 147,510 | `2024-01-01` → `2026-07-31` | N21 | 2 |
| `fire_nrt_J2V-C2_849121.csv` | `J2V-C2` | `nrt` | 41,185 | 3,662 | 845 | 36,678 | `2026-08-01` → `2026-11-14` | N21 | 2.0NRT |
| `fire_archive_M-C61_849119.csv` | `M-C61` | `archive` | 33,271 | 1,966 | 1,617 | 29,688 | `2024-01-01` → `2026-08-31` | Aqua, Terra | 61.03 |
| `fire_nrt_M-C61_849119.csv` | `M-C61` | `nrt` | 4,264 | 218 | 80 | 3,966 | `2026-09-01` → `2026-11-13` | Aqua, Terra | 6.1NRT |
| `fire_archive_SV-C2_849122.csv` | `SV-C2` | `archive` | 164,860 | 10,062 | 9,676 | 145,122 | `2024-01-01` → `2026-07-31` | SNPP | 2 |
| `fire_nrt_SV-C2_849122.csv` | `SV-C2` | `nrt` | 43,565 | 3,231 | 836 | 39,498 | `2026-08-01` → `2026-11-01` | SNPP | 2.0NRT |

### Esquema de columnas detectado en los archivos fuente

- **Archivos `archive` (MODIS y VIIRS, 10 archivos):** `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight, type`.
- **Archivos `nrt` (MODIS y VIIRS, 4 archivos):** `latitude, longitude, brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_t31, frp, daynight` (sin columna `type`).
- **Hallazgo de auditoría:** En los archivos `SV-C2` (S-NPP), la columna `instrument` viene etiquetada como `'SNPP'` en lugar de `'VIIRS'`, por lo que el pipeline normaliza el sensor a partir de `satellite` (`Terra`/`Aqua` → `MODIS`; `SNPP`/`N20`/`N21` → `VIIRS`). Asimismo, aunque los archivos descargados usan `brightness`/`bright_t31`, el pipeline estandariza también `bright_ti4`/`bright_ti5` hacia `bright_mir`/`bright_tir`.

## 3. Factores de Calibración y Neutralización Multi-Satélite

Para lograr que **el sensor de origen no importe** ni en la transición MODIS→VIIRS (2012) ni ante la entrada de NOAA-20 (2018) y NOAA-21 (2023), toda la serie se expresa en una unidad física común: **celdas-día H3 Resolución 6 equivalentes a 1 satélite VIIRS de referencia (S-NPP)**.

1. **Neutralización multi-satélite VIIRS (`beta_{k, month}`):** Aunque agregar por `(h3_res6, acq_date, VIIRS)` colapsa detecciones repetidas en la misma celda, distintos satélites VIIRS pasan con ~50 minutos de desfase y diferente geometría/nubosidad, por lo que 2 satélites observan ~1.75× más celdas distintas que 1 satélite y 3 satélites ~2.25×. Calibramos $\beta_{k,m} = \text{mediana}(\text{celdas}_{1\text{-sat}} / \text{celdas}_{\text{unión } k\text{-sat}})$ sobre 2012–2025.
2. **Calibración estacional MODIS → 1-VIIRS (`alpha_month`):** Calculada sobre el solapamiento 2012–2025 como la mediana mensual de $\text{VIIRS}_{1\text{-eq}} / \text{MODIS}$, capturando que en meses húmedos (feb–abr) hay más quemas pequeñas solo detectadas por VIIRS ($\alpha \approx 6.8\text{–}7.6$) que en temporada seca pico (ago–sep, $\alpha \approx 3.4\text{–}3.8$).
3. **Régimen inicial solo Terra (2000-11-01 a 2002-07-03) con regularización por saturación:** En Perú (`2003–2024`), la pasada matutina de Terra (~10:30 hora local, con nubosidad matinal amazónica/andina) captura solo el 14%–30% de las celdas diarias de MODIS (`Terra+Aqua`), por lo que el ratio intra-MODIS $\gamma_{\text{Terra}, m} = \text{mediana}(\text{MODIS}_{\text{Terra+Aqua}} / \text{MODIS}_{\text{Terra}})$ es 3.17–7.15. Sin embargo, en noviembre–diciembre 2000 (puesta en marcha inicial de Terra, con 783 celdas-día en solo 2 meses vs 800 en los 12 meses de 2001), el conteo de Terra ya supera la mediana combinada `Terra+Aqua` ($M_{\text{med}, 11} = 378$). Aplicando regularización por saturación ($\gamma_{\text{eff}} = 1.0$ cuando $T_{y,m} \ge M_{\text{med}, m}$), 2000 (nov–dic) queda en **3,972.7** (sin inflación artificial) y 2001 completo en **20,613.9**.

| Mes | $\alpha_m$ (MODIS → 1-VIIRS) | Rango IQR $\alpha_m$ | $\beta_{2,m}$ (2 VIIRS) | $\beta_{3,m}$ (3 VIIRS) | $\gamma_{\text{Terra},m}$ (Intra-MODIS) | $\alpha_{\text{FRP},m}$ |
|---:|---:|---:|---:|---:|---:|---:|
| 01 | 5.799 | [5.301, 6.390] | 0.5636 | 0.4273 | 5.639 | 2.816 |
| 02 | 6.805 | [5.912, 8.475] | 0.5511 | 0.4007 | 4.653 | 3.260 |
| 03 | 7.543 | [7.252, 7.814] | 0.5313 | 0.4018 | 3.165 | 3.104 |
| 04 | 7.608 | [6.336, 8.595] | 0.5381 | 0.4009 | 3.571 | 2.761 |
| 05 | 6.100 | [5.755, 6.715] | 0.5381 | 0.4097 | 4.482 | 2.817 |
| 06 | 5.593 | [5.273, 6.515] | 0.5512 | 0.4315 | 5.334 | 2.693 |
| 07 | 4.577 | [4.168, 4.986] | 0.5719 | 0.4563 | 5.603 | 2.398 |
| 08 | 3.818 | [3.440, 4.147] | 0.6246 | 0.5229 | 6.644 | 2.304 |
| 09 | 3.383 | [3.232, 3.649] | 0.6350 | 0.5218 | 7.146 | 2.141 |
| 10 | 4.604 | [4.216, 4.781] | 0.5951 | 0.4788 | 7.030 | 2.628 |
| 11 | 5.013 | [3.994, 5.740] | 0.5661 | 0.4446 | 4.366 | 2.477 |
| 12 | 5.984 | [5.025, 6.471] | 0.5650 | 0.4323 | 3.535 | 2.406 |

## 4. Validación Científica (Antes vs. Después de Armonizar)

Se realizó validación **fuera de muestra (holdout 2021–2024)** calibrando únicamente con 2012–2020 y evaluando la capacidad de MODIS para predecir la actividad equivalente de VIIRS en 2021–2024 (incluyendo la entrada de NOAA-21 en 2023):

| Escenario de Evaluación | Métrica | Antes: Conteos Crudos (MODIS vs VIIRS) | Intermedio: Celdas H3 Res 6 sin Calibrar | **Después: Serie Armonizada** |
|---|---|---:|---:|---:|
| Holdout 2021–2024 (Mensual) | MAPE (%) | 92.89% | 89.85% | **15.12%** |
| Holdout 2021–2024 (Mensual) | Sesgo (%) | -91.77% | -86.56% | **4.02%** |
| Holdout 2021–2024 (Mensual) | Correlación ($r$) | 0.9664 | 0.9755 | **0.9879** |
| Holdout 2021–2024 (Anual) | MAPE (%) | 91.34% | 86.40% | **5.59%** |
| Solapamiento Completo 2013–2025 (Anual) | MAPE (%) | 86.77% | 82.45% | **6.26%** |
| Solapamiento Completo 2013–2025 (Anual) | Sesgo (%) | -89.22% | -84.07% | **0.99%** |

## 5. Serie Anual Comparativa (2000–2026): Crudo vs. Armonizado

Comprobación visual de continuidad entre regímenes de sensores: `2000` (parcial nov-dic), `2001` (completo solo Terra), `2011 → 2012` (inicio VIIRS S-NPP), `2017 → 2018` (entrada NOAA-20), `2022 → 2023` (entrada NOAA-21) y `2026` (parcial hasta 14-nov).

| Año | `raw_modis` | `raw_viirs` | `cell_days_unharmonized` | `harmonized_fire_activity` | MODIS Calibrado (Validación) | `harmonized_frp` (MW) | Régimen / Notas |
|---:|---:|---:|---:|---:|---:|---:|---|
| 2000 | 1,153 | 0 | 783 | **3,972.4** | 3,972 | 62,612.2 | Parcial (`is_partial_year=true`): Solo Terra (nov-dic 2000) |
| 2001 | 987 | 0 | 800 | **20,613.9** | 20,614 | 299,783.6 | Solo Terra + `SENSOR_OUTAGE` jun-jul |
| 2002 | 6,400 | 0 | 4,601 | **21,698.5** | 21,698 | 337,515.3 | Terra hasta jul-03; Terra+Aqua desde jul-04 |
| 2003 | 13,603 | 0 | 9,453 | **39,599.3** | 39,599 | 647,131.5 | MODIS Terra+Aqua |
| 2004 | 10,038 | 0 | 7,061 | **30,372.4** | 30,372 | 402,349.5 | MODIS Terra+Aqua |
| 2005 | 20,443 | 0 | 13,820 | **57,716.1** | 57,716 | 974,236.8 | MODIS Terra+Aqua |
| 2006 | 11,389 | 0 | 8,097 | **33,856.5** | 33,856 | 532,832.2 | MODIS Terra+Aqua |
| 2007 | 16,056 | 0 | 10,681 | **44,654.1** | 44,654 | 732,331.8 | MODIS Terra+Aqua + `SENSOR_OUTAGE` ago |
| 2008 | 12,218 | 0 | 8,419 | **34,862.7** | 34,863 | 584,023.2 | MODIS Terra+Aqua |
| 2009 | 10,157 | 0 | 7,248 | **30,046.0** | 30,046 | 490,564.6 | MODIS Terra+Aqua + `SENSOR_OUTAGE` abr 21-22 |
| 2010 | 18,063 | 0 | 12,311 | **50,251.3** | 50,251 | 858,797.5 | MODIS Terra+Aqua |
| 2011 | 9,919 | 0 | 6,901 | **28,592.5** | 28,592 | 452,703.8 | MODIS Terra+Aqua |
| 2012 | 16,885 | 73,117 | 45,626 | **41,356.3** | 45,672 | 753,835.1 | Transición a VIIRS S-NPP (desde ene-20) |
| 2013 | 11,052 | 57,108 | 36,368 | **32,927.0** | 31,486 | 582,915.8 | VIIRS 1-sat |
| 2014 | 9,592 | 51,394 | 33,464 | **30,332.0** | 28,460 | 490,166.3 | VIIRS 1-sat |
| 2015 | 13,352 | 62,688 | 41,292 | **37,095.0** | 37,554 | 638,139.2 | VIIRS 1-sat |
| 2016 | 17,227 | 81,755 | 51,142 | **45,757.0** | 50,525 | 822,747.2 | VIIRS 1-sat |
| 2017 | 10,036 | 50,726 | 34,090 | **30,812.0** | 29,789 | 496,594.7 | VIIRS 1-sat |
| 2018 | 12,092 | 107,671 | 56,405 | **33,641.1** | 34,566 | 540,433.5 | Entrada NOAA-20 (2 satélites VIIRS) |
| 2019 | 15,506 | 133,752 | 66,402 | **38,547.0** | 42,483 | 690,960.0 | VIIRS 2-sat |
| 2020 | 16,115 | 176,866 | 89,222 | **51,242.4** | 49,462 | 913,781.7 | VIIRS 2-sat |
| 2021 | 12,079 | 120,498 | 61,724 | **35,680.1** | 35,218 | 625,350.0 | VIIRS 2-sat |
| 2022 | 17,012 | 158,371 | 77,637 | **44,567.1** | 49,465 | 850,427.1 | VIIRS 2-sat |
| 2023 | 14,152 | 206,233 | 87,539 | **42,165.0** | 41,025 | 731,355.4 | Entrada NOAA-21 (3 satélites VIIRS) |
| 2024 | 19,147 | 273,198 | 102,844 | **48,563.8** | 51,641 | 970,977.9 | VIIRS 3-sat |
| 2025 | 7,419 | 140,666 | 64,558 | **29,758.3** | 24,370 | 479,104.8 | 3 VIIRS (deriva orbital MODIS observada) |
| 2026 | 7,088 | 145,023 | 62,617 | **29,550.2** | 22,135 | 533,463.3 | Parcial (`is_partial_year=true`): hasta 2026-11-14 (S-NPP hasta 2026-11-01) |

## 6. Control de Calidad de Fechas (`SENSOR_OUTAGE`) y Limitaciones Declaradas

- **Banderas `SENSOR_OUTAGE`:** Se marcaron **240** registros diarios MODIS en las ventanas documentadas de `readme data.txt`: `2001-06-14..2001-07-05` (20 días sin detecciones jun-jul 2001), `2007-08-15..2007-08-19` (corte 17 ago 2007) y `2009-04-20..2009-04-22` (corte parcial 21 abr y total 22 abr 2009).
- **Banderas `is_partial_year`:** En `calendar_summary.json` se marcan explícitamente `2000` (solo nov–dic) y `2026` (hasta el 14 de noviembre) con `"is_partial_year": true`.
- **Enriquecimiento departamental:** Cada celda H3 Res 6 en `h3_spatial_grid.json` y `harmonized_fires.parquet` incluye su `department` (24 departamentos del Perú) y `natural_region` (`Costa`, `Sierra`, `Selva`).
- **2025–2026 (Deriva orbital MODIS):** Durante 2025–2026, los conteos de MODIS (`raw_modis`: 7,419 en 2025 vs 19,147 en 2024) caen proporcionalmente más que VIIRS debido a la deriva orbital de fin de vida útil de Terra/Aqua; al emplear VIIRS normalizado como serie primaria desde 2012, la serie armonizada no sufre ese sesgo de degradación.
- **Interpretación física:** Un foco de calor (`Hotspot`) ni una `ActiveCellDay` equivalen a superficie quemada ni a número de incendios individuales; ausencia de detección puede deberse a cobertura nubosa o humo denso.
