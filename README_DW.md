# Data Warehouse BIOX

El DW vive en una base PostgreSQL separada llamada `biox_dw`. El archivo SQL crea tablas de aterrizaje (`stg`), dimensiones compartidas (`dw.dim_*`), hechos e instantáneas, vistas analíticas y el procedimiento `dw.transform_staging`. Python solo extrae una fotografía consistente de `Biox_OLTP`, la carga en `stg` y llama al procedimiento; la transformación, el cálculo de KPIs y las validaciones se ejecutan en PostgreSQL.

## Inicialización

Ejecuta el script desde una terminal con `psql` y un usuario que pueda crear bases de datos y sea propietario del esquema operacional:

```powershell
psql -U postgres -f biox_dw.sql
```

El script crea `biox_dw` si todavía no existe. Si ya existe, vuelve a conectarse y aplica los objetos `CREATE ... IF NOT EXISTS` y las vistas.
La carga de instantáneas utiliza `MERGE` y requiere PostgreSQL 15 o superior.

## Instalar ETL y dashboard

```powershell
python --version  # Python 3.10 o superior
python -m pip install -r requirements_dw.txt
python etl_biox_dw_gui.py
```

La ventana tiene dos botones: **Probar conexiones** y **Ejecutar carga ETL**. También puedes abrir `Abrir_ETL_BIOX.bat` con doble clic. La carga requiere que `biox_dw.sql` se haya ejecutado una vez y que las conexiones a ambas bases estén configuradas.

Para ejecutarlo desde consola sin ventana: `python etl_biox_dw.py`.

## Dashboard Streamlit

El dashboard consulta las vistas analíticas `dw.vw_ventas_analiticas`, `dw.vw_inventario_analitico`, `dw.vw_afluencia_horaria` y `dw.vw_satisfaccion_analitica`, además de las instantáneas `dw.kpi_mensual` mediante `meta.vw_kpi_cumplimiento`. Presenta ingresos netos, transacciones, ticket promedio, volumen de productos, movimientos de inventario, afluencia y satisfacción. Incluye filtros de periodo y categoría; la categoría afecta ventas e inventario.

Para iniciarlo desde la terminal:

```powershell
python -m streamlit run dashboard_biox_dw.py
```

También puedes abrir `Abrir_Dashboard_BIOX.bat` con doble clic. Streamlit mostrará la dirección local del dashboard en la terminal.

La alerta de existencias actuales consulta `inventario.v_stock_actual` en `Biox_OLTP`. El ETL también captura esa vista en `dw.fact_existencias` para guardar una fotografía por ejecución y calcular productos bajo el mínimo por mes. `fact_inventario` conserva eventos de entrada y salida, no saldos disponibles. Configura `OLTP_DB_*` para esa conexión, o permite que reutilice `DB_*` del `.env`. Las métricas analíticas usan `DW_DB_*` (con los valores comunes `DB_*` como alternativa). La aplicación realiza consultas de solo lectura y conserva resultados en caché hasta cinco minutos; el botón **Actualizar datos** invalida la caché.

Las alertas inteligentes iniciales aplican reglas explícitas: stock bajo al alcanzar o quedar debajo del mínimo (crítico si es igual o menor al 50 % del mínimo), alta afluencia a partir del percentil 75 de entradas por hora del periodo, y satisfacción baja por debajo de 3.5/5 o por una caída de al menos 0.5 puntos contra el periodo anterior de igual duración.

`etl_biox_dw.py` lee la configuración existente del archivo `.env` sin imprimir contraseñas. Para la fuente utiliza `OLTP_DB_*` cuando existe y, si no, reutiliza `DB_*` (`DB_NAME` por defecto `Biox_OLTP`). Para el DW utiliza `DW_DB_*`; si faltan host, puerto, usuario o contraseña, reutiliza `DB_*`. El nombre destino por defecto es `biox_dw`.

Variables disponibles: `OLTP_DB_HOST`, `OLTP_DB_PORT`, `OLTP_DB_NAME`, `OLTP_DB_USER`, `OLTP_DB_PASSWORD`; `DW_DB_HOST`, `DW_DB_PORT`, `DW_DB_NAME`, `DW_DB_USER`, `DW_DB_PASSWORD`. La zona horaria comercial usada para la dimensión fecha y hora es `America/El_Salvador`.

## Modelo y medidas

- `dw.fact_ventas`: una fila por detalle de venta. `importe_linea` conserva `total_linea`; descuento e impuesto de cabecera se prorratean entre las líneas. `ingreso_neto_linea` resta el descuento asignado y excluye el impuesto; `utilidad_estimada` resta el costo de línea. Las vistas de ventas excluyen transacciones anuladas.
- `dw.fact_inventario`: una fila por movimiento operacional. Mantiene cantidad positiva, tipo y cantidad con signo. Es historia de movimientos, no una fotografía de existencias disponibles.
- `dw.fact_afluencia`: una fila por registro de entrada o salida. Sus conteos no representan visitantes únicos.
- `dw.fact_satisfaccion`: una fila por encuesta; conserva calificaciones numéricas y comentario textual.
- `dw.fact_existencias`: una fotografía por producto activo y ejecución ETL; conserva la evolución de los saldos sin confundirlos con eventos de inventario.
- `meta.kpi`: catálogo técnico y de negocio con fórmula, tipo (medida, métrica o indicador), periodicidad, dirección, fuente, responsable y acción correctiva.
- `meta.kpi_meta`: metas por KPI y mes. `categoria_uuid IS NULL` identifica una meta global; un índice único por expresión evita duplicados con categoría nula.
- `dw.kpi_mensual`: instantánea idempotente por KPI, mes y categoría. Conserva numerador y denominador junto al resultado.
- `dw.vw_kpi_consolidado` centraliza las fórmulas mensuales; `meta.vw_kpi_cumplimiento` calcula el porcentaje y el estado (`cumplido`, `atencion`, `critico`, `sin_meta` o `informativo`) según la dirección del indicador.
- `dw.dim_fecha` y `dw.dim_hora` son conformadas y se comparten entre los procesos temporales. `dim_hora` tiene granularidad de minuto e incluye intervalos de 15 minutos y franja horaria.
- `dim_producto`, `dim_categoria` y `dim_usuario` son dimensiones SCD tipo 2. Las nuevas versiones se crean cuando el ETL observa cambios. Como el OLTP no guarda versiones históricas, no se recuperan cambios ocurridos antes de la primera ejecución del ETL.
- `dw.transform_staging(run_uuid)` construye dimensiones y hechos, reparte descuento e impuesto por línea y valida filas y agregados contra staging. Python no implementa esas transformaciones.
- Al finalizar la validación, `dw.transform_staging` actualiza las instantáneas KPI con `MERGE`. Compara categorías nullable usando `IS NOT DISTINCT FROM` y solo actualiza valores que cambiaron.
- Las razones conservan sus componentes: el ticket se calcula como importe cobrado agregado entre transacciones distintas, y la satisfacción como suma de calificaciones entre encuestas. Nunca se promedian los promedios mensuales.
- Ingresos y transacciones se presentan en paralelo para vigilar volumen además del ticket. Los conteos de afluencia representan movimientos, no visitantes únicos.
- El catálogo no inventa metas numéricas. Mientras no se configure una meta aprobada, el semáforo indica `Sin meta`.
- El OLTP actual no tiene sucursal; por eso el alcance institucional se representa con `categoria_uuid IS NULL`. Las fotos de existencias empiezan a formar historia desde la primera ejecución del ELT que cargue esta versión.
- Los UUID de origen se conservan como claves de trazabilidad; las dimensiones usan claves sustitutas en los hechos.

El saldo disponible debe calcularse con la lógica de existencias del OLTP, en particular la vista `inventario.v_stock_actual` (las botellas se controlan mediante envases). No debe obtenerse sumando sin distinción todos los movimientos históricos.

## Consultas analíticas

```sql
SELECT * FROM dw.vw_ventas_diarias ORDER BY fecha;
SELECT * FROM dw.vw_ventas_resumen_diario ORDER BY fecha;
SELECT * FROM dw.vw_inventario_analitico ORDER BY fecha, hora;
SELECT * FROM dw.vw_inventario_diario ORDER BY fecha;
SELECT * FROM dw.vw_afluencia_horaria ORDER BY fecha, hora;
SELECT * FROM dw.vw_satisfaccion_analitica ORDER BY fecha, hora;
SELECT * FROM dw.vw_satisfaccion_diaria ORDER BY fecha;
SELECT * FROM dw.etl_runs ORDER BY started_at DESC;
SELECT * FROM meta.kpi ORDER BY kpi_id;
SELECT * FROM meta.vw_kpi_cumplimiento ORDER BY anio_mes, codigo, categoria;
```

### Configurar una meta mensual

Configura una meta solo después de acordar su valor de negocio. Este ejemplo agrega o actualiza una meta global de ingresos para el mes actual; reemplaza `1000.00` por el objetivo aprobado.

```sql
INSERT INTO meta.kpi_meta (kpi_id, anio_mes, categoria_uuid, valor_meta)
SELECT kpi_id, date_trunc('month', CURRENT_DATE)::date, NULL, 1000.00
FROM meta.kpi
WHERE codigo = 'ventas_ingresos_netos'
ON CONFLICT (
    kpi_id,
    anio_mes,
    (COALESCE(categoria_uuid, '00000000-0000-0000-0000-000000000000'::uuid))
)
DO UPDATE SET valor_meta = EXCLUDED.valor_meta, actualizado_en = now();
```

Para una meta por categoría, coloca su UUID en `categoria_uuid`. Las metas son mensuales. El semáforo normaliza la dirección: para `mayor`, divide resultado entre meta; para `menor`, divide meta entre resultado. Verde indica al menos 100 % de cumplimiento, amarillo el umbral configurado (80 % por defecto) y rojo un resultado inferior.
