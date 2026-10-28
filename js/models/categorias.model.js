"use strict";

const pool = require("../db");

const COLUMNAS = `
    categorias_id,
    nombre,
    descripcion,
    activo,
    created_at,
    updated_at
`;

async function listar() {
    const resultado = await pool.query(`
        SELECT ${COLUMNAS}
        FROM catalogo.categorias
        ORDER BY activo DESC, nombre ASC;
    `);

    return resultado.rows;
}

async function buscarPorNombre(nombre, excluirId = null) {
    const resultado = await pool.query(`
        SELECT categorias_id
        FROM catalogo.categorias
        WHERE nombre = $1
          AND ($2::uuid IS NULL OR categorias_id <> $2::uuid)
        LIMIT 1;
    `, [nombre, excluirId]);

    return resultado.rows[0] || null;
}

async function crear(datos) {
    const resultado = await pool.query(`
        INSERT INTO catalogo.categorias (nombre, descripcion, activo)
        VALUES ($1, $2, TRUE)
        RETURNING ${COLUMNAS};
    `, [datos.nombre, datos.descripcion]);

    return resultado.rows[0];
}

async function actualizar(id, datos) {
    const resultado = await pool.query(`
        UPDATE catalogo.categorias
        SET nombre = $1,
            descripcion = $2,
            activo = $3
        WHERE categorias_id = $4
        RETURNING ${COLUMNAS};
    `, [datos.nombre, datos.descripcion, datos.activo, id]);

    return resultado.rows[0] || null;
}

async function desactivar(id) {
    const resultado = await pool.query(`
        UPDATE catalogo.categorias
        SET activo = FALSE
        WHERE categorias_id = $1
          AND activo = TRUE
        RETURNING categorias_id, activo;
    `, [id]);

    return resultado.rows[0] || null;
}

module.exports = {
    listar,
    buscarPorNombre,
    crear,
    actualizar,
    desactivar
};
