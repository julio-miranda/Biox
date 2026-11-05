const bcrypt = require("bcryptjs");
const EmpleadosModel = require("../models/empleados.model");

const ROLES = ["administrador", "barra", "bodega", "pendiente"];

function error(res, message, status = 400) {
    return res.status(status).json({ message });
}

function esAdministrador(req, res) {
    if (req.session?.user?.role !== "administrador") {
        error(res, "No tienes permisos para administrar usuarios.", 403);
        return false;
    }

    return true;
}

function validarId(id) {
    return typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function validarDatos(body = {}, incluirContrasena = false) {
    const nombre = typeof body.nombre === "string"
        ? body.nombre.trim()
        : "";

    const email = typeof body.email === "string"
        ? body.email.trim().toLowerCase()
        : "";

    const telefono = typeof body.telefono === "string"
        ? body.telefono.trim() || null
        : body.telefono == null ? null : undefined;

    if (!nombre || nombre.length > 120) {
        return { error: "El nombre es obligatorio y admite hasta 120 caracteres." };
    }

    if (!email || email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: "Ingresa un correo electrónico válido." };
    }

    if (telefono === undefined || (telefono && telefono.length > 30)) {
        return { error: "El teléfono admite hasta 30 caracteres." };
    }

    if (!ROLES.includes(body.role)) {
        return { error: "El rol seleccionado no es válido." };
    }

    const datos = {
        nombre,
        email,
        telefono,
        role: body.role,
        activo: body.activo === undefined ? true : body.activo
    };

    if (typeof datos.activo !== "boolean") {
        return { error: "El estado debe ser verdadero o falso." };
    }

    if (incluirContrasena) {
        if (typeof body.password !== "string" || body.password.length < 8) {
            return { error: "La contraseña debe tener al menos 8 caracteres." };
        }

        datos.password = body.password;
    }

    return { datos };
}

function idValido(req, res) {
    if (!validarId(req.params.id)) {
        error(res, "Identificador inválido.");
        return false;
    }

    return true;
}

function esUsuarioActual(req, id) {
    const usuarioId = req.session?.user?.id ||
        req.session?.user?.usuarios_id;

    return usuarioId && String(usuarioId) === String(id);
}

async function listar(req, res, next) {
    if (!esAdministrador(req, res)) return;

    try {
        const data = await EmpleadosModel.obtenerTodos();
        res.json({ data });
    } catch (err) {
        next(err);
    }
}

async function obtener(req, res, next) {
    if (!esAdministrador(req, res)) return;
    if (!idValido(req, res)) return;

    try {
        const data = await EmpleadosModel.obtenerPorId(req.params.id);

        if (!data) return error(res, "Usuario no encontrado.", 404);

        res.json({ data });
    } catch (err) {
        next(err);
    }
}

async function crear(req, res, next) {
    if (!esAdministrador(req, res)) return;

    try {
        const validacion = validarDatos(req.body, true);
        if (validacion.error) return error(res, validacion.error);

        const datos = validacion.datos;

        if (await EmpleadosModel.buscarPorEmail(datos.email)) {
            return error(res, "Ya existe un usuario con ese correo.", 409);
        }

        datos.password_hash = await bcrypt.hash(datos.password, 12);
        delete datos.password;

        const data = await EmpleadosModel.crear(datos);

        res.status(201).json({
            message: "Usuario registrado correctamente.",
            data
        });
    } catch (err) {
        if (err.code === "23505") {
            return error(res, "El correo electrónico ya está registrado.", 409);
        }

        next(err);
    }
}

async function actualizar(req, res, next) {
    if (!esAdministrador(req, res)) return;
    if (!idValido(req, res)) return;

    try {
        const validacion = validarDatos(req.body);
        if (validacion.error) return error(res, validacion.error);

        const datos = validacion.datos;
        const id = req.params.id;

        if (esUsuarioActual(req, id) &&
            (datos.role !== "administrador" || !datos.activo)) {
            return error(
                res,
                "No puedes quitarte el rol de administrador ni desactivar tu cuenta."
            );
        }

        if (await EmpleadosModel.buscarPorEmail(datos.email, id)) {
            return error(res, "El correo ya pertenece a otro usuario.", 409);
        }

        const data = await EmpleadosModel.actualizar(id, datos);

        if (!data) return error(res, "Usuario no encontrado.", 404);

        res.json({
            message: "Usuario actualizado correctamente.",
            data
        });
    } catch (err) {
        if (err.code === "23505") {
            return error(res, "El correo electrónico ya está registrado.", 409);
        }

        next(err);
    }
}

async function cambiarContrasena(req, res, next) {
    if (!esAdministrador(req, res)) return;
    if (!idValido(req, res)) return;

    try {
        const password = req.body?.password;

        if (typeof password !== "string" || password.length < 8) {
            return error(res, "La contraseña debe tener al menos 8 caracteres.");
        }

        const hash = await bcrypt.hash(password, 12);
        const data = await EmpleadosModel.actualizarContrasena(
            req.params.id,
            hash
        );

        if (!data) return error(res, "Usuario no encontrado.", 404);

        res.json({ message: "Contraseña actualizada correctamente." });
    } catch (err) {
        next(err);
    }
}

async function cambiarEstado(req, res, next) {
    if (!esAdministrador(req, res)) return;
    if (!idValido(req, res)) return;

    try {
        const { activo } = req.body || {};

        if (typeof activo !== "boolean") {
            return error(res, "Debes indicar el estado del usuario.");
        }

        if (!activo && esUsuarioActual(req, req.params.id)) {
            return error(res, "No puedes desactivar tu propia cuenta.");
        }

        const data = await EmpleadosModel.cambiarEstado(
            req.params.id,
            activo
        );

        if (!data) return error(res, "Usuario no encontrado.", 404);

        res.json({
            message: "Estado actualizado correctamente.",
            data
        });
    } catch (err) {
        next(err);
    }
}

module.exports = {
    listar,
    obtener,
    crear,
    actualizar,
    cambiarContrasena,
    cambiarEstado
};