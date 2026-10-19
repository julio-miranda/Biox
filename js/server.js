const express = require("express");
const session = require("express-session");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

if (!process.env.SESSION_SECRET) {
    throw new Error(
        "Debes configurar SESSION_SECRET en el archivo .env."
    );
}

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(
    session({
        name: "biox.sid",
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            maxAge: 8 * 60 * 60 * 1000
        }
    })
);

app.use(express.static(path.join(__dirname, "..")));

const LoginController = require("./controllers/login.controller");

app.post("/api/login", LoginController.login);
app.get("/api/session", LoginController.obtenerSesion);
app.post("/api/logout", LoginController.logout);

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    console.error("Error del servidor:", error.message);

    res.status(500).json({
        message: "Ocurrió un error interno del servidor."
    });
});

app.listen(PORT, () => {
    console.log(`BiOX ejecutándose en http://localhost:${PORT}`);
});