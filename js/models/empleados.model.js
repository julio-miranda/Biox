const pool = require("../db");

async function obtenerTodos() {
    const consulta = `
        SELECT
            usuarios_id,
            nombre,
            telefono,
            email,
            role,
            activo,
            created_at,
            updated_at
        FROM seguridad.usuarios
        ORDER BY nombre ASC;
    `;

    const resultado = await pool.query(consulta);
    return resultado.rows;
}

async function obtenerPorId(id) {
    const consulta = `
        SELECT
            usuarios_id,
            nombre,
            telefono,
            email,
            role,
            activo,
            created_at,
            updated_at
        FROM seguridad.usuarios
        WHERE usuarios_id = $1;
    `;

    const resultado = await pool.query(consulta, [id]);
    return resultado.rows[0] || null;
}

async function buscarPorEmail(email, excluirId = null) {
    const consulta = `
        SELECT usuarios_id
        FROM seguridad.usuarios
        WHERE LOWER(email) = LOWER($1)
          AND ($2::uuid IS NULL OR usuarios_id <> $2::uuid)
        LIMIT 1;
    `;

    const resultado = await pool.query(consulta, [email, excluirId]);
    return resultado.rows[0] || null;
}

async function crear(datos) {
    const consulta = `
        INSERT INTO seguridad.usuarios (
            nombre,
            telefono,
            email,
            password_hash,
            role,
            activo
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING
            usuarios_id,
            nombre,
            telefono,
            email,
            role,
            activo,
            created_at,
            updated_at;
    `;

    const valores = [
        datos.nombre,
        datos.telefono,
        datos.email,
        datos.password_hash,
        datos.role,
        datos.activo
    ];

    const resultado = await pool.query(consulta, valores);
    return resultado.rows[0];
}

async function actualizar(id, datos) {
    const consulta = `
        UPDATE seguridad.usuarios
        SET
            nombre = $1,
            telefono = $2,
            email = $3,
            role = $4,
            activo = $5
        WHERE usuarios_id = $6
        RETURNING
            usuarios_id,
            nombre,
            telefono,
            email,
            role,
            activo,
            created_at,
            updated_at;
    `;

    const valores = [
        datos.nombre,
        datos.telefono,
        datos.email,
        datos.role,
        datos.activo,
        id
    ];

    const resultado = await pool.query(consulta, valores);
    return resultado.rows[0] || null;
}

async function actualizarContrasena(id, passwordHash) {
    const consulta = `
        UPDATE seguridad.usuarios
        SET password_hash = $1
        WHERE usuarios_id = $2
        RETURNING usuarios_id;
    `;

    const resultado = await pool.query(consulta, [passwordHash, id]);
    return resultado.rows[0] || null;
}

async function cambiarEstado(id, activo) {
    const consulta = `
        UPDATE seguridad.usuarios
        SET activo = $1
        WHERE usuarios_id = $2
        RETURNING usuarios_id, activo;
    `;

    const resultado = await pool.query(consulta, [activo, id]);
    return resultado.rows[0] || null;
}

module.exports = {
    obtenerTodos,
    obtenerPorId,
    buscarPorEmail,
    crear,
    actualizar,
    actualizarContrasena,
    cambiarEstado
};