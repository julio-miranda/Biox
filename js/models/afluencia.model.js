"use strict";

const pool = require("../db");

async function listar(limite = 100) {
    const consulta = `
        SELECT
            a.registros_afluencia_id,
            a.tipo_movimiento,
            a.cantidad,
            a.observacion,
            a.created_at,
            u.nombre AS usuario_nombre
        FROM operaciones.registros_afluencia AS a
        LEFT JOIN seguridad.usuarios AS u
            ON u.usuarios_id = a.usuario_id
        ORDER BY a.created_at DESC
        LIMIT $1;
    `;

    const resultado = await pool.query(consulta, [limite]);
    return resultado.rows;
}

async function resumenHoy() {
    const consulta = `
        WITH reloj_local AS (
            SELECT date_trunc(
                'day',
                timezone('America/El_Salvador', now())
            ) AS inicio_local
        ), limites AS (
            SELECT
                inicio_local AT TIME ZONE 'America/El_Salvador' AS inicio,
                (inicio_local + interval '1 day')
                    AT TIME ZONE 'America/El_Salvador' AS fin
            FROM reloj_local
        )
        SELECT
            COUNT(*)::integer AS movimientos,
            COALESCE(SUM(cantidad) FILTER (
                WHERE tipo_movimiento = 'entrada'
            ), 0)::integer AS entradas,
            COALESCE(SUM(cantidad) FILTER (
                WHERE tipo_movimiento = 'salida'
            ), 0)::integer AS salidas
        FROM operaciones.registros_afluencia, limites
        WHERE created_at >= limites.inicio
          AND created_at < limites.fin;
    `;

    const resultado = await pool.query(consulta);
    return resultado.rows[0];
}

async function registrar({ usuarioId, tipoMovimiento, cantidad, observacion }) {
    const consulta = `
        INSERT INTO operaciones.registros_afluencia (
            usuario_id,
            tipo_movimiento,
            cantidad,
            observacion
        )
        VALUES ($1, $2, $3, $4)
        RETURNING
            registros_afluencia_id,
            tipo_movimiento,
            cantidad,
            observacion,
            created_at;
    `;

    const resultado = await pool.query(consulta, [
        usuarioId,
        tipoMovimiento,
        cantidad,
        observacion
    ]);

    return resultado.rows[0];
}

module.exports = { listar, resumenHoy, registrar };
