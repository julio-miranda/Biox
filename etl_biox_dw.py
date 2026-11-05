
#!/usr/bin/env python3
"""ETL BIOX: extracción del OLTP, transformación en Python y carga al DW."""

from __future__ import annotations

import json
import logging
import os
import sys
import uuid
from collections import defaultdict
from datetime import datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from dotenv import load_dotenv
from psycopg.conninfo import make_conninfo


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

LOG = logging.getLogger("biox_dw_etl")
BATCH_SIZE = 5000
TZ = ZoneInfo("America/El_Salvador")
ZERO = Decimal("0")
CENT = Decimal("0.01")


EXTRACTS = (
    ("categorias", """
        SELECT categorias_id, nombre, descripcion, activo, created_at, updated_at
        FROM catalogo.categorias ORDER BY categorias_id
    """),
    ("productos", """
        SELECT productos_id, categoria_id, nombre, tipo, unidad_medida,
               precio, costo_promedio, stock_minimo, activo, created_at, updated_at
        FROM catalogo.productos ORDER BY productos_id
    """),
    ("usuarios", """
        SELECT usuarios_id, nombre, role::text, activo, created_at, updated_at
        FROM seguridad.usuarios ORDER BY usuarios_id
    """),
    ("ventas", """
        SELECT ventas_id, usuario_id, subtotal, descuento, impuesto, total,
               metodo_pago, estado, mesa_numero, created_at
        FROM ventas.ventas ORDER BY ventas_id
    """),
    ("venta_detalle", """
        SELECT venta_detalle_id, venta_id, producto_id, cantidad,
               precio_unitario, costo_unitario, total_linea, created_at
        FROM ventas.venta_detalle ORDER BY venta_detalle_id
    """),
    ("movimientos_stock", """
        SELECT movimientos_stock_id, producto_id, usuario_id, proveedor_id,
               venta_id, envase_id, tipo, cantidad, unidad_medida, costo,
               observacion, reversa_de_movimiento_id, created_at
        FROM inventario.movimientos_stock ORDER BY movimientos_stock_id
    """),
    ("registros_afluencia", """
        SELECT registros_afluencia_id, usuario_id, tipo_movimiento,
               cantidad, observacion, created_at
        FROM operaciones.registros_afluencia ORDER BY registros_afluencia_id
    """),
    ("satisfaccion_encuestas", """
        SELECT satisfaccion_encuestas_id, venta_id, mesa_numero,
               calificacion_general, ambiente, musica, atencion, seguridad,
               limpieza, tiempo_espera, recomendacion, comentario, canal, created_at
        FROM experiencia.satisfaccion_encuestas
        ORDER BY satisfaccion_encuestas_id
    """),
    ("existencias_actuales", """
        SELECT productos_id, categorias_id, stock_actual, stock_minimo,
               CASE WHEN tipo = 'botella' THEN 'ml' ELSE unidad_medida END,
               transaction_timestamp()
        FROM inventario.v_stock_actual
        WHERE activo = true ORDER BY productos_id
    """),
)


STAGING_COLUMNS = {
    "categorias": (
        "source_uuid", "nombre", "descripcion", "activo", "created_at", "updated_at"
    ),
    "productos": (
        "source_uuid", "categoria_uuid", "nombre", "tipo", "unidad_medida",
        "precio", "costo_promedio", "stock_minimo", "activo", "created_at", "updated_at"
    ),
    "usuarios": (
        "source_uuid", "nombre", "role", "activo", "created_at", "updated_at"
    ),
    "ventas": (
        "source_uuid", "usuario_uuid", "subtotal", "descuento", "impuesto",
        "total", "metodo_pago", "estado", "mesa_numero", "created_at"
    ),
    "venta_detalle": (
        "source_uuid", "venta_uuid", "producto_uuid", "cantidad",
        "precio_unitario", "costo_unitario", "total_linea", "created_at"
    ),
    "movimientos_stock": (
        "source_uuid", "producto_uuid", "usuario_uuid", "proveedor_uuid",
        "venta_uuid", "envase_uuid", "tipo", "cantidad", "unidad_medida",
        "costo", "observacion", "reversa_de_uuid", "created_at"
    ),
    "registros_afluencia": (
        "source_uuid", "usuario_uuid", "tipo_movimiento",
        "cantidad", "observacion", "created_at"
    ),
    "satisfaccion_encuestas": (
        "source_uuid", "venta_uuid", "mesa_numero", "calificacion_general",
        "ambiente", "musica", "atencion", "seguridad", "limpieza",
        "tiempo_espera", "recomendacion", "comentario", "canal", "created_at"
    ),
    "existencias_actuales": (
        "source_uuid", "categoria_uuid", "stock_actual",
        "stock_minimo", "unidad_medida", "capturado_en"
    ),
}


TRUNCATE_STAGING_SQL = """
TRUNCATE TABLE
    stg.satisfaccion_encuestas,
    stg.existencias_actuales,
    stg.registros_afluencia,
    stg.movimientos_stock,
    stg.venta_detalle,
    stg.ventas,
    stg.usuarios,
    stg.productos,
    stg.categorias
"""


def env(name, fallback=None, default=None):
    value = os.getenv(name)

    if value:
        return value

    if fallback and os.getenv(fallback):
        return os.getenv(fallback)

    return default


def conninfo(prefix, source=False):
    params = {
        "host": env(f"{prefix}_HOST", "DB_HOST", "localhost"),
        "port": env(f"{prefix}_PORT", "DB_PORT", "5432"),
        "dbname": (
            env("OLTP_DB_NAME", "DB_NAME", "Biox_OLTP")
            if source else env("DW_DB_NAME", default="biox_dw")
        ),
        "user": env(f"{prefix}_USER", "DB_USER", "postgres"),
        "application_name": "biox_dw_etl",
        "connect_timeout": "5",
    }

    password = env(f"{prefix}_PASSWORD", "DB_PASSWORD")

    if password:
        params["password"] = password

    return make_conninfo(**params)


def test_connections() -> dict[str, str]:
    """Comprueba las conexiones a la base operacional y al Data Warehouse."""

    databases = {
        "OLTP": conninfo("OLTP_DB", source=True),
        "DW": conninfo("DW_DB"),
    }

    results = {}

    for name, connection_string in databases.items():
        with psycopg.connect(connection_string) as connection:
            results[name] = connection.execute(
                "SELECT current_database()"
            ).fetchone()[0]

    return results


def decimal(value):
    return Decimal(str(value or 0))


def money(value):
    return decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def local_datetime(value):
    if value.tzinfo is None:
        raise ValueError("Se recibió una fecha sin zona horaria.")

    return value.astimezone(TZ)


def extract(source, target_cursor):
    """Extrae los datos del OLTP y los deposita en staging."""

    counts = {}

    for table, query in EXTRACTS:
        columns = STAGING_COLUMNS[table]

        sql = (
            f"INSERT INTO stg.{table} "
            f"({', '.join(columns)}) "
            f"VALUES ({', '.join(['%s'] * len(columns))})"
        )

        counts[table] = 0

        with source.cursor(name=f"extract_{table}") as cursor:
            cursor.itersize = BATCH_SIZE
            cursor.execute(query)

            while batch := cursor.fetchmany(BATCH_SIZE):
                target_cursor.executemany(sql, batch)
                counts[table] += len(batch)

    return counts


def read_staging(cursor, table):
    cursor.execute(f"SELECT * FROM stg.{table}")
    columns = [column.name for column in cursor.description]

    return [
        dict(zip(columns, row))
        for row in cursor.fetchall()
    ]


def load_dimensions(cursor, data, run_time):
    """Transforma y carga dimensiones con historial SCD tipo 2."""

    timestamps = []

    for table in (
        "ventas", "movimientos_stock", "registros_afluencia",
        "satisfaccion_encuestas", "existencias_actuales"
    ):
        for row in data[table]:
            timestamps.append(
                row.get("created_at") or row.get("capturado_en")
            )

    dates = set()
    minutes = set()

    for timestamp in timestamps:
        if timestamp:
            local = local_datetime(timestamp)
            dates.add(local.date())
            minutes.add(local.hour * 60 + local.minute)

    month_names = (
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    )

    day_names = (
        "lunes", "martes", "miércoles", "jueves",
        "viernes", "sábado", "domingo"
    )

    for d in dates:
        cursor.execute(
            """
            INSERT INTO dw.dim_fecha (
                fecha, dia, mes, nombre_mes, trimestre, anio,
                dia_semana_iso, nombre_dia, semana_iso, es_fin_semana
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (fecha) DO NOTHING
            """,
            (
                d, d.day, d.month, month_names[d.month - 1],
                (d.month - 1) // 3 + 1, d.year,
                d.isoweekday(), day_names[d.weekday()],
                d.isocalendar().week, d.weekday() >= 5,
            ),
        )

    for minute in minutes:
        h, m = divmod(minute, 60)
        start = minute - minute % 15
        end = min(start + 14, 1439)

        cursor.execute(
            """
            INSERT INTO dw.dim_hora (
                minuto_dia, hora, hora_del_dia, minuto,
                intervalo_15_min, franja_horaria
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (minuto_dia) DO NOTHING
            """,
            (
                minute, time(h, m), h, m,
                f"{start // 60:02}:{start % 60:02}-"
                f"{end // 60:02}:{end % 60:02}",
                (
                    "madrugada" if h < 6 else
                    "mañana" if h < 12 else
                    "tarde" if h < 18 else "noche"
                ),
            ),
        )

    dimensions = (
        ("categorias", "dim_categoria", "categoria_uuid",
         ("nombre", "descripcion", "activo")),
        ("productos", "dim_producto", "producto_uuid",
         ("categoria_uuid", "nombre", "tipo", "unidad_medida",
          "precio", "costo_promedio", "stock_minimo", "activo")),
        ("usuarios", "dim_usuario", "usuario_uuid",
         ("nombre", "role", "activo")),
    )

    for source, table, key, attributes in dimensions:
        for row in data[source]:
            identifier = row["source_uuid"]
            values = tuple(row[a] for a in attributes)

            cursor.execute(
                f"""
                SELECT {', '.join(attributes)}
                FROM dw.{table}
                WHERE {key} = %s AND es_actual
                """,
                (identifier,),
            )

            current = cursor.fetchone()

            if current and tuple(current) == values:
                continue

            if current:
                cursor.execute(
                    f"""
                    UPDATE dw.{table}
                    SET es_actual = false, vigente_hasta = %s
                    WHERE {key} = %s AND es_actual
                    """,
                    (run_time, identifier),
                )

            columns = [key, *attributes, "vigente_desde", "es_actual"]

            effective_date = (
                datetime(1900, 1, 1, tzinfo=timezone.utc)
                if not current else run_time
            )

            cursor.execute(
                f"""
                INSERT INTO dw.{table} ({', '.join(columns)})
                VALUES ({', '.join(['%s'] * len(columns))})
                """,
                (identifier, *values, effective_date, True),
            )

    result = {}

    for table, key, alias in (
        ("dim_fecha", "fecha", "fecha_sk"),
        ("dim_hora", "minuto_dia", "hora_sk"),
    ):
        cursor.execute(f"SELECT {key}, {alias} FROM dw.{table}")
        result[alias] = dict(cursor.fetchall())

    for table, key, alias in (
        ("dim_categoria", "categoria_uuid", "categoria_sk"),
        ("dim_producto", "producto_uuid", "producto_sk"),
        ("dim_usuario", "usuario_uuid", "usuario_sk"),
    ):
        cursor.execute(
            f"""
            SELECT {key}, {alias}
            FROM dw.{table}
            WHERE es_actual
            """
        )
        result[alias] = dict(cursor.fetchall())

    return result


def resolve_dimension(cursor, table, key, identifier, timestamp):
    """Busca la versión histórica vigente de una dimensión."""

    if identifier is None:
        return 0 if table == "dim_usuario" else None

    source_key = {
        "dim_usuario": "usuario_uuid",
        "dim_producto": "producto_uuid",
        "dim_categoria": "categoria_uuid",
    }[table]

    cursor.execute(
        f"""
        SELECT {key}
        FROM dw.{table}
        WHERE {source_key} = %s
          AND vigente_desde <= %s
          AND (vigente_hasta IS NULL OR vigente_hasta > %s)
        ORDER BY vigente_desde DESC
        LIMIT 1
        """,
        (identifier, timestamp, timestamp),
    )

    result = cursor.fetchone()
    return result[0] if result else (0 if table == "dim_usuario" else None)


def time_keys(timestamp, keys):
    local = local_datetime(timestamp)

    return (
        keys["fecha_sk"][local.date()],
        keys["hora_sk"][local.hour * 60 + local.minute],
    )


def load_facts(cursor, data, keys, run_id):
    """Transforma y carga las tablas de hechos."""

    counts = defaultdict(int)

    ventas = {
        row["source_uuid"]: row
        for row in data["ventas"]
    }

    grouped = defaultdict(list)

    for detail in data["venta_detalle"]:
        grouped[detail["venta_uuid"]].append(detail)

    for venta_id, details in grouped.items():
        venta = ventas[venta_id]
        total = sum(
            (decimal(d["total_linea"]) for d in details),
            ZERO,
        )

        descuento = decimal(venta["descuento"])
        impuesto = decimal(venta["impuesto"])

        descuento_asignado = ZERO
        impuesto_asignado = ZERO

        for index, detail in enumerate(details):
            amount = decimal(detail["total_linea"])

            if index == len(details) - 1:
                discount = descuento - descuento_asignado
                tax = impuesto - impuesto_asignado
            elif total > 0:
                discount = money(descuento * amount / total)
                tax = money(impuesto * amount / total)
                descuento_asignado += discount
                impuesto_asignado += tax
            else:
                discount = ZERO
                tax = ZERO

            timestamp = venta["created_at"]
            fecha_sk, hora_sk = time_keys(timestamp, keys)

            producto_sk = resolve_dimension(
                cursor, "dim_producto", "producto_sk",
                detail["producto_uuid"], timestamp
            )

            if producto_sk is None:
                raise ValueError("Producto sin dimensión histórica.")

            cursor.execute(
                """
                SELECT categoria_uuid
                FROM dw.dim_producto
                WHERE producto_sk = %s
                """,
                (producto_sk,),
            )
            categoria_uuid = cursor.fetchone()[0]

            categoria_sk = resolve_dimension(
                cursor, "dim_categoria", "categoria_sk",
                categoria_uuid, timestamp
            )

            usuario_sk = resolve_dimension(
                cursor, "dim_usuario", "usuario_sk",
                venta["usuario_uuid"], timestamp
            )

            cost = money(
                decimal(detail["cantidad"]) *
                decimal(detail["costo_unitario"])
            )

            net = money(amount - discount)

            cursor.execute(
                """
                INSERT INTO dw.fact_ventas (
                    venta_detalle_uuid, venta_uuid, fecha_sk, hora_sk,
                    producto_sk, categoria_sk, usuario_sk,
                    cantidad, precio_unitario, costo_unitario,
                    importe_linea, descuento_linea, impuesto_linea,
                    ingreso_neto_linea, costo_linea, utilidad_estimada,
                    estado_venta, metodo_pago, mesa_numero,
                    fecha_hora_operacion
                )
                VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s
                )
                ON CONFLICT (venta_detalle_uuid) DO UPDATE SET
                    fecha_sk = EXCLUDED.fecha_sk,
                    hora_sk = EXCLUDED.hora_sk,
                    producto_sk = EXCLUDED.producto_sk,
                    categoria_sk = EXCLUDED.categoria_sk,
                    usuario_sk = EXCLUDED.usuario_sk,
                    cantidad = EXCLUDED.cantidad,
                    precio_unitario = EXCLUDED.precio_unitario,
                    costo_unitario = EXCLUDED.costo_unitario,
                    importe_linea = EXCLUDED.importe_linea,
                    descuento_linea = EXCLUDED.descuento_linea,
                    impuesto_linea = EXCLUDED.impuesto_linea,
                    ingreso_neto_linea = EXCLUDED.ingreso_neto_linea,
                    costo_linea = EXCLUDED.costo_linea,
                    utilidad_estimada = EXCLUDED.utilidad_estimada,
                    estado_venta = EXCLUDED.estado_venta,
                    metodo_pago = EXCLUDED.metodo_pago,
                    mesa_numero = EXCLUDED.mesa_numero,
                    fecha_hora_operacion = EXCLUDED.fecha_hora_operacion,
                    fecha_carga = now()
                """,
                (
                    detail["source_uuid"], venta_id,
                    fecha_sk, hora_sk, producto_sk, categoria_sk,
                    usuario_sk, detail["cantidad"],
                    detail["precio_unitario"], detail["costo_unitario"],
                    amount, discount, tax, net, cost, money(net - cost),
                    venta["estado"], venta["metodo_pago"],
                    venta["mesa_numero"], timestamp,
                ),
            )

            counts["fact_ventas"] += 1

    for row in data["movimientos_stock"]:
        timestamp = row["created_at"]
        fecha_sk, hora_sk = time_keys(timestamp, keys)

        producto_sk = resolve_dimension(
            cursor, "dim_producto", "producto_sk",
            row["producto_uuid"], timestamp
        )

        if producto_sk is None:
            raise ValueError("Producto de inventario sin dimensión.")

        cursor.execute(
            """
            SELECT categoria_uuid
            FROM dw.dim_producto
            WHERE producto_sk = %s
            """,
            (producto_sk,),
        )
        categoria_uuid = cursor.fetchone()[0]

        categoria_sk = resolve_dimension(
            cursor, "dim_categoria", "categoria_sk",
            categoria_uuid, timestamp
        )

        usuario_sk = resolve_dimension(
            cursor, "dim_usuario", "usuario_sk",
            row["usuario_uuid"], timestamp
        )

        amount = decimal(row["cantidad"])

        signed = (
            amount if row["tipo"] in
            ("entrada", "ajuste_entrada", "devolucion")
            else -amount if row["tipo"] in
            ("salida", "ajuste_salida", "consumo_receta")
            else ZERO
        )

        cursor.execute(
            """
            INSERT INTO dw.fact_inventario (
                movimiento_uuid, fecha_sk, hora_sk, producto_sk,
                categoria_sk, usuario_sk, tipo_movimiento,
                cantidad_movimiento, cantidad_firmada, unidad_medida,
                costo_unitario, proveedor_uuid, venta_uuid, envase_uuid,
                reversa_de_uuid, observacion, fecha_hora_operacion
            )
            VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                %s,%s,%s,%s,%s,%s
            )
            ON CONFLICT (movimiento_uuid) DO UPDATE SET
                fecha_sk = EXCLUDED.fecha_sk,
                hora_sk = EXCLUDED.hora_sk,
                producto_sk = EXCLUDED.producto_sk,
                categoria_sk = EXCLUDED.categoria_sk,
                usuario_sk = EXCLUDED.usuario_sk,
                tipo_movimiento = EXCLUDED.tipo_movimiento,
                cantidad_movimiento = EXCLUDED.cantidad_movimiento,
                cantidad_firmada = EXCLUDED.cantidad_firmada,
                unidad_medida = EXCLUDED.unidad_medida,
                costo_unitario = EXCLUDED.costo_unitario,
                proveedor_uuid = EXCLUDED.proveedor_uuid,
                venta_uuid = EXCLUDED.venta_uuid,
                envase_uuid = EXCLUDED.envase_uuid,
                reversa_de_uuid = EXCLUDED.reversa_de_uuid,
                observacion = EXCLUDED.observacion,
                fecha_hora_operacion = EXCLUDED.fecha_hora_operacion,
                fecha_carga = now()
            """,
            (
                row["source_uuid"], fecha_sk, hora_sk, producto_sk,
                categoria_sk, usuario_sk, row["tipo"], amount, signed,
                row["unidad_medida"], row["costo"], row["proveedor_uuid"],
                row["venta_uuid"], row["envase_uuid"],
                row["reversa_de_uuid"], row["observacion"], timestamp,
            ),
        )

        counts["fact_inventario"] += 1

    for row in data["registros_afluencia"]:
        timestamp = row["created_at"]
        fecha_sk, hora_sk = time_keys(timestamp, keys)

        usuario_sk = resolve_dimension(
            cursor, "dim_usuario", "usuario_sk",
            row["usuario_uuid"], timestamp
        )

        amount = row["cantidad"]

        cursor.execute(
            """
            INSERT INTO dw.fact_afluencia (
                registro_afluencia_uuid, fecha_sk, hora_sk, usuario_sk,
                tipo_movimiento, cantidad_movimiento,
                cantidad_entradas, cantidad_salidas,
                observacion, fecha_hora_operacion
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (registro_afluencia_uuid) DO UPDATE SET
                fecha_sk = EXCLUDED.fecha_sk,
                hora_sk = EXCLUDED.hora_sk,
                usuario_sk = EXCLUDED.usuario_sk,
                tipo_movimiento = EXCLUDED.tipo_movimiento,
                cantidad_movimiento = EXCLUDED.cantidad_movimiento,
                cantidad_entradas = EXCLUDED.cantidad_entradas,
                cantidad_salidas = EXCLUDED.cantidad_salidas,
                observacion = EXCLUDED.observacion,
                fecha_hora_operacion = EXCLUDED.fecha_hora_operacion,
                fecha_carga = now()
            """,
            (
                row["source_uuid"], fecha_sk, hora_sk, usuario_sk,
                row["tipo_movimiento"], amount,
                amount if row["tipo_movimiento"] == "entrada" else 0,
                amount if row["tipo_movimiento"] == "salida" else 0,
                row["observacion"], timestamp,
            ),
        )

        counts["fact_afluencia"] += 1

    for row in data["satisfaccion_encuestas"]:
        timestamp = row["created_at"]
        fecha_sk, hora_sk = time_keys(timestamp, keys)

        venta = ventas.get(row["venta_uuid"])
        usuario_uuid = venta["usuario_uuid"] if venta else None

        usuario_sk = resolve_dimension(
            cursor, "dim_usuario", "usuario_sk",
            usuario_uuid, timestamp
        )

        cursor.execute(
            """
            INSERT INTO dw.fact_satisfaccion (
                encuesta_uuid, fecha_sk, hora_sk, usuario_sk,
                venta_uuid, mesa_numero, calificacion_general,
                ambiente, musica, atencion, seguridad, limpieza,
                tiempo_espera, recomendacion, canal, comentario,
                fecha_hora_operacion
            )
            VALUES (
                %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s
            )
            ON CONFLICT (encuesta_uuid) DO UPDATE SET
                fecha_sk = EXCLUDED.fecha_sk,
                hora_sk = EXCLUDED.hora_sk,
                usuario_sk = EXCLUDED.usuario_sk,
                venta_uuid = EXCLUDED.venta_uuid,
                mesa_numero = EXCLUDED.mesa_numero,
                calificacion_general = EXCLUDED.calificacion_general,
                ambiente = EXCLUDED.ambiente,
                musica = EXCLUDED.musica,
                atencion = EXCLUDED.atencion,
                seguridad = EXCLUDED.seguridad,
                limpieza = EXCLUDED.limpieza,
                tiempo_espera = EXCLUDED.tiempo_espera,
                recomendacion = EXCLUDED.recomendacion,
                canal = EXCLUDED.canal,
                comentario = EXCLUDED.comentario,
                fecha_hora_operacion = EXCLUDED.fecha_hora_operacion,
                fecha_carga = now()
            """,
            (
                row["source_uuid"], fecha_sk, hora_sk, usuario_sk,
                row["venta_uuid"], row["mesa_numero"],
                row["calificacion_general"], row["ambiente"],
                row["musica"], row["atencion"], row["seguridad"],
                row["limpieza"], row["tiempo_espera"],
                row["recomendacion"], row["canal"],
                row["comentario"], timestamp,
            ),
        )

        counts["fact_satisfaccion"] += 1

    for row in data["existencias_actuales"]:
        timestamp = row["capturado_en"]
        fecha_sk, hora_sk = time_keys(timestamp, keys)

        producto_sk = resolve_dimension(
            cursor, "dim_producto", "producto_sk",
            row["source_uuid"], timestamp
        )

        if producto_sk is None:
            continue

        stock = decimal(row["stock_actual"])
        minimum = decimal(row["stock_minimo"])

        cursor.execute(
            """
            INSERT INTO dw.fact_existencias (
                run_uuid, producto_uuid, categoria_uuid,
                fecha_sk, hora_sk, producto_sk,
                stock_actual, stock_minimo, bajo_minimo,
                unidad_medida, capturado_en
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (run_uuid, producto_uuid) DO UPDATE SET
                stock_actual = EXCLUDED.stock_actual,
                stock_minimo = EXCLUDED.stock_minimo,
                bajo_minimo = EXCLUDED.bajo_minimo,
                capturado_en = EXCLUDED.capturado_en
            """,
            (
                run_id, row["source_uuid"], row["categoria_uuid"],
                fecha_sk, hora_sk, producto_sk,
                stock, minimum, stock <= minimum,
                row["unidad_medida"], timestamp,
            ),
        )

        counts["fact_existencias"] += 1

    return dict(counts)


def validate(data, counts):
    """Comprueba la correspondencia entre origen y destino."""

    checks = (
        ("venta_detalle", "fact_ventas"),
        ("movimientos_stock", "fact_inventario"),
        ("registros_afluencia", "fact_afluencia"),
        ("satisfaccion_encuestas", "fact_satisfaccion"),
        ("existencias_actuales", "fact_existencias"),
    )

    validated = {}

    for source, target in checks:
        expected = len(data[source])
        actual = counts.get(target, 0)

        if expected != actual:
            raise ValueError(
                f"Validación fallida en {target}: "
                f"esperadas {expected}, procesadas {actual}."
            )

        validated[target] = actual

    return validated


def load_kpis(cursor, run_id):
    """Persiste los KPI calculados por dw.vw_kpi_consolidado."""

    cursor.execute("DELETE FROM dw.kpi_mensual")

    cursor.execute(
        """
        INSERT INTO dw.kpi_mensual (
            kpi_id,
            anio_mes,
            categoria_uuid,
            numerador,
            denominador,
            valor,
            run_uuid
        )
        SELECT
            kpi_id,
            anio_mes,
            categoria_uuid,
            numerador,
            denominador,
            valor,
            %s
        FROM dw.vw_kpi_consolidado
        ON CONFLICT (
            kpi_id,
            anio_mes,
            (COALESCE(
                categoria_uuid,
                '00000000-0000-0000-0000-000000000000'::uuid
            ))
        )
        DO UPDATE SET
            numerador = EXCLUDED.numerador,
            denominador = EXCLUDED.denominador,
            valor = EXCLUDED.valor,
            calculado_en = now(),
            run_uuid = EXCLUDED.run_uuid
        """,
        (run_id,),
    )

    return cursor.rowcount


def run_etl():
    """Ejecuta el proceso completo de extracción, transformación y carga."""

    run_id = uuid.uuid4()

    with psycopg.connect(conninfo("DW_DB")) as target:

        with target.transaction():
            target.execute(
                """
                INSERT INTO dw.etl_runs (run_uuid, estado)
                VALUES (%s, 'running')
                """,
                (run_id,),
            )

        try:
            with psycopg.connect(
                conninfo("OLTP_DB", source=True)
            ) as source:

                with target.transaction():
                    target.execute(TRUNCATE_STAGING_SQL)

                    with source.transaction():
                        source.execute(
                            """
                            SET TRANSACTION
                            ISOLATION LEVEL REPEATABLE READ READ ONLY
                            """
                        )

                        with target.cursor() as cursor:
                            extracted = extract(source, cursor)

                    data = {}

                    for table, _ in EXTRACTS:
                        with target.cursor() as cursor:
                            data[table] = read_staging(cursor, table)

                    run_time = datetime.now(timezone.utc)

                    with target.cursor() as cursor:
                        keys = load_dimensions(cursor, data, run_time)

                        counts = load_facts(
                            cursor, data, keys, run_id
                        )

                        validated = validate(data, counts)

                        kpis = load_kpis(cursor, run_id)
                        validated["kpi_mensual"] = kpis

                        cursor.execute(
                            """
                            UPDATE dw.etl_runs
                            SET finished_at = now(),
                                estado = 'success',
                                filas_extraidas = %s,
                                filas_validadas = %s,
                                error = NULL
                            WHERE run_uuid = %s
                            """,
                            (
                                json.dumps(extracted),
                                json.dumps(validated),
                                run_id,
                            ),
                        )

            LOG.info(
                "ETL BIOX completado. run=%s extraidas=%s validadas=%s",
                run_id, extracted, validated,
            )

            return run_id

        except Exception as exc:
            with target.transaction():
                target.execute(
                    """
                    UPDATE dw.etl_runs
                    SET finished_at = now(),
                        estado = 'failed',
                        error = %s
                    WHERE run_uuid = %s
                    """,
                    (str(exc)[:4000], run_id),
                )

            raise


def main():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    try:
        run_etl()
        return 0

    except Exception:
        LOG.exception("Falló el ETL BIOX. Revise dw.etl_runs.")
        return 1


if __name__ == "__main__":
    sys.exit(main())