"use strict";

const SatisfaccionModel = require("../models/satisfaccion.model");

const CALIFICACIONES = [
    "ambiente",
    "musica",
    "atencion",
    "seguridad",
    "limpieza",
    "tiempo_espera",
    "recomendacion"
];

function error(res, message, status = 400) {
    return res.status(status).json({ message });
}

function validarEncuesta(body = {}) {
    const mesa = Number(body.mesa_numero);

    if (!Number.isSafeInteger(mesa) || mesa < 1) {
        return { error: "Ingresa un número de mesa válido." };
    }

    const datos = { mesa_numero: mesa };

    for (const campo of CALIFICACIONES) {
        const valor = Number(body[campo]);

        if (!Number.isInteger(valor) || valor < 1 || valor > 5) {
            return {
                error: `La calificación de ${campo} debe estar entre 1 y 5.`
            };
        }

        datos[campo] = valor;
    }

    if (
        body.comentario !== undefined &&
        body.comentario !== null &&
        typeof body.comentario !== "string"
    ) {
        return { error: "El comentario no es válido." };
    }

    const comentario = (body.comentario || "").trim();

    if (comentario.length > 1000) {
        return { error: "El comentario admite hasta 1000 caracteres." };
    }

    const canal = typeof body.canal === "string"
        ? body.canal.trim().toLowerCase()
        : "qr";

    if (!["qr", "web"].includes(canal)) {
        return { error: "El canal de envío no es válido." };
    }

    datos.comentario = comentario || null;
    datos.canal = canal;

    return { datos };
}

async function crear(req, res, next) {
    const validacion = validarEncuesta(req.body);

    if (validacion.error) {
        return error(res, validacion.error);
    }

    try {
        await SatisfaccionModel.crear(validacion.datos);

        return res.status(201).json({
            message: "Gracias. Tu encuesta fue enviada correctamente."
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { crear };