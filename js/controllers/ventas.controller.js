
"use strict";

const VentasModel = require("../models/ventas.model");

function obtenerUsuarioSesion(req) {
    const sesion = req.session || {};

    const candidatos = [
        sesion.usuario,
        sesion.user,
        sesion.usuarioAutenticado,
        sesion.userData
    ];

    return candidatos.find(
        usuario => usuario && typeof usuario === "object"
    ) || null;
}

function normalizarRol(valor) {
    return String(valor || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}

function obtenerIdUsuario(usuario) {
    return usuario?.usuarios_id ??
        usuario?.usuario_id ??
        usuario?.id ??
        usuario?.userId ??
        null;
}

function requiereVentas(req, res, next) {
    const usuario = obtenerUsuarioSesion(req);

    if (!usuario) {
        return res.status(401).json({
            ok: false,
            mensaje: "Debes iniciar sesión para acceder a las ventas."
        });
    }

    const rol = normalizarRol(
        usuario.role ??
        usuario.rol ??
        usuario.user_role ??
        usuario.userRole
    );

    if (!["administrador", "admin", "barra"].includes(rol)) {
        return res.status(403).json({
            ok: false,
            mensaje: "Tu rol no tiene permiso para gestionar ventas."
        });
    }

    if (!obtenerIdUsuario(usuario)) {
        return res.status(401).json({
            ok: false,
            mensaje: "La sesión no contiene el identificador del usuario."
        });
    }

    req.usuarioVentas = usuario;
    next();
}

function validarUUID(valor) {
    return typeof valor === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor);
}

function responderError(res, error) {
    const status = Number(error.statusCode) || 500;

    if (status >= 500) {
        console.error("Error en el módulo de ventas:", error);
    }

    return res.status(status).json({
        ok: false,
        mensaje: status >= 500
            ? "No se pudo completar la operación de ventas."
            : error.message
    });
}

async function listarProductos(req, res) {
    try {
        const productos = await VentasModel.listarProductos();

        return res.json({
            ok: true,
            datos: productos
        });
    } catch (error) {
        return responderError(res, error);
    }
}

async function listar(req, res) {
    try {
        const desde = req.query.desde || "";
        const hasta = req.query.hasta || "";
        const estado = req.query.estado || "";

        if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
            return res.status(400).json({
                ok: false,
                mensaje: "La fecha inicial no tiene un formato válido."
            });
        }

        if (hasta && !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
            return res.status(400).json({
                ok: false,
                mensaje: "La fecha final no tiene un formato válido."
            });
        }

        if (desde && hasta && desde > hasta) {
            return res.status(400).json({
                ok: false,
                mensaje: "La fecha inicial no puede ser posterior a la fecha final."
            });
        }

        if (estado && !["finalizada", "anulada"].includes(estado)) {
            return res.status(400).json({
                ok: false,
                mensaje: "El estado solicitado no es válido."
            });
        }

        const ventas = await VentasModel.listarVentas({
            desde,
            hasta,
            estado
        });

        return res.json({
            ok: true,
            datos: ventas
        });
    } catch (error) {
        return responderError(res, error);
    }
}

async function obtener(req, res) {
    try {
        const { id } = req.params;

        if (!validarUUID(id)) {
            return res.status(400).json({
                ok: false,
                mensaje: "El identificador de la venta no es válido."
            });
        }

        const venta = await VentasModel.obtenerVenta(id);

        return res.json({
            ok: true,
            datos: venta
        });
    } catch (error) {
        return responderError(res, error);
    }
}

async function crear(req, res) {
    try {
        const usuarioId = obtenerIdUsuario(req.usuarioVentas);

        const venta = await VentasModel.crearVenta(
            req.body || {},
            usuarioId
        );

        return res.status(201).json({
            ok: true,
            mensaje: "Venta registrada correctamente.",
            datos: venta
        });
    } catch (error) {
        return responderError(res, error);
    }
}

module.exports = {
    requiereVentas,
    listarProductos,
    listar,
    obtener,
    crear
};