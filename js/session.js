"use strict";

(() => {
    // ============================================================
    // CONFIGURACIÓN DE ROLES Y MENÚS
    // ============================================================

    const ROLES = {
        administrador: "Administrador",
        barra: "Barra",
        bodega: "Bodega",
        pendiente: "Pendiente"
    };

    const MENUS = {
        administrador: [
            ["Inicio", "dashboard.html"],
            ["Ventas", "ventas.html"],
            ["Inventario", "inventario.html"],
            ["Categorías", "categorias.html"],
            ["Proveedores", "proveedores.html"],
            ["Afluencia", "afluencia.html"],
            ["Satisfacción", "satisfaccion.html"],
            ["Empleados", "empleados.html"]
        ],

        barra: [
            ["Inicio", "dashboard.html"],
            ["Ventas", "ventas.html"],
            ["Inventario", "inventario.html"],
            ["Afluencia", "afluencia.html"],
            ["Satisfacción", "satisfaccion.html"]
        ],

        bodega: [
            ["Inicio", "dashboard.html"],
            ["Inventario", "inventario.html"],
            ["Categorías", "categorias.html"],
            ["Proveedores", "proveedores.html"]
        ],

        pendiente: [
            ["Inicio", "dashboard.html"]
        ]
    };

    // ============================================================
    // ESTADO DE LA SESIÓN
    // ============================================================

    const session = {
        usuario: null,
        ready: null,
        request
    };

    let redireccionando = false;

    // ============================================================
    // UTILIDADES
    // ============================================================

    function esPaginaLogin() {
        const ruta = window.location.pathname
            .toLowerCase()
            .replace(/\/+$/, "");

        return (
            ruta === "" ||
            ruta === "/" ||
            ruta.endsWith("/index.html") ||
            ruta.endsWith("/login.html")
        );
    }

    function redirigir(url) {
        if (redireccionando) {
            return;
        }

        redireccionando = true;
        window.location.replace(url);
    }

    function normalizarRol(valor) {
        if (typeof valor !== "string") {
            return "";
        }

        const rol = valor
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");

        const equivalencias = {
            administrador: "administrador",
            admin: "administrador",
            barra: "barra",
            bodega: "bodega",
            pendiente: "pendiente"
        };

        return equivalencias[rol] || "";
    }

    function normalizarUsuario(usuario) {
        if (!usuario || typeof usuario !== "object") {
            return null;
        }

        const rol = normalizarRol(
            usuario.role ??
            usuario.rol ??
            usuario.user_role ??
            usuario.userRole
        );

        if (!rol) {
            return null;
        }

        return {
            ...usuario,
            role: rol
        };
    }

    function obtenerUsuario(resultado) {
        if (!resultado || typeof resultado !== "object") {
            return null;
        }

        const candidatos = [
            resultado.user,
            resultado.usuario,
            resultado.data?.user,
            resultado.data?.usuario,
            resultado.data,
            resultado
        ];

        for (const candidato of candidatos) {
            const usuario = normalizarUsuario(candidato);

            if (usuario) {
                return usuario;
            }
        }

        return null;
    }

    function obtenerMensajeError(resultado, status) {
        if (
            resultado &&
            typeof resultado === "object"
        ) {
            const mensaje =
                resultado.mensaje ||
                resultado.message ||
                resultado.error;

            if (typeof mensaje === "string" && mensaje.trim()) {
                return mensaje;
            }
        }

        return `Error HTTP ${status}.`;
    }

    function crearError(mensaje, status) {
        const error = new Error(mensaje);
        error.status = status;
        return error;
    }

    // ============================================================
    // SOLICITUDES HTTP
    // ============================================================

    async function request(url, opciones = {}) {
        const {
            redirectOnUnauthorized = true,
            ...opcionesFetch
        } = opciones;

        const configuracion = {
            credentials: "same-origin",
            cache: "no-store",
            ...opcionesFetch,

            headers: {
                Accept: "application/json",

                ...(opcionesFetch.body
                    ? {
                        "Content-Type": "application/json"
                    }
                    : {}),

                ...(opcionesFetch.headers || {})
            }
        };

        let respuesta;

        try {
            respuesta = await fetch(url, configuracion);
        } catch (error) {
            console.error(
                `No se pudo conectar con ${url}:`,
                error
            );

            throw new Error(
                "No se pudo conectar con el servidor BIOX. " +
                "Comprueba que Node.js esté ejecutándose."
            );
        }

        // Una respuesta 304 no contiene el cuerpo JSON que necesitamos.
        // Se realiza un segundo intento evitando la caché del navegador.
        if (respuesta.status === 304) {
            try {
                respuesta = await fetch(url, {
                    ...configuracion,
                    cache: "reload",
                    headers: {
                        ...configuracion.headers,
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache"
                    }
                });
            } catch (error) {
                console.error(
                    `No se pudo repetir la solicitud a ${url}:`,
                    error
                );

                throw new Error(
                    "No se pudo recuperar la respuesta actualizada del servidor."
                );
            }
        }

        let resultado = {};

        // Se lee como texto primero para admitir respuestas vacías
        // y detectar respuestas que no contengan JSON válido.
        const texto = await respuesta.text();

        if (texto.trim()) {
            try {
                resultado = JSON.parse(texto);
            } catch {
                if (respuesta.ok) {
                    console.error(
                        `Respuesta no JSON recibida desde ${url}:`,
                        texto.slice(0, 300)
                    );

                    throw new Error(
                        "El servidor devolvió una respuesta que no es JSON."
                    );
                }
            }
        }

        // --------------------------------------------------------
        // Sesión no válida
        // --------------------------------------------------------

        if (respuesta.status === 401) {
            if (
                redirectOnUnauthorized &&
                !esPaginaLogin()
            ) {
                redirigir("/index.html");
            }

            throw crearError(
                obtenerMensajeError(resultado, 401),
                401
            );
        }

        // --------------------------------------------------------
        // Respuestas HTTP no satisfactorias
        // --------------------------------------------------------

        if (!respuesta.ok) {
            let mensaje = obtenerMensajeError(
                resultado,
                respuesta.status
            );

            if (respuesta.status === 304) {
                mensaje =
                    "El servidor devolvió HTTP 304 sin los datos solicitados. " +
                    "Comprueba el controlador de la ruta y la caché HTTP.";
            }

            throw crearError(mensaje, respuesta.status);
        }

        return resultado;
    }

    // ============================================================
    // NAVEGACIÓN SEGÚN EL ROL
    // ============================================================

    function obtenerPaginaInicial(rol) {
        return MENUS[normalizarRol(rol)]
            ? "dashboard.html"
            : "index.html";
    }

    function mostrarNavbar(usuario) {
        const contenedor = document.getElementById("appNavbar");

        if (!contenedor) {
            return;
        }

        const rol = normalizarRol(usuario.role);
        const menu = MENUS[rol] || [];

        const segmentos = window.location.pathname.split("/");
        const pagina = (
            segmentos[segmentos.length - 1] || "dashboard.html"
        ).toLowerCase();

        contenedor.innerHTML = `
            <nav class="navbar">
                <div class="navbar-container">

                    <a class="navbar-brand" href="dashboard.html">
                        BI<span>OX</span>
                    </a>

                    <button
                        type="button"
                        class="navbar-toggle"
                        id="navbarToggle"
                        aria-label="Abrir menú"
                        aria-expanded="false"
                        aria-controls="navbarMenu"
                    >☰</button>

                    <div class="navbar-menu" id="navbarMenu">
                        ${menu.map(([nombre, ruta]) => {
                            const activa =
                                pagina === ruta.toLowerCase();

                            return `
                                <a
                                    class="navbar-link ${activa ? "active" : ""}"
                                    href="${ruta}"
                                    ${activa ? 'aria-current="page"' : ""}
                                >${nombre}</a>
                            `;
                        }).join("")}
                    </div>

                    <div class="navbar-user">

                        <div class="navbar-user-info">
                            <span
                                class="navbar-user-name"
                                id="navbarUserName"
                            ></span>

                            <span
                                class="navbar-user-role"
                                id="navbarUserRole"
                            ></span>
                        </div>

                        <button
                            type="button"
                            class="btn-logout"
                            id="btnCerrarSesion"
                        >Cerrar sesión</button>

                    </div>
                </div>
            </nav>
        `;

        const nombreUsuario =
            document.getElementById("navbarUserName");

        const rolUsuario =
            document.getElementById("navbarUserRole");

        const botonMenu =
            document.getElementById("navbarToggle");

        const menuElement =
            document.getElementById("navbarMenu");

        const botonCerrarSesion =
            document.getElementById("btnCerrarSesion");

        nombreUsuario.textContent =
            usuario.nombre ||
            usuario.email ||
            "Usuario";

        rolUsuario.textContent =
            ROLES[rol] || "Usuario";

        // --------------------------------------------------------
        // Menú móvil
        // --------------------------------------------------------

        botonMenu.addEventListener("click", () => {
            const abierto = menuElement.classList.toggle("open");

            botonMenu.setAttribute(
                "aria-expanded",
                String(abierto)
            );

            botonMenu.setAttribute(
                "aria-label",
                abierto ? "Cerrar menú" : "Abrir menú"
            );
        });

        menuElement.addEventListener("click", evento => {
            if (evento.target.closest("a")) {
                menuElement.classList.remove("open");

                botonMenu.setAttribute(
                    "aria-expanded",
                    "false"
                );

                botonMenu.setAttribute(
                    "aria-label",
                    "Abrir menú"
                );
            }
        });

        // --------------------------------------------------------
        // Cerrar sesión
        // --------------------------------------------------------

        botonCerrarSesion.addEventListener(
            "click",
            cerrarSesion
        );
    }

    // ============================================================
    // CERRAR SESIÓN
    // ============================================================

    async function cerrarSesion() {
        const boton = document.getElementById("btnCerrarSesion");

        if (boton) {
            boton.disabled = true;
        }

        try {
            await request("/api/logout", {
                method: "POST"
            });

            session.usuario = null;

            redirigir("/index.html");
        } catch (error) {
            console.error(
                "Error al cerrar sesión:",
                error.message
            );

            if (error.status === 401) {
                session.usuario = null;
                redirigir("/index.html");
                return;
            }

            if (boton) {
                boton.disabled = false;
            }

            if (typeof window.Swal !== "undefined") {
                window.Swal.fire({
                    icon: "error",
                    title: "No se pudo cerrar la sesión",
                    text: error.message
                });
            }
        }
    }

    // ============================================================
    // INICIALIZAR SESIÓN
    // ============================================================

    async function iniciarSesion() {
        try {
            const resultado = await request("/api/session", {
                redirectOnUnauthorized: false
            });

            const usuario = obtenerUsuario(resultado);

            if (!usuario) {
                session.usuario = null;

                if (!esPaginaLogin()) {
                    redirigir("/index.html");
                }

                return null;
            }

            if (esPaginaLogin()) {
                redirigir(obtenerPaginaInicial(usuario.role));
                return usuario;
            }

            const permitidos = document.body.dataset.roles;

            if (permitidos) {
                const rolesPermitidos = permitidos
                    .split(",")
                    .map(rol => normalizarRol(rol))
                    .filter(Boolean);

                if (!rolesPermitidos.includes(usuario.role)) {
                    const destino = obtenerPaginaInicial(
                        usuario.role
                    );

                    const paginaActual = window.location.pathname
                        .split("/")
                        .pop()
                        .toLowerCase();

                    if (
                        destino.toLowerCase() === paginaActual
                    ) {
                        redirigir("/index.html");
                    } else {
                        redirigir(destino);
                    }

                    return null;
                }
            }

            session.usuario = usuario;

            session.obtenerModulos = (rol = usuario.role) =>
                (MENUS[normalizarRol(rol)] || [])
                    .map(([nombre, ruta]) => ({ nombre, ruta }));

            mostrarNavbar(usuario);

            return usuario;

        } catch (error) {
            session.usuario = null;

            // No es un error inesperado que no exista una sesión
            // al abrir la página de inicio de sesión.
            if (error.status === 401) {
                if (!esPaginaLogin()) {
                    redirigir("/index.html");
                }

                return null;
            }

            console.error(
                "No se pudo verificar la sesión:",
                error.message
            );

            // Si la verificación falla en una página protegida,
            // no se continúa como si el usuario estuviera autenticado.
            if (!esPaginaLogin()) {
                redirigir("/index.html");
            }

            return null;
        }
    }

    // ============================================================
    // INICIALIZACIÓN GLOBAL
    // ============================================================

    session.ready = iniciarSesion();

    window.BIOXSession = session;
})();
