"use strict";

const pool = require("../db");

async function crear(datos) {
    const sql = `
        INSERT INTO experiencia.encuestas_satisfaccion (
            mesa_numero,
            ambiente,
            musica,
            atencion,
            seguridad,
            limpieza,
            tiempo_espera,
            recomendacion,
            comentario,
            canal
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
    `;

    const valores = [
        datos.mesa_numero,
        datos.ambiente,
        datos.musica,
        datos.atencion,
        datos.seguridad,
        datos.limpieza,
        datos.tiempo_espera,
        datos.recomendacion,
        datos.comentario,
        datos.canal
    ];

    const resultado = await pool.query(sql, valores);
    return resultado.rowCount === 1;
}

module.exports = { crear };