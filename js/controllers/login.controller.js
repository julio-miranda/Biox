const bcrypt = require("bcryptjs");
const LoginModel = require("../models/login.model");

async function login(req, res, next) {
    try {
        const email =
            typeof req.body.email === "string"
                ? req.body.email.trim()
                : "";

        const password =
            typeof req.body.password === "string"
                ? req.body.password
                : "";

        if (!email || !password) {
            return res.status(400).json({
                message: "Ingresa tu correo electrónico y contraseña."
            });
        }

        const usuario = await LoginModel.buscarPorEmail(email);

        if (!usuario || !usuario.activo) {
            return res.status(401).json({
                message: "Correo electrónico o contraseña incorrectos."
            });
        }

        const passwordValida = await bcrypt.compare(
            password,
            usuario.password_hash
        );

        if (!passwordValida) {
            return res.status(401).json({
                message: "Correo electrónico o contraseña incorrectos."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                return next(error);
            }

            req.session.user = {
                id: usuario.usuarios_id,
                nombre: usuario.nombre,
                email: usuario.email,
                role: usuario.role
            };

            req.session.save((errorGuardado) => {
                if (errorGuardado) {
                    return next(errorGuardado);
                }

                return res.status(200).json({
                    message: "Inicio de sesión correcto.",
                    user: req.session.user
                });
            });
        });
    } catch (error) {
        next(error);
    }
}

function logout(req, res, next) {
    req.session.destroy((error) => {
        if (error) {
            return next(error);
        }

        res.clearCookie("biox.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        return res.status(200).json({
            message: "Sesión cerrada correctamente."
        });
    });
}

function obtenerSesion(req, res) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "No hay una sesión iniciada."
        });
    }

    return res.status(200).json({
        user: req.session.user
    });
}

module.exports = {
    login,
    logout,
    obtenerSesion
};