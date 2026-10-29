"use strict";

const AfluenciaModel = require("../models/afluencia.model");

function obtenerUsuario(req) {
    return req.session?.user || req.session?.usuario || null;
}

function normalizarRol(rol) {
    return String(rol || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

function requiereAfluencia(req, res, next) {
    const usuario = obtenerUsuario(req);

    if (!usuario) {
        return res.status(401).json({
            ok: false,
            mensaje: "Debes iniciar sesión para acceder a afluencia."
        });
    }

    const rol = normalizarRol(usuario.role || usuario.rol);
    if (!["administrador", "barra"].includes(rol)) {
        return res.status(403).json({
            ok: false,
            mensaje: "Tu rol no tiene permiso para registrar afluencia."
        });
    }

    const usuarioId = usuario.id || usuario.usuarios_id || usuario.userId;
    if (!usuarioId) {
        return res.status(401).json({
            ok: false,
            mensaje: "La sesión no contiene el identificador del usuario."
        });
    }

    req.usuarioAfluencia = { ...usuario, id: usuarioId };
    return next();
}

function responderError(res, error, operacion) {
    console.error(`Error al ${operacion} afluencia:`, error);
    return res.status(500).json({
        ok: false,
        mensaje: "No se pudo completar la operación de afluencia."
    });
}

async function listar(req, res) {
    try {
        const [datos, resumen] = await Promise.all([
            AfluenciaModel.listar(100),
            AfluenciaModel.resumenHoy()
        ]);

        return res.json({ ok: true, datos, resumen });
    } catch (error) {
        return responderError(res, error, "consultar");
    }
}

async function registrar(req, res) {
    const tipoMovimiento = String(req.body?.tipo_movimiento || "")
        .trim()
        .toLowerCase();
    const cantidad = Number(req.body?.cantidad);
    const observacion = typeof req.body?.observacion === "string"
        ? req.body.observacion.trim()
        : "";

    if (!["entrada", "salida"].includes(tipoMovimiento)) {
        return res.status(400).json({
            ok: false,
            mensaje: "Selecciona si el movimiento es una entrada o una salida."
        });
    }

    if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
        return res.status(400).json({
            ok: false,
            mensaje: "La cantidad debe ser un número entero entre 1 y 10,000."
        });
    }

    if (observacion.length > 500) {
        return res.status(400).json({
            ok: false,
            mensaje: "La observación admite hasta 500 caracteres."
        });
    }

    try {
        const registro = await AfluenciaModel.registrar({
            usuarioId: req.usuarioAfluencia.id,
            tipoMovimiento,
            cantidad,
            observacion: observacion || null
        });

        return res.status(201).json({
            ok: true,
            mensaje: "Movimiento de afluencia registrado.",
            datos: registro
        });
    } catch (error) {
        return responderError(res, error, "registrar");
    }
}

module.exports = { requiereAfluencia, listar, registrar };
