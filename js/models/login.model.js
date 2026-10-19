const pool = require("../db");

async function buscarPorEmail(email) {
    const consulta = `
        SELECT
            usuarios_id,
            nombre,
            email,
            password_hash,
            role,
            activo
        FROM seguridad.usuarios
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1;
    `;

    const resultado = await pool.query(consulta, [email]);

    return resultado.rows[0] || null;
}

module.exports = {
    buscarPorEmail
};