"use strict";

const ProveedoresModel = require("../models/proveedores.model");

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarId(id) {
    return typeof id === "string" && UUID_REGEX.test(id);
}

function validarDatos(body = {}, esNuevo = false) {
    const nombre = typeof body.nombre === "string"
        ? body.nombre.trim()
        : "";

    if (!nombre || nombre.length > 150) {
        return { error: "El nombre es obligatorio y admite hasta 150 caracteres." };
    }

    const limites = {
        nit: 30,
        nrc: 30,
        razon_social_denominacion: 180,
        telefono: 30,
        email: 254,
        ubicacion: 250
    };

    const datos = { nombre };

    for (const [campo, limite] of Object.entries(limites)) {
        const valor = body[campo];

        if (valor != null && typeof valor !== "string") {
            return { error: `El campo ${campo} debe ser texto.` };
        }

        const limpio = typeof valor === "string" ? valor.trim() : "";

        if (limpio.length > limite) {
            return { error: `El campo ${campo} admite hasta ${limite} caracteres.` };
        }

        datos[campo] = limpio || null;
    }

    if (datos.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email)) {
        return { error: "Ingresa un correo electrónico válido." };
    }

    if (esNuevo) {
        datos.activo = true;
    } else {
        datos.activo = body.activo;

        if (typeof datos.activo !== "boolean") {
            return { error: "El estado del proveedor debe ser verdadero o falso." };
        }
    }

    return { datos };
}

function responderError(res, error, next) {
    if (error.code === "23505") {
        if (error.constraint === "proveedores_nit_key") {
            return res.status(409).json({
                message: "Ya existe un proveedor con ese NIT."
            });
        }

        if (error.constraint === "proveedores_nrc_key") {
            return res.status(409).json({
                message: "Ya existe un proveedor con ese NRC."
            });
        }

        return res.status(409).json({
            message: "El NIT o NRC ya pertenece a otro proveedor."
        });
    }

    return next(error);
}

async function listar(req, res, next) {
    try {
        const data = await ProveedoresModel.listar();
        res.json({ data });
    } catch (error) {
        next(error);
    }
}

async function crear(req, res, next) {
    try {
        const validacion = validarDatos(req.body, true);
        if (validacion.error) {
            return res.status(400).json({ message: validacion.error });
        }

        const duplicado = await ProveedoresModel.buscarDuplicado(validacion.datos);
        if (duplicado) {
            const campo = validacion.datos.nit &&
                duplicado.nit === validacion.datos.nit
                ? "NIT"
                : "NRC";
            return res.status(409).json({
                message: `Ya existe un proveedor con ese ${campo}.`
            });
        }

        const data = await ProveedoresModel.crear(validacion.datos);
        res.status(201).json({ message: "Proveedor creado correctamente.", data });
    } catch (error) {
        responderError(res, error, next);
    }
}

async function actualizar(req, res, next) {
    if (!validarId(req.params.id)) {
        return res.status(400).json({ message: "Identificador de proveedor inválido." });
    }

    try {
        const validacion = validarDatos(req.body);
        if (validacion.error) {
            return res.status(400).json({ message: validacion.error });
        }

        const duplicado = await ProveedoresModel.buscarDuplicado(
            validacion.datos,
            req.params.id
        );
        if (duplicado) {
            const campo = validacion.datos.nit &&
                duplicado.nit === validacion.datos.nit
                ? "NIT"
                : "NRC";
            return res.status(409).json({
                message: `Ya existe otro proveedor con ese ${campo}.`
            });
        }

        const data = await ProveedoresModel.actualizar(
            req.params.id,
            validacion.datos
        );

        if (!data) {
            return res.status(404).json({ message: "Proveedor no encontrado." });
        }

        res.json({ message: "Proveedor actualizado correctamente.", data });
    } catch (error) {
        responderError(res, error, next);
    }
}

async function eliminar(req, res, next) {
    if (!validarId(req.params.id)) {
        return res.status(400).json({ message: "Identificador de proveedor inválido." });
    }

    try {
        const data = await ProveedoresModel.desactivar(req.params.id);

        if (!data) {
            return res.status(404).json({
                message: "El proveedor no existe o ya está inactivo."
            });
        }

        res.json({
            message: "Proveedor eliminado de la lista activa. Sus referencias históricas se conservaron."
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, crear, actualizar, eliminar };
