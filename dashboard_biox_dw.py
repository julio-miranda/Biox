
# -*- coding: utf-8 -*-
#!/usr/bin/env python3
"""Dashboard analítico BIOX: conectado exclusivamente al Data Warehouse."""

from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
import streamlit as st
from dotenv import load_dotenv
from psycopg.conninfo import make_conninfo


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

st.set_page_config(
    page_title="BIOX · Dashboard analítico",
    page_icon="🍸",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown("""
<style>
.stApp { background: #010302; }
[data-testid="stHeader"] { background: rgba(244,247,246,.86); }
[data-testid="stSidebar"] { background: #102b2b; }
[data-testid="stSidebar"] * { color: #f3f8f5; }
[data-testid="stSidebar"] [data-baseweb="select"] * { color: #173333; }
.biox-eyebrow { color: #168a70; font-size: .78rem; font-weight: 700;
    letter-spacing: .14em; text-transform: uppercase; }
.biox-title { color: #143b37; font-size: 2.15rem; font-weight: 750;
    letter-spacing: -.04em; margin: 0; }
.biox-subtitle { color: #657875; margin-top: .25rem; }
[data-testid="stMetric"] { background: #303332; border: 1px solid #e1eae6;
    border-radius: 14px; padding: 16px 18px; }
[data-testid="stMetricLabel"] { color: #607470; }
div[data-testid="stTabs"] button[aria-selected="true"] {
    color: #087d66; border-bottom-color: #16a085;
}
.biox-note { background: #eaf4f0; border-left: 4px solid #168a70;
    border-radius: 5px; color: #38534d; padding: 10px 14px; }
</style>
""", unsafe_allow_html=True)


# ============================================================
# CONEXIÓN Y FUNCIONES GENERALES
# ============================================================

def _env(name: str, fallback: str | None = None,
         default: str | None = None) -> str | None:
    return os.getenv(name) or (
        os.getenv(fallback) if fallback else None
    ) or default


def _conninfo() -> str:
    params: dict[str, Any] = {
        "host": _env("DW_DB_HOST", "DB_HOST", "localhost"),
        "port": _env("DW_DB_PORT", "DB_PORT", "5432"),
        "dbname": _env("DW_DB_NAME", default="biox_dw"),
        "user": _env("DW_DB_USER", "DB_USER", "postgres"),
        "application_name": "biox_streamlit_dashboard",
        "connect_timeout": "5",
        "client_encoding": "UTF8",
    }
    password = _env("DW_DB_PASSWORD", "DB_PASSWORD")
    if password:
        params["password"] = password
    return make_conninfo(**params)


def _query(conn, sql: str, params: tuple = ()) -> pd.DataFrame:
    cursor = conn.execute(sql, params)
    return pd.DataFrame(
        cursor.fetchall(),
        columns=[c.name for c in cursor.description or ()],
    )


def _numbers(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    for col in columns:
        if col in df:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def _money(value: float) -> str:
    return f"${value:,.2f}"


def _stock(value: Any, unit: str | None) -> str:
    return f"{float(value):,.2f} {unit or 'unidades'}"


def _kpi_value(value: Any, unit: str | None) -> str:
    if value is None or pd.isna(value):
        return "—"

    number = float(value)

    if unit == "USD":
        return _money(number)
    if unit == "USD/transacción":
        return f"{_money(number)} / transacción"
    if unit == "puntos / 5":
        return f"{number:.2f} / 5"
    if unit in {"transacciones", "productos", "movimientos"}:
        return f"{number:,.0f}"
    return f"{number:,.2f}"


def _empty(message: str) -> None:
    st.info(message)


# ============================================================
# METADATOS DEL DATA WAREHOUSE
# ============================================================

@st.cache_data(ttl=300, show_spinner=False)
def _load_metadata():
    with psycopg.connect(_conninfo()) as conn:

        # Se utiliza vw_inventario_diario para evitar depender
        # de una posible definición antigua de vw_inventario_analitico.
        bounds = conn.execute("""
            SELECT MIN(fecha), MAX(fecha)
            FROM (
                SELECT fecha FROM dw.vw_ventas_analiticas
                UNION ALL
                SELECT fecha FROM dw.vw_inventario_diario
                UNION ALL
                SELECT fecha FROM dw.vw_afluencia_horaria
                UNION ALL
                SELECT fecha FROM dw.vw_satisfaccion_analitica
                UNION ALL
                SELECT df.fecha
                FROM dw.fact_existencias fe
                JOIN dw.dim_fecha df ON df.fecha_sk = fe.fecha_sk
            ) fechas
        """).fetchone()

        categories = conn.execute("""
            SELECT DISTINCT categoria
            FROM (
                SELECT categoria FROM dw.vw_ventas_analiticas
                UNION
                SELECT categoria FROM dw.vw_inventario_diario
            ) categorias
            WHERE categoria IS NOT NULL
            ORDER BY categoria
        """).fetchall()

        latest = conn.execute("""
            SELECT started_at, finished_at, estado, error
            FROM dw.etl_runs
            ORDER BY started_at DESC
            LIMIT 1
        """).fetchone()

    status = None
    if latest:
        status = dict(zip(
            ["started_at", "finished_at", "estado", "error"],
            latest,
        ))

    return bounds[0], bounds[1], [r[0] for r in categories], status


# ============================================================
# CONSULTAS DEL DATA WAREHOUSE
# ============================================================

@st.cache_data(ttl=300, show_spinner="Consultando el Data Warehouse…")
def _load_data(start_iso: str, end_iso: str,
               previous_start_iso: str, previous_end_iso: str,
               category: str | None) -> dict[str, pd.DataFrame]:

    start = date.fromisoformat(start_iso)
    end = date.fromisoformat(end_iso)
    previous_start = date.fromisoformat(previous_start_iso)
    previous_end = date.fromisoformat(previous_end_iso)

    category_filter = "AND (%s::text IS NULL OR categoria = %s)"

    with psycopg.connect(_conninfo()) as conn:

        sales = _query(conn, f"""
            SELECT venta_uuid, fecha, producto, categoria, cantidad,
                   importe_linea, descuento_linea, impuesto_linea,
                   ingreso_neto_linea, costo_linea, utilidad_estimada
            FROM dw.vw_ventas_analiticas
            WHERE fecha BETWEEN %s AND %s {category_filter}
            ORDER BY fecha
        """, (start, end, category, category))

        inventory = _query(conn, f"""
            SELECT fecha, producto, categoria, tipo_movimiento,
                   clasificacion_movimiento, unidad_medida,
                   total_movimientos, cantidad_movida,
                   cantidad_entrada, cantidad_salida,
                   cantidad_neta
            FROM dw.vw_inventario_diario
            WHERE fecha BETWEEN %s AND %s {category_filter}
            ORDER BY fecha
        """, (start, end, category, category))

        traffic = _query(conn, """
            SELECT fecha,
                   EXTRACT(HOUR FROM hora)::integer AS hora,
                   SUM(entradas)::bigint AS entradas,
                   SUM(salidas)::bigint AS salidas
            FROM dw.vw_afluencia_horaria
            WHERE fecha BETWEEN %s AND %s
            GROUP BY fecha, EXTRACT(HOUR FROM hora)::integer
            ORDER BY fecha, hora
        """, (start, end))

        satisfaction = _query(conn, """
            SELECT fecha, calificacion_general, ambiente, musica,
                   atencion, seguridad, limpieza, tiempo_espera,
                   recomendacion
            FROM dw.vw_satisfaccion_analitica
            WHERE fecha BETWEEN %s AND %s
            ORDER BY fecha
        """, (start, end))

        previous_satisfaction = _query(conn, """
            SELECT fecha, calificacion_general
            FROM dw.vw_satisfaccion_analitica
            WHERE fecha BETWEEN %s AND %s
        """, (previous_start, previous_end))

        kpis = _query(conn, """
            SELECT anio_mes, codigo, nombre, descripcion, tipo,
                   periodicidad, unidad, direccion, formula, fuente,
                   categoria_uuid, categoria, numerador, denominador,
                   valor, valor_meta, cumplimiento_pct, estado_semaforo,
                   responsable, accion_correctiva
            FROM meta.vw_kpi_cumplimiento
            WHERE anio_mes BETWEEN
                date_trunc('month', %s::date)::date
                AND date_trunc('month', %s::date)::date
              AND (%s::text IS NULL OR categoria = %s
                   OR categoria = 'Global')
            ORDER BY anio_mes, codigo, categoria_uuid NULLS FIRST
        """, (start, end, category, category))

        # Existencias de la última ejecución ETL exitosa.
        # La categoría se relaciona por UUID, no por categoria_sk
        # dentro de dim_producto.
        stock = _query(conn, """
            WITH ultima_ejecucion AS (
                SELECT run_uuid
                FROM dw.etl_runs
                WHERE estado = 'success'
                ORDER BY finished_at DESC, started_at DESC
                LIMIT 1
            )
            SELECT
                df.fecha AS fecha_snapshot,
                dp.nombre AS producto,
                dp.tipo,
                CASE
                    WHEN dp.tipo = 'botella' THEN 'ml'
                    ELSE dp.unidad_medida
                END AS unidad_medida,
                dc.nombre AS categoria,
                fe.stock_actual,
                fe.stock_minimo
            FROM dw.fact_existencias fe
            JOIN ultima_ejecucion ue
                ON ue.run_uuid = fe.run_uuid
            JOIN dw.dim_fecha df
                ON df.fecha_sk = fe.fecha_sk
            JOIN dw.dim_producto dp
                ON dp.producto_sk = fe.producto_sk
            LEFT JOIN dw.dim_categoria dc
                ON dc.categoria_uuid = fe.categoria_uuid
               AND dc.es_actual = true
            ORDER BY dc.nombre, dp.nombre
        """)

    return {
        "sales": sales,
        "inventory": inventory,
        "traffic": traffic,
        "satisfaction": satisfaction,
        "previous_satisfaction": previous_satisfaction,
        "kpis": kpis,
        "stock": stock,
    }


# ============================================================
# DASHBOARD
# ============================================================

def main():

    st.sidebar.markdown(
        '<div class="biox-eyebrow">BIOX · inteligencia de negocio</div>',
        unsafe_allow_html=True,
    )
    st.sidebar.title("Panel de análisis")
    st.sidebar.caption(
        "Información procesada por el ETL y almacenada en el DW."
    )

    if st.sidebar.button("↻ Actualizar datos", width="stretch"):
        st.cache_data.clear()
        st.rerun()

    try:
        min_date, max_date, categories, etl_status = _load_metadata()
    except Exception as exc:
        st.error(
            "No se pudo consultar biox_dw. Verifica PostgreSQL, "
            "las vistas del DW y las variables DW_DB_* o DB_*."
        )
        st.caption(f"Detalle: {exc}")
        st.stop()

    if min_date is None or max_date is None:
        max_date = date.today()
        min_date = max_date - timedelta(days=29)

    start_default = max(min_date, max_date - timedelta(days=29))

    period = st.sidebar.date_input(
        "Periodo de análisis",
        value=(start_default, max_date),
        min_value=min_date,
        max_value=max_date,
        format="DD/MM/YYYY",
    )

    if isinstance(period, (tuple, list)):
        start, end = period[0], period[-1]
    else:
        start = end = period

    category_label = st.sidebar.selectbox(
        "Categoría",
        ["Todas las categorías", *categories],
    )
    category = (
        None if category_label == "Todas las categorías"
        else category_label
    )

    st.sidebar.caption(
        "La categoría filtra ventas, inventario y KPI. "
        "Afluencia y satisfacción se filtran por fecha."
    )

    if start > end:
        st.sidebar.error(
            "La fecha inicial debe ser anterior a la fecha final."
        )
        st.stop()

    days = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=days - 1)

    try:
        data = _load_data(
            start.isoformat(),
            end.isoformat(),
            previous_start.isoformat(),
            previous_end.isoformat(),
            category,
        )
    except Exception as exc:
        st.error(
            "No fue posible consultar las estructuras analíticas del DW."
        )
        st.caption(f"Detalle: {exc}")
        st.stop()

    # --------------------------------------------------------
    # PREPARACIÓN DE DATOS
    # --------------------------------------------------------

    sales = _numbers(data["sales"], [
        "cantidad", "importe_linea", "descuento_linea",
        "impuesto_linea", "ingreso_neto_linea",
        "costo_linea", "utilidad_estimada",
    ])

    inventory = _numbers(data["inventory"], [
        "total_movimientos", "cantidad_movida",
        "cantidad_entrada", "cantidad_salida", "cantidad_neta",
    ])

    traffic = _numbers(data["traffic"], [
        "hora", "entradas", "salidas",
    ])

    satisfaction = _numbers(data["satisfaction"], [
        "calificacion_general", "ambiente", "musica",
        "atencion", "seguridad", "limpieza",
        "tiempo_espera", "recomendacion",
    ])

    previous_satisfaction = _numbers(
        data["previous_satisfaction"],
        ["calificacion_general"],
    )

    stock = _numbers(data["stock"], [
        "stock_actual", "stock_minimo",
    ])

    kpis = _numbers(data["kpis"], [
        "numerador", "denominador", "valor",
    ])

    for col in ("valor_meta", "cumplimiento_pct"):
        if col in kpis:
            kpis[col] = pd.to_numeric(kpis[col], errors="coerce")

    if not sales.empty:
        sales["total_cobrado"] = (
            sales["importe_linea"]
            - sales["descuento_linea"]
            + sales["impuesto_linea"]
        )

    cost = float(sales["costo_linea"].sum()) if not sales.empty else 0
    utility = (
        float(sales["utilidad_estimada"].sum())
        if not sales.empty else 0
    )

    satisfaction_average = (
        float(satisfaction["calificacion_general"].mean())
        if not satisfaction.empty else None
    )

    # --------------------------------------------------------
    # INDICADORES MENSUALES
    # --------------------------------------------------------

    def monthly_rows(code: str) -> pd.DataFrame:
        rows = kpis[kpis["codigo"] == code]

        if category:
            selected = rows[rows["categoria"] == category]
            if not selected.empty:
                return selected

        return rows[rows["categoria"] == "Global"]

    def monthly_sum(code: str) -> float:
        rows = monthly_rows(code)
        return float(rows["valor"].sum()) if not rows.empty else 0

    revenue = monthly_sum("ventas_ingresos_netos")
    transactions = monthly_sum("ventas_transacciones")
    units_sold = monthly_sum("ventas_unidades")

    ticket = monthly_rows("ventas_ticket_promedio")
    average_ticket = (
        float(ticket["numerador"].sum())
        / float(ticket["denominador"].sum())
        if not ticket.empty and ticket["denominador"].sum()
        else 0
    )

    satisfaction_kpi = monthly_rows("satisfaccion_promedio")
    satisfaction_monthly = (
        float(satisfaction_kpi["numerador"].sum())
        / float(satisfaction_kpi["denominador"].sum())
        if not satisfaction_kpi.empty
        and satisfaction_kpi["denominador"].sum()
        else None
    )

    # --------------------------------------------------------
    # ENCABEZADO Y ESTADO ETL
    # --------------------------------------------------------

    st.markdown(
        '<div class="biox-eyebrow">Vértigo · resumen ejecutivo</div>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<h1 class="biox-title">Dashboard analítico</h1>',
        unsafe_allow_html=True,
    )
    st.markdown(
        f'<div class="biox-subtitle">{start:%d/%m/%Y} — '
        f'{end:%d/%m/%Y} · {category_label}</div>',
        unsafe_allow_html=True,
    )

    if etl_status:
        status = etl_status["estado"]
        timestamp = etl_status["finished_at"] or etl_status["started_at"]
        timestamp = (
            timestamp.strftime("%d/%m/%Y %H:%M")
            if timestamp else "sin fecha"
        )

        if status == "success":
            st.caption(f"Última ejecución ETL: Correcta · {timestamp}")
        else:
            st.warning(
                f"Última ejecución ETL: {status.capitalize()} · {timestamp}"
            )
            if etl_status["error"]:
                st.caption(f"Detalle ETL: {etl_status['error']}")
    else:
        st.info(
            "Todavía no hay ejecuciones ETL registradas en el DW."
        )

    # --------------------------------------------------------
    # TARJETAS KPI
    # --------------------------------------------------------

    cards = st.columns(5)
    cards[0].metric("Ingresos netos", _money(revenue))
    cards[1].metric("Transacciones", f"{transactions:,.0f}")
    cards[2].metric("Ticket promedio", _money(average_ticket))
    cards[3].metric("Unidades vendidas", f"{units_sold:,.2f}")
    cards[4].metric(
        "Satisfacción promedio",
        f"{satisfaction_monthly:.2f} / 5"
        if satisfaction_monthly is not None else "—",
    )

    st.caption(
        "Las tarjetas KPI utilizan meses completos. "
        "Las gráficas y alertas respetan las fechas seleccionadas."
    )

    overview, kpi_tab, sales_tab, inventory_tab, traffic_tab, satisfaction_tab = st.tabs([
        "Resumen y alertas", "KPIs y metas", "Ventas",
        "Inventario", "Afluencia", "Satisfacción",
    ])

    # ========================================================
    # RESUMEN Y ALERTAS
    # ========================================================

    with overview:
        st.subheader("Indicadores y alertas")
        left, right = st.columns(2)

        with left:
            st.markdown("#### Stock actual bajo el mínimo")
            current_stock = stock.copy()

            if category and not current_stock.empty:
                current_stock = current_stock[
                    current_stock["categoria"] == category
                ]

            if current_stock.empty:
                _empty(
                    "No hay existencias de una ejecución ETL exitosa."
                )
            else:
                low = current_stock[
                    current_stock["stock_actual"]
                    <= current_stock["stock_minimo"]
                ].copy()

                if low.empty:
                    st.success(
                        "No hay productos por debajo de su mínimo."
                    )
                else:
                    low["nivel"] = low.apply(
                        lambda r: "Crítico"
                        if (
                            r["stock_minimo"] > 0
                            and r["stock_actual"] <= r["stock_minimo"] * 0.5
                        )
                        else "Bajo",
                        axis=1,
                    )

                    low["Stock actual"] = low.apply(
                        lambda r: _stock(
                            r["stock_actual"], r["unidad_medida"]
                        ),
                        axis=1,
                    )

                    low["Stock mínimo"] = low.apply(
                        lambda r: _stock(
                            r["stock_minimo"], r["unidad_medida"]
                        ),
                        axis=1,
                    )

                    st.dataframe(
                        low[[
                            "producto", "categoria",
                            "Stock actual", "Stock mínimo", "nivel",
                        ]],
                        hide_index=True,
                        width="stretch",
                    )

                snapshot = current_stock["fecha_snapshot"].max()
                if pd.notna(snapshot):
                    st.caption(
                        "Última instantánea: "
                        f"{pd.to_datetime(snapshot):%d/%m/%Y}."
                    )

        with right:
            st.markdown("#### Horarios de alta afluencia")

            if traffic.empty or traffic["entradas"].sum() == 0:
                _empty("No hay entradas registradas en el periodo.")
            else:
                by_hour = traffic.groupby(
                    "hora", as_index=False
                )[["entradas", "salidas"]].sum()

                nonzero = by_hour.loc[
                    by_hour["entradas"] > 0, "entradas"
                ]

                threshold = (
                    float(nonzero.quantile(.75))
                    if not nonzero.empty else 0
                )

                peaks = by_hour[
                    by_hour["entradas"] >= threshold
                ].copy()

                peaks = peaks[
                    peaks["entradas"] > 0
                ].sort_values("entradas", ascending=False)

                if peaks.empty:
                    st.info("No se identificaron horarios pico.")
                else:
                    peaks["Horario"] = peaks["hora"].map(
                        lambda h: f"{int(h):02d}:00"
                    )

                    st.dataframe(
                        peaks.rename(columns={
                            "entradas": "Entradas",
                            "salidas": "Salidas",
                        })[["Horario", "Entradas", "Salidas"]],
                        hide_index=True,
                        width="stretch",
                    )

                    st.caption(
                        f"Umbral: percentil 75 "
                        f"({threshold:,.0f} entradas)."
                    )

        st.divider()
        alert_left, alert_right = st.columns(2)

        with alert_left:
            st.markdown("#### Tendencia de satisfacción")

            if satisfaction_average is None:
                _empty("No hay encuestas en el periodo.")
            else:
                previous_average = (
                    float(
                        previous_satisfaction[
                            "calificacion_general"
                        ].mean()
                    )
                    if not previous_satisfaction.empty else None
                )

                if satisfaction_average < 3.5:
                    st.error(
                        f"Calificación promedio baja: "
                        f"{satisfaction_average:.2f}/5."
                    )
                elif (
                    previous_average is not None
                    and satisfaction_average <= previous_average - .5
                ):
                    st.warning(
                        f"La satisfacción bajó "
                        f"{previous_average - satisfaction_average:.2f} "
                        f"puntos ({previous_average:.2f} → "
                        f"{satisfaction_average:.2f})."
                    )
                else:
                    comparison = (
                        f"Periodo anterior: {previous_average:.2f}/5."
                        if previous_average is not None
                        else "Sin periodo anterior para comparar."
                    )
                    st.success(
                        f"Sin alerta. Promedio: "
                        f"{satisfaction_average:.2f}/5. {comparison}"
                    )

        with alert_right:
            st.markdown("#### Utilidad estimada")
            st.metric("Utilidad del periodo", _money(utility))
            st.caption(f"Costos asociados a ventas: {_money(cost)}.")

        with st.expander("Cómo se interpretan las alertas"):
            st.markdown(
                "- **Stock crítico:** existencia igual o inferior al "
                "50 % del mínimo. **Stock bajo:** existencia menor o "
                "igual al mínimo.\n"
                "- **Alta afluencia:** horas que alcanzan el percentil "
                "75 de entradas. Son conteos, no visitantes únicos.\n"
                "- **Satisfacción:** alerta si el promedio es menor "
                "que 3.5/5 o cae al menos 0.5 puntos frente al "
                "periodo anterior."
            )

    # ========================================================
    # KPIs Y METAS
    # ========================================================

    with kpi_tab:
        st.subheader("Indicadores mensuales y cumplimiento")
        st.caption(
            "Resultados de dw.kpi_mensual y metas de "
            "meta.vw_kpi_cumplimiento."
        )

        if kpis.empty:
            _empty("No hay resultados KPI para los meses seleccionados.")
        else:
            missing = kpis[
                (kpis["direccion"] != "informativo")
                & kpis["valor_meta"].isna()
            ]

            if not missing.empty:
                st.info(
                    "Hay indicadores sin metas configuradas "
                    "en meta.kpi_meta."
                )

            display = kpis.copy()
            display["Mes"] = pd.to_datetime(
                display["anio_mes"]
            ).dt.strftime("%m/%Y")

            display["Indicador"] = display.apply(
                lambda r: f"{r['nombre']} · {r['categoria']}",
                axis=1,
            )

            display["Resultado"] = display.apply(
                lambda r: _kpi_value(r["valor"], r["unidad"]),
                axis=1,
            )

            display["Meta"] = display.apply(
                lambda r: _kpi_value(r["valor_meta"], r["unidad"]),
                axis=1,
            )

            display["Semáforo"] = display["estado_semaforo"].map({
                "cumplido": "🟢 Cumplido",
                "atencion": "🟡 Atención",
                "critico": "🔴 Crítico",
                "sin_meta": "⚪ Sin meta",
                "informativo": "ℹ️ Informativo",
            }).fillna("—")

            display["Cumplimiento"] = display[
                "cumplimiento_pct"
            ].map(
                lambda v: f"{v:.1f}%" if pd.notna(v) else "—"
            )

            st.dataframe(
                display[[
                    "Mes", "Indicador", "tipo", "Resultado",
                    "Meta", "Cumplimiento", "Semáforo", "responsable",
                ]].rename(columns={
                    "tipo": "Tipo",
                    "responsable": "Responsable",
                }),
                hide_index=True,
                width="stretch",
            )

            global_kpis = kpis[
                kpis["categoria"] == "Global"
            ]

            monthly = global_kpis[
                global_kpis["codigo"].isin([
                    "ventas_ingresos_netos",
                    "ventas_transacciones",
                ])
            ].pivot_table(
                index="anio_mes",
                columns="codigo",
                values="valor",
                aggfunc="first",
            ).sort_index()

            if not monthly.empty:
                st.markdown("#### Ingresos y transacciones por mes")
                left, right = st.columns(2)

                if "ventas_ingresos_netos" in monthly:
                    with left:
                        st.markdown("Ingresos netos")
                        st.line_chart(
                            monthly[["ventas_ingresos_netos"]],
                            y_label="USD",
                        )

                if "ventas_transacciones" in monthly:
                    with right:
                        st.markdown("Transacciones")
                        st.bar_chart(
                            monthly[["ventas_transacciones"]],
                            y_label="Cantidad",
                        )

            with st.expander(
                "Definiciones, fuentes y acciones correctivas"
            ):
                catalog = kpis.drop_duplicates("codigo")[[
                    "nombre", "descripcion", "tipo", "periodicidad",
                    "unidad", "direccion", "formula", "fuente",
                    "responsable", "accion_correctiva",
                ]].rename(columns={
                    "nombre": "Indicador",
                    "descripcion": "Definición",
                    "tipo": "Tipo",
                    "periodicidad": "Periodicidad",
                    "unidad": "Unidad",
                    "direccion": "Dirección",
                    "formula": "Fórmula",
                    "fuente": "Fuente",
                    "responsable": "Responsable",
                    "accion_correctiva": "Acción correctiva",
                })

                st.dataframe(
                    catalog,
                    hide_index=True,
                    width="stretch",
                )

    # ========================================================
    # VENTAS
    # ========================================================

    with sales_tab:
        st.subheader("Desempeño comercial")

        if sales.empty:
            _empty("No hay líneas de ventas finalizadas en el periodo.")
        else:
            daily = sales.groupby(
                "fecha", as_index=False
            ).agg(
                ingresos=("ingreso_neto_linea", "sum"),
                total_cobrado=("total_cobrado", "sum"),
                utilidad=("utilidad_estimada", "sum"),
                unidades=("cantidad", "sum"),
            ).sort_values("fecha")

            top = sales.groupby(
                "producto", as_index=False
            ).agg(
                unidades=("cantidad", "sum"),
                ingresos=("ingreso_neto_linea", "sum"),
            ).sort_values(
                "unidades", ascending=False
            ).head(10)

            left, right = st.columns(2)

            with left:
                st.markdown("#### Ingresos netos por día")
                st.line_chart(
                    daily.set_index("fecha")[["ingresos"]],
                    y_label="USD",
                )

            with right:
                st.markdown("#### Productos con mayor volumen")
                st.bar_chart(
                    top.set_index("producto")[["unidades"]],
                    y_label="Cantidad vendida",
                )

            transactions_daily = sales.groupby(
                "fecha"
            )["venta_uuid"].nunique()

            daily["transacciones"] = daily["fecha"].map(
                transactions_daily
            )

            daily["ticket promedio"] = daily.apply(
                lambda r: r["total_cobrado"] / r["transacciones"]
                if r["transacciones"] else 0,
                axis=1,
            )

            st.markdown("#### Resumen diario")
            st.dataframe(
                daily,
                hide_index=True,
                width="stretch",
            )

            st.caption(
                "Ingresos y costos son importes de línea. "
                "El ticket usa transacciones distintas."
            )

    # ========================================================
    # INVENTARIO
    # ========================================================

    with inventory_tab:
        st.subheader("Movimiento de inventario")

        if inventory.empty:
            _empty("No hay movimientos de inventario en el periodo.")
        else:
            outbound = inventory[
                inventory["clasificacion_movimiento"] == "Salida"
            ].copy()

            cards = st.columns(3)
            cards[0].metric(
                "Movimientos",
                f"{inventory['total_movimientos'].sum():,.0f}",
            )
            cards[1].metric(
                "Registros de salida",
                f"{outbound['total_movimientos'].sum():,.0f}",
            )
            cards[2].metric(
                "Productos movidos",
                f"{inventory['producto'].nunique():,}",
            )

            if outbound.empty:
                st.info("No se registraron salidas ni consumos.")
            else:
                out = outbound.groupby(
                    ["producto", "unidad_medida"],
                    as_index=False,
                ).agg(
                    cantidad_salida=("cantidad_salida", "sum"),
                    movimientos=("total_movimientos", "sum"),
                ).sort_values(
                    "cantidad_salida", ascending=False
                )

                out["Producto · unidad"] = out.apply(
                    lambda r: (
                        f"{r['producto']} · "
                        f"{r['unidad_medida'] or 'unidades'}"
                    ),
                    axis=1,
                )

                left, right = st.columns([1.15, 1])

                with left:
                    st.markdown("#### Salidas por producto y unidad")
                    st.bar_chart(
                        out.head(12).set_index(
                            "Producto · unidad"
                        )[["cantidad_salida"]],
                        y_label="Cantidad en unidad operacional",
                    )

                with right:
                    st.markdown("#### Detalle de salidas")
                    st.dataframe(
                        out[[
                            "producto", "unidad_medida",
                            "cantidad_salida", "movimientos",
                        ]].rename(columns={
                            "producto": "Producto",
                            "unidad_medida": "Unidad",
                            "cantidad_salida": "Cantidad salida",
                            "movimientos": "Movimientos",
                        }),
                        hide_index=True,
                        width="stretch",
                    )

            daily = inventory.groupby(
                "fecha", as_index=False
            ).agg(
                entradas=("cantidad_entrada", "sum"),
                salidas=("cantidad_salida", "sum"),
            ).sort_values("fecha")

            if not daily.empty:
                st.markdown("#### Entradas y salidas por día")
                daily["Día"] = pd.to_datetime(
                    daily["fecha"]
                ).dt.strftime("%d/%m")

                st.bar_chart(
                    daily.set_index("Día")[["entradas", "salidas"]],
                    y_label="Cantidad de productos",
                )

                st.dataframe(
                    daily[[
                        "fecha", "entradas", "salidas",
                    ]].rename(columns={
                        "fecha": "Fecha",
                        "entradas": "Entradas",
                        "salidas": "Salidas",
                    }),
                    hide_index=True,
                    width="stretch",
                )

    # ========================================================
    # AFLUENCIA
    # ========================================================

    with traffic_tab:
        st.subheader("Afluencia por día y hora")

        if traffic.empty:
            _empty("No hay movimientos de afluencia en el periodo.")
        else:
            daily = traffic.groupby(
                "fecha", as_index=False
            )[["entradas", "salidas"]].sum().sort_values("fecha")

            hourly = traffic.groupby(
                "hora", as_index=False
            )[["entradas", "salidas"]].sum().sort_values("hora")

            left, right = st.columns(2)

            with left:
                st.markdown("#### Conteos por día")
                st.line_chart(
                    daily.set_index("fecha"),
                    y_label="Movimientos contados",
                )

            with right:
                st.markdown("#### Conteos por hora")
                hourly["hora"] = hourly["hora"].map(
                    lambda h: f"{int(h):02d}:00"
                )
                st.bar_chart(
                    hourly.set_index("hora"),
                    y_label="Movimientos contados",
                )

            st.dataframe(
                daily,
                hide_index=True,
                width="stretch",
            )

            st.caption(
                "Entradas y salidas son conteos independientes, "
                "no personas únicas."
            )

    # ========================================================
    # SATISFACCIÓN
    # ========================================================

    with satisfaction_tab:
        st.subheader("Experiencia y satisfacción")

        if satisfaction.empty:
            _empty("No hay encuestas de satisfacción en el periodo.")
        else:
            criteria = [
                "calificacion_general", "atencion", "ambiente",
                "musica", "seguridad", "limpieza",
                "tiempo_espera", "recomendacion",
            ]

            labels = {
                "calificacion_general": "General",
                "atencion": "Atención",
                "ambiente": "Ambiente",
                "musica": "Música",
                "seguridad": "Seguridad",
                "limpieza": "Limpieza",
                "tiempo_espera": "Tiempo de espera",
                "recomendacion": "Recomendación",
            }

            averages = (
                satisfaction[criteria].mean()
                .rename(index=labels)
                .rename("Promedio")
                .to_frame()
            )

            cards = st.columns(4)
            cards[0].metric("Encuestas", f"{len(satisfaction):,}")
            cards[1].metric(
                "Calificación general",
                f"{satisfaction_average:.2f} / 5",
            )
            cards[2].metric(
                "Recomendaría",
                f"{satisfaction['recomendacion'].mean():.2f} / 5",
            )
            cards[3].metric(
                "Atención",
                f"{satisfaction['atencion'].mean():.2f} / 5",
            )

            daily = satisfaction.groupby(
                "fecha", as_index=False
            ).agg(
                promedio=("calificacion_general", "mean"),
                encuestas=("calificacion_general", "size"),
            ).sort_values("fecha")

            left, right = st.columns(2)

            with left:
                st.markdown("#### Promedio por criterio")
                st.bar_chart(
                    averages,
                    y_label="Calificación (1–5)",
                )

            with right:
                st.markdown("#### Evolución diaria")
                st.line_chart(
                    daily.set_index("fecha")[["promedio"]],
                    y_label="Calificación (1–5)",
                )

            st.dataframe(
                daily,
                hide_index=True,
                width="stretch",
            )

            st.caption(
                "Las valoraciones utilizan una escala de 1 a 5. "
                "Los comentarios no intervienen en estos promedios."
            )

    st.markdown(
        '<div class="biox-note">BIOX integra ventas, inventario, '
        'afluencia y satisfacción en un repositorio histórico para '
        'apoyar decisiones operativas.</div>',
        unsafe_allow_html=True,
    )


if __name__ == "__main__":
    main()