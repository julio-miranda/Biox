"use strict";

const CategoriasModel = require("../models/categorias.model");

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validarId(id) {
    return typeof id === "string" && UUID_REGEX.test(id);
}

function validarDatos(body = {}, esNuevo = false) {
    const nombre = typeof body.nombre === "string"
        ? body.nombre.trim()
        : "";

    if (!nombre || nombre.length > 100) {
        return { error: "El nombre es obligatorio y admite hasta 100 caracteres." };
    }

    const descripcion = typeof body.descripcion === "string"
        ? body.descripcion.trim() || null
        : body.descripcion == null ? null : undefined;

    if (descripcion === undefined) {
        return { error: "La descripción debe ser texto." };
    }

    if (descripcion && descripcion.length > 5000) {
        return { error: "La descripción admite hasta 5000 caracteres." };
    }

    const datos = { nombre, descripcion };

    if (esNuevo) {
        datos.activo = true;
    } else {
        datos.activo = body.activo;

        if (typeof datos.activo !== "boolean") {
            return { error: "El estado de la categoría debe ser verdadero o falso." };
        }
    }

    return { datos };
}

function manejarError(res, error, next) {
    if (error.code === "23505" && error.constraint === "categorias_nombre_key") {
        return res.status(409).json({
            message: "Ya existe una categoría con ese nombre."
        });
    }

    return next(error);
}

async function listar(req, res, next) {
    try {
        res.json({ data: await CategoriasModel.listar() });
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

        if (await CategoriasModel.buscarPorNombre(validacion.datos.nombre)) {
            return res.status(409).json({
                message: "Ya existe una categoría con ese nombre."
            });
        }

        const data = await CategoriasModel.crear(validacion.datos);
        res.status(201).json({ message: "Categoría creada correctamente.", data });
    } catch (error) {
        manejarError(res, error, next);
    }
}

async function actualizar(req, res, next) {
    if (!validarId(req.params.id)) {
        return res.status(400).json({ message: "Identificador de categoría inválido." });
    }

    try {
        const validacion = validarDatos(req.body);
        if (validacion.error) {
            return res.status(400).json({ message: validacion.error });
        }

        if (await CategoriasModel.buscarPorNombre(
            validacion.datos.nombre,
            req.params.id
        )) {
            return res.status(409).json({
                message: "Ya existe otra categoría con ese nombre."
            });
        }

        const data = await CategoriasModel.actualizar(
            req.params.id,
            validacion.datos
        );

        if (!data) {
            return res.status(404).json({ message: "Categoría no encontrada." });
        }

        res.json({ message: "Categoría actualizada correctamente.", data });
    } catch (error) {
        manejarError(res, error, next);
    }
}

async function eliminar(req, res, next) {
    if (!validarId(req.params.id)) {
        return res.status(400).json({ message: "Identificador de categoría inválido." });
    }

    try {
        const data = await CategoriasModel.desactivar(req.params.id);
        if (!data) {
            return res.status(404).json({
                message: "La categoría no existe o ya está inactiva."
            });
        }

        res.json({
            message: "Categoría desactivada. Los productos relacionados conservan su categoría."
        });
    } catch (error) {
        next(error);
    }
}

module.exports = { listar, crear, actualizar, eliminar };
