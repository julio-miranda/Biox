"use strict";

const inventoryModel = require("../models/inventory.model");

// ============================================================
// CONSTANTES Y VALIDACIONES
// ============================================================

// Valida la estructura del UUID sin restringir una versión específica.
const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esUuidValido(valor) {
    return (
        typeof valor === "string" &&
        UUID_REGEX.test(valor.trim())
    );
}

// ============================================================
// SESIÓN Y PERMISOS
// ============================================================

function obtenerUsuarioSesion(req) {
    const sesion = req.session;

    if (!sesion || typeof sesion !== "object") {
        return null;
    }

    const usuario = sesion.user || sesion.usuario;

    if (!usuario || typeof usuario !== "object") {
        return null;
    }

    return usuario;
}

function obtenerIdUsuario(req) {
    const usuario = obtenerUsuarioSesion(req);

    if (!usuario) {
        return null;
    }

    const id =
        usuario.usuarios_id ||
        usuario.id ||
        usuario.userId;

    if (id === undefined || id === null) {
        return null;
    }

    const idNormalizado = String(id).trim();

    return idNormalizado || null;
}

function obtenerRol(req) {
    const usuario = obtenerUsuarioSesion(req);

    if (!usuario) {
        return "";
    }

    const rol = usuario.role || usuario.rol || "";

    return String(rol).trim().toLowerCase();
}

function requiereRoles(rolesPermitidos) {
    const rolesNormalizados = rolesPermitidos.map((rol) =>
        String(rol).trim().toLowerCase()
    );

    return function middlewareRoles(req, res, next) {
        const usuario = obtenerUsuarioSesion(req);

        if (!usuario) {
            return res.status(401).json({
                ok: false,
                mensaje: "Debes iniciar sesión."
            });
        }

        const rol = obtenerRol(req);

        if (!rol || !rolesNormalizados.includes(rol)) {
            return res.status(403).json({
                ok: false,
                mensaje:
                    "No tienes permisos para realizar esta operación."
            });
        }

        return next();
    };
}

// Lectura general del inventario.
const requiereInventario = requiereRoles([
    "administrador",
    "bodega",
    "barra"
]);

// Gestión de productos y movimientos de inventario.
const requiereGestionInventario = requiereRoles([
    "administrador",
    "bodega"
]);

// Gestión de recetas de productos preparados.
const requiereGestionRecetas = requiereRoles([
    "administrador"
]);

// ============================================================
// MANEJO DE ERRORES
// ============================================================

function responderError(res, error) {
    // Evita intentar enviar otra respuesta si ya se enviaron las cabeceras.
    if (res.headersSent) {
        return;
    }

    const errorNormalizado =
        error instanceof Error
            ? error
            : new Error(
                error === undefined || error === null
                    ? "Error desconocido."
                    : String(error)
            );

    const codigo = errorNormalizado.code;

    // El error original se conserva en el servidor para diagnóstico.
    console.error("Error en inventario:", errorNormalizado);

    // --------------------------------------------------------
    // Errores de validación controlados por el modelo.
    // --------------------------------------------------------

    if (
        Number.isInteger(errorNormalizado.status) &&
        errorNormalizado.status >= 400 &&
        errorNormalizado.status < 500
    ) {
        return res.status(errorNormalizado.status).json({
            ok: false,
            mensaje:
                errorNormalizado.message ||
                "La solicitud contiene datos no válidos."
        });
    }

    // --------------------------------------------------------
    // Restricciones de PostgreSQL.
    // --------------------------------------------------------

    if (codigo === "23505") {
        return res.status(409).json({
            ok: false,
            mensaje: "Ya existe un registro con esos datos."
        });
    }

    if (codigo === "23503") {
        return res.status(400).json({
            ok: false,
            mensaje:
                "El registro hace referencia a un dato inexistente o está relacionado con otros registros."
        });
    }

    if (codigo === "23514") {
        return res.status(400).json({
            ok: false,
            mensaje:
                "Uno o más datos incumplen las restricciones permitidas."
        });
    }

    if (codigo === "23502") {
        return res.status(400).json({
            ok: false,
            mensaje:
                "Faltan datos obligatorios para completar la operación."
        });
    }

    if (
        codigo === "22P02" ||
        codigo === "22003" ||
        codigo === "22007" ||
        codigo === "22008" ||
        codigo === "22001" ||
        codigo === "22023" ||
        codigo === "22012"
    ) {
        return res.status(400).json({
            ok: false,
            mensaje:
                "Los datos enviados tienen un formato o valor no válido."
        });
    }

    // --------------------------------------------------------
    // Errores de reglas de negocio de PostgreSQL.
    // P0001 suele corresponder a una excepción personalizada
    // generada por una función o un trigger.
    // --------------------------------------------------------

    if (codigo === "P0001") {
        return res.status(400).json({
            ok: false,
            mensaje:
                errorNormalizado.message ||
                "La operación no se puede completar por una regla de negocio."
        });
    }

    // --------------------------------------------------------
    // Conflictos transitorios de concurrencia.
    // --------------------------------------------------------

    if (
        codigo === "40001" ||
        codigo === "40P01"
    ) {
        return res.status(409).json({
            ok: false,
            mensaje:
                "La operación entró en conflicto con otra transacción. Intenta nuevamente."
        });
    }

    // --------------------------------------------------------
    // Problemas de disponibilidad de la base de datos.
    // --------------------------------------------------------

    if (
        codigo === "ECONNREFUSED" ||
        codigo === "ETIMEDOUT" ||
        codigo === "57P01" ||
        codigo === "53300"
    ) {
        return res.status(503).json({
            ok: false,
            mensaje:
                "El servicio de base de datos no está disponible temporalmente."
        });
    }

    // --------------------------------------------------------
    // Errores internos o de configuración del esquema.
    // No se exponen nombres de tablas, columnas ni consultas.
    // --------------------------------------------------------

    return res.status(500).json({
        ok: false,
        mensaje:
            "Ocurrió un error interno al procesar el inventario."
    });
}

// Ejecuta una operación y estandariza las respuestas de la API.
async function ejecutar(res, callback, status = 200) {
    try {
        const resultado = await callback();

        return res.status(status).json({
            ok: true,
            datos: resultado
        });
    } catch (error) {
        return responderError(res, error);
    }
}

// ============================================================
// VALIDACIÓN DE CUERPOS DE PETICIÓN
// ============================================================

function obtenerCuerpo(req, res) {
    const cuerpo = req.body;

    if (
        !cuerpo ||
        typeof cuerpo !== "object" ||
        Array.isArray(cuerpo)
    ) {
        res.status(400).json({
            ok: false,
            mensaje:
                "El cuerpo de la solicitud debe contener un objeto JSON válido."
        });

        return null;
    }

    return cuerpo;
}

// ============================================================
// VALIDACIÓN DE IDENTIFICADORES EN PARÁMETROS
// ============================================================

function obtenerIdParametro(req, res) {
    const valor = req.params?.id;

    const id =
        typeof valor === "string"
            ? valor.trim()
            : "";

    if (!id) {
        res.status(400).json({
            ok: false,
            mensaje:
                "El identificador del registro es obligatorio."
        });

        return null;
    }

    if (!esUuidValido(id)) {
        res.status(400).json({
            ok: false,
            mensaje:
                "El identificador del registro no tiene un formato válido."
        });

        return null;
    }

    return id;
}

// ============================================================
// VALIDACIÓN DE IDENTIFICADORES EN PARÁMETROS DE CONSULTA
// ============================================================

// Devuelve:
// - UUID válido si se proporcionó.
// - null si el parámetro es opcional y está vacío.
// - undefined si se respondió con un error HTTP.
function obtenerIdQueryOpcional(req, res, nombre) {
    const valor = req.query?.[nombre];

    if (valor === undefined || valor === null) {
        return null;
    }

    if (typeof valor !== "string") {
        res.status(400).json({
            ok: false,
            mensaje:
                `El parámetro "${nombre}" debe contener un único identificador.`
        });

        return undefined;
    }

    const id = valor.trim();

    if (!id) {
        return null;
    }

    if (!esUuidValido(id)) {
        res.status(400).json({
            ok: false,
            mensaje:
                `El parámetro "${nombre}" no contiene un identificador válido.`
        });

        return undefined;
    }

    return id;
}

// ============================================================
// RESUMEN
// ============================================================

async function obtenerResumen(req, res) {
    return ejecutar(
        res,
        () => inventoryModel.obtenerResumen()
    );
}

// ============================================================
// CATEGORÍAS
// ============================================================

async function obtenerCategorias(req, res) {
    return ejecutar(
        res,
        () => inventoryModel.obtenerCategorias()
    );
}

// ============================================================
// PROVEEDORES
// ============================================================

async function obtenerProveedores(req, res) {
    return ejecutar(
        res,
        () => inventoryModel.obtenerProveedores()
    );
}

// ============================================================
// PRODUCTOS
// ============================================================

async function obtenerProductos(req, res) {
    return ejecutar(
        res,
        () => inventoryModel.obtenerProductos()
    );
}

async function crearProducto(req, res) {
    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.crearProducto(cuerpo),
        201
    );
}

async function crearProductoConEntrada(req, res) {
    const usuarioId = obtenerIdUsuario(req);

    if (!usuarioId || !esUuidValido(usuarioId)) {
        return res.status(401).json({
            ok: false,
            mensaje:
                "No se pudo identificar al usuario de la sesión. Inicia sesión nuevamente."
        });
    }

    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.crearProductoConEntrada(
            cuerpo,
            usuarioId
        ),
        201
    );
}

async function actualizarProducto(req, res) {
    const id = obtenerIdParametro(req, res);

    if (!id) {
        return;
    }

    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.actualizarProducto(id, cuerpo)
    );
}

async function activarProducto(req, res) {
    const id = obtenerIdParametro(req, res);

    if (!id) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.cambiarEstadoProducto(id, true)
    );
}

async function desactivarProducto(req, res) {
    const id = obtenerIdParametro(req, res);

    if (!id) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.cambiarEstadoProducto(id, false)
    );
}

// ============================================================
// ENVASES
// ============================================================

async function obtenerEnvases(req, res) {
    const productoId = obtenerIdQueryOpcional(
        req,
        res,
        "producto_id"
    );

    // undefined indica que el helper ya respondió con un error.
    if (productoId === undefined) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.obtenerEnvases(productoId)
    );
}

// ============================================================
// MOVIMIENTOS DE INVENTARIO
// ============================================================

async function registrarMovimiento(req, res) {
    const usuarioId = obtenerIdUsuario(req);

    if (!usuarioId) {
        return res.status(401).json({
            ok: false,
            mensaje:
                "No se pudo identificar al usuario de la sesión. Inicia sesión nuevamente."
        });
    }

    // El esquema utiliza identificadores UUID.
    if (!esUuidValido(usuarioId)) {
        return res.status(401).json({
            ok: false,
            mensaje:
                "El identificador del usuario de la sesión no es válido. Inicia sesión nuevamente."
        });
    }

    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.registrarMovimiento(
            cuerpo,
            usuarioId
        ),
        201
    );
}

// ============================================================
// RECETAS
// ============================================================

async function obtenerRecetas(req, res) {
    return ejecutar(
        res,
        () => inventoryModel.obtenerRecetas()
    );
}

async function crearReceta(req, res) {
    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.crearReceta(cuerpo),
        201
    );
}

async function actualizarReceta(req, res) {
    const id = obtenerIdParametro(req, res);

    if (!id) {
        return;
    }

    const cuerpo = obtenerCuerpo(req, res);

    if (cuerpo === null) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.actualizarReceta(id, cuerpo)
    );
}

async function desactivarReceta(req, res) {
    const id = obtenerIdParametro(req, res);

    if (!id) {
        return;
    }

    return ejecutar(
        res,
        () => inventoryModel.desactivarReceta(id)
    );
}

// ============================================================
// EXPORTACIONES
// ============================================================

module.exports = {
    // Middleware de autorización.
    requiereInventario,
    requiereGestionInventario,
    requiereGestionRecetas,

    // Resumen.
    obtenerResumen,

    // Categorías y proveedores.
    obtenerCategorias,
    obtenerProveedores,

    // Productos.
    obtenerProductos,
    crearProducto,
    crearProductoConEntrada,
    actualizarProducto,
    activarProducto,
    desactivarProducto,

    // Envases.
    obtenerEnvases,

    // Movimientos de inventario.
    registrarMovimiento,

    // Recetas.
    obtenerRecetas,
    crearReceta,
    actualizarReceta,
    desactivarReceta
};
