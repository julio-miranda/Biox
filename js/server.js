"use strict";

const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

// ============================================================
// VALIDACIÓN DE CONFIGURACIÓN
// ============================================================

if (!process.env.SESSION_SECRET) {
    throw new Error(
        "Debes configurar SESSION_SECRET en el archivo .env."
    );
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("La variable PORT contiene un puerto no válido.");
}

// ============================================================
// CONFIGURACIÓN GENERAL
// ============================================================

app.disable("x-powered-by");

if (process.env.NODE_ENV === "production") {
    // Necesario cuando producción utiliza un proxy HTTPS confiable.
    app.set("trust proxy", 1);
}

app.use(express.json({
    limit: "10kb"
}));

app.use(express.urlencoded({
    extended: false,
    limit: "10kb"
}));

// ============================================================
// SESIONES
// ============================================================

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

// ============================================================
// REGISTRO Y CONFIGURACIÓN DE SOLICITUDES API
// ============================================================

app.use("/api", (req, res, next) => {
    // Las respuestas de la API no deben quedarse almacenadas en caché.
    res.setHeader(
        "Cache-Control",
        "no-store, no-cache, must-revalidate, proxy-revalidate"
    );

    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const inicio = Date.now();

    res.on("finish", () => {
        console.info(
            `[API] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - inicio} ms)`
        );
    });

    next();
});

// ============================================================
// ESTADO DEL SERVIDOR
// ============================================================

// Comprueba que Express responde.
// No comprueba por sí solo la conexión a PostgreSQL.

app.get("/api/health", (req, res) => {
    return res.status(200).json({
        ok: true,
        servicio: "BIOX",
        mensaje: "El servidor está funcionando.",
        fecha: new Date().toISOString()
    });
});

// ============================================================
// AUTENTICACIÓN Y SESIÓN
// ============================================================

const LoginController = require("./controllers/login.controller");

app.post(
    "/api/login",
    LoginController.login
);

app.get(
    "/api/session",
    LoginController.obtenerSesion
);

app.post(
    "/api/logout",
    LoginController.logout
);

// ============================================================
// EMPLEADOS
// ============================================================

const EmpleadoController = require("./controllers/empleado.controller");

app.get(
    "/api/empleados",
    EmpleadoController.listar
);

app.get(
    "/api/empleados/:id",
    EmpleadoController.obtener
);

app.post(
    "/api/empleados",
    EmpleadoController.crear
);

app.put(
    "/api/empleados/:id",
    EmpleadoController.actualizar
);

app.patch(
    "/api/empleados/:id/contrasena",
    EmpleadoController.cambiarContrasena
);

app.patch(
    "/api/empleados/:id/estado",
    EmpleadoController.cambiarEstado
);

// ============================================================
// SATISFACCIÓN
// ============================================================

const SatisfaccionController = require("./controllers/satisfaccion.controller");

app.post(
    "/api/satisfaccion",
    SatisfaccionController.crear
);

// ============================================================
// INVENTARIO BIOX
// ============================================================

const inventoryController = require("./controllers/inventory.controller");
const ProveedoresController = require("./controllers/proveedores.controller");

// ============================================================
// PROVEEDORES
// ============================================================

app.get(
    "/api/proveedores",
    inventoryController.requiereGestionInventario,
    ProveedoresController.listar
);

app.post(
    "/api/proveedores",
    inventoryController.requiereGestionInventario,
    ProveedoresController.crear
);

app.put(
    "/api/proveedores/:id",
    inventoryController.requiereGestionInventario,
    ProveedoresController.actualizar
);

app.delete(
    "/api/proveedores/:id",
    inventoryController.requiereGestionInventario,
    ProveedoresController.eliminar
);

// ------------------------------------------------------------
// Consultas generales de inventario
// ------------------------------------------------------------

app.get(
    "/api/inventario/resumen",
    inventoryController.requiereInventario,
    inventoryController.obtenerResumen
);

app.get(
    "/api/inventario/categorias",
    inventoryController.requiereInventario,
    inventoryController.obtenerCategorias
);

app.get(
    "/api/inventario/proveedores",
    inventoryController.requiereInventario,
    inventoryController.obtenerProveedores
);

app.get(
    "/api/inventario/productos",
    inventoryController.requiereInventario,
    inventoryController.obtenerProductos
);

// ------------------------------------------------------------
// Envases y botellas abiertas
// ------------------------------------------------------------

app.get(
    "/api/inventario/envases",
    inventoryController.requiereInventario,
    inventoryController.obtenerEnvases
);

// ------------------------------------------------------------
// Gestión de productos
// ------------------------------------------------------------

app.post(
    "/api/inventario/productos",
    inventoryController.requiereGestionInventario,
    inventoryController.crearProducto
);

app.post(
    "/api/inventario/productos/con-entrada",
    inventoryController.requiereGestionInventario,
    inventoryController.crearProductoConEntrada
);

app.put(
    "/api/inventario/productos/:id",
    inventoryController.requiereGestionInventario,
    inventoryController.actualizarProducto
);

app.patch(
    "/api/inventario/productos/:id/activar",
    inventoryController.requiereGestionInventario,
    inventoryController.activarProducto
);

app.patch(
    "/api/inventario/productos/:id/desactivar",
    inventoryController.requiereGestionInventario,
    inventoryController.desactivarProducto
);

// ------------------------------------------------------------
// Movimientos de inventario
// ------------------------------------------------------------

app.post(
    "/api/inventario/movimientos",
    inventoryController.requiereGestionInventario,
    inventoryController.registrarMovimiento
);

// ------------------------------------------------------------
// Gestión de recetas
// ------------------------------------------------------------

app.get(
    "/api/inventario/recetas",
    inventoryController.requiereInventario,
    inventoryController.obtenerRecetas
);

app.post(
    "/api/inventario/recetas",
    inventoryController.requiereGestionRecetas,
    inventoryController.crearReceta
);

app.put(
    "/api/inventario/recetas/:id",
    inventoryController.requiereGestionRecetas,
    inventoryController.actualizarReceta
);

app.patch(
    "/api/inventario/recetas/:id/desactivar",
    inventoryController.requiereGestionRecetas,
    inventoryController.desactivarReceta
);


// ============================================================
// VENTAS BIOX
// ============================================================

const VentasController = require("./controllers/ventas.controller");

app.get(
    "/api/ventas/productos",
    VentasController.requiereVentas,
    VentasController.listarProductos
);

app.get(
    "/api/ventas",
    VentasController.requiereVentas,
    VentasController.listar
);

app.get(
    "/api/ventas/:id",
    VentasController.requiereVentas,
    VentasController.obtener
);

app.post(
    "/api/ventas",
    VentasController.requiereVentas,
    VentasController.crear
);

// ============================================================
// RUTAS API NO ENCONTRADAS
// ============================================================

// Se registra antes de servir los archivos estáticos para que una
// ruta API inexistente siempre devuelva JSON y no un HTML.

app.use("/api", (req, res) => {
    return res.status(404).json({
        ok: false,
        mensaje: "La ruta API solicitada no existe.",
        ruta: req.path,
        metodo: req.method
    });
});

// ============================================================
// ARCHIVOS ESTÁTICOS DEL FRONTEND
// ============================================================

const projectRoot = path.resolve(__dirname, "..");
const publicRoot = path.join(projectRoot, "public");

// Si existe public/index.html, se utiliza public como raíz.
// Si no existe, se conserva la raíz actual del proyecto.

const staticRoot = fs.existsSync(
    path.join(publicRoot, "index.html")
)
    ? publicRoot
    : projectRoot;

// ------------------------------------------------------------
// Protección de archivos internos
// ------------------------------------------------------------

// Cuando la raíz estática es la raíz del proyecto, se impide que
// se descarguen archivos conocidos del backend o de configuración.
// Los archivos *.client.controller.js no se bloquean.

function protegerArchivosInternos(req, res, next) {
    if (staticRoot !== projectRoot) {
        return next();
    }

    const ruta = req.path;

    const rutasProtegidas = [
        /^\/js\/server\.js$/i,
        /^\/js\/controllers\/(?!.*\.client\.controller\.js$).*\.controller\.js$/i,
        /^\/js\/models(?:\/|$)/i,
        /^\/js\/db\.js$/i,
        /^\/(?:package(?:-lock)?\.json)$/i,
        /^\/(?:database|sql|backups?)(?:\/|$)/i,
        /^\/\.env(?:\..*)?$/i,
        /^\/\.git(?:\/|$)/i,
        /^\/node_modules(?:\/|$)/i,
        /\.(?:sql|dump|bak|pem|key|crt|log)$/i
    ];

    const archivoProtegido = rutasProtegidas.some((patron) =>
        patron.test(ruta)
    );

    if (archivoProtegido) {
        return res.status(404).end();
    }

    return next();
}

app.use(protegerArchivosInternos);

app.use(
    express.static(staticRoot, {
        dotfiles: "ignore",
        index: "index.html",
        fallthrough: true,
        setHeaders(res, filePath) {
            // Evita que el navegador conserve versiones antiguas del HTML.
            if (path.extname(filePath).toLowerCase() === ".html") {
                res.setHeader(
                    "Cache-Control",
                    "no-cache, no-store, must-revalidate"
                );
            }
        }
    })
);

// ============================================================
// RUTA NO ENCONTRADA
// ============================================================

app.use((req, res) => {
    return res.status(404).json({
        ok: false,
        mensaje: "La ruta solicitada no existe."
    });
});

// ============================================================
// MANEJO GLOBAL DE ERRORES
// ============================================================

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    let status = Number(error.statusCode || error.status) || 500;
    let mensaje = "Ocurrió un error interno del servidor.";

    if (error.type === "entity.too.large") {
        status = 413;
        mensaje = "La solicitud supera el tamaño permitido.";
    } else if (
        error.type === "entity.parse.failed" ||
        (
            error instanceof SyntaxError &&
            status === 400 &&
            Object.prototype.hasOwnProperty.call(error, "body")
        )
    ) {
        status = 400;
        mensaje = "El cuerpo de la solicitud contiene JSON inválido.";
    } else if (status === 400) {
        mensaje = "La solicitud contiene datos no válidos.";
    } else if (status === 401) {
        mensaje = "Debes iniciar sesión para realizar esta operación.";
    } else if (status === 403) {
        mensaje = "No tienes permisos para realizar esta operación.";
    } else if (status === 404) {
        mensaje = "No se encontró el recurso solicitado.";
    }

    // Registrar el error en la terminal para facilitar el diagnóstico.
    console.error("Error del servidor:", {
        metodo: req.method,
        ruta: req.originalUrl,
        estado: status,
        mensaje: error.message,
        stack: process.env.NODE_ENV === "production"
            ? undefined
            : error.stack
    });

    const respuesta = {
        ok: false,
        mensaje
    };

    // El detalle técnico solo se expone en entornos de desarrollo.
    if (process.env.NODE_ENV !== "production") {
        respuesta.detalle = error.message;
    }

    return res.status(status).json(respuesta);
});

// ============================================================
// INICIO DEL SERVIDOR
// ============================================================

const server = app.listen(PORT, () => {
    console.log(`BIOX ejecutándose en http://localhost:${PORT}`);
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `El puerto ${PORT} ya está en uso. Cierra el otro proceso o configura PORT en .env.`
        );
    } else {
        console.error("No se pudo iniciar el servidor:", error);
    }

    process.exitCode = 1;
});
