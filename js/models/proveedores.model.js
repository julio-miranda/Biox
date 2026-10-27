"use strict";

const pool = require("../db");

const COLUMNAS = `
    proveedores_id,
    nombre,
    nit,
    nrc,
    razon_social_denominacion,
    telefono,
    email,
    ubicacion,
    activo,
    created_at,
    updated_at
`;

async function listar() {
    const resultado = await pool.query(`
        SELECT ${COLUMNAS}
        FROM catalogo.proveedores
        ORDER BY activo DESC, nombre ASC;
    `);

    return resultado.rows;
}

async function buscarDuplicado(datos, excluirId = null) {
    const resultado = await pool.query(`
        SELECT proveedores_id, nit, nrc
        FROM catalogo.proveedores
        WHERE ($3::uuid IS NULL OR proveedores_id <> $3::uuid)
          AND (
              ($1::varchar IS NOT NULL AND nit = $1)
              OR ($2::varchar IS NOT NULL AND nrc = $2)
          )
        LIMIT 1;
    `, [datos.nit, datos.nrc, excluirId]);

    return resultado.rows[0] || null;
}

async function crear(datos) {
    const resultado = await pool.query(`
        INSERT INTO catalogo.proveedores (
            nombre,
            nit,
            nrc,
            razon_social_denominacion,
            telefono,
            email,
            ubicacion,
            activo
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING ${COLUMNAS};
    `, [
        datos.nombre,
        datos.nit,
        datos.nrc,
        datos.razon_social_denominacion,
        datos.telefono,
        datos.email,
        datos.ubicacion,
        datos.activo
    ]);

    return resultado.rows[0];
}

async function actualizar(id, datos) {
    const resultado = await pool.query(`
        UPDATE catalogo.proveedores
        SET
            nombre = $1,
            nit = $2,
            nrc = $3,
            razon_social_denominacion = $4,
            telefono = $5,
            email = $6,
            ubicacion = $7,
            activo = $8
        WHERE proveedores_id = $9
        RETURNING ${COLUMNAS};
    `, [
        datos.nombre,
        datos.nit,
        datos.nrc,
        datos.razon_social_denominacion,
        datos.telefono,
        datos.email,
        datos.ubicacion,
        datos.activo,
        id
    ]);

    return resultado.rows[0] || null;
}

async function desactivar(id) {
    const resultado = await pool.query(`
        UPDATE catalogo.proveedores
        SET activo = FALSE
        WHERE proveedores_id = $1
          AND activo = TRUE
        RETURNING proveedores_id, activo;
    `, [id]);

    return resultado.rows[0] || null;
}

module.exports = {
    listar,
    buscarDuplicado,
    crear,
    actualizar,
    desactivar
};
