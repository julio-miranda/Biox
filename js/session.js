"use strict";

(() => {
    const ROLES = {
        administrador: "Administrador",
        barra: "Barra",
        bodega: "Bodega",
        pendiente: "Pendiente"
    };

    const MENUS = {
        administrador: [
            ["Ventas", "ventas.html"],
            ["Inventario", "inventario.html"],
            ["Proveedores", "proveedores.html"],
            ["Afluencia", "afluencia.html"],
            ["Satisfacción", "satisfaccion.html"],
            ["Empleados", "empleados.html"]
        ],
        barra: [
            ["Ventas", "ventas.html"],
            ["Afluencia", "afluencia.html"],
            ["Satisfacción", "satisfaccion.html"]
        ],
        bodega: [
            ["Inventario", "inventario.html"],
            ["Proveedores", "proveedores.html"]
        ]
    };

    const session = {
        usuario: null,
        ready: null,
        request
    };

    async function request(url, opciones = {}) {
        const respuesta = await fetch(url, {
            credentials: "same-origin",
            ...opciones,
            headers: {
                ...(opciones.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(opciones.headers || {})
            }
        });

        const resultado = await respuesta.json().catch(() => ({}));

        if (respuesta.status === 401) {
            window.location.replace("/index.html");
            throw new Error("La sesión ha expirado.");
        }

        if (!respuesta.ok) {
            throw new Error(
                resultado.message || `Error HTTP ${respuesta.status}.`
            );
        }

        return resultado;
    }

    function obtenerUsuario(resultado) {
        return resultado.user
            || resultado.usuario
            || resultado.data?.user
            || resultado.data?.usuario
            || (resultado.role ? resultado : null);
    }

    function mostrarNavbar(usuario) {
        const contenedor = document.getElementById("appNavbar");
        if (!contenedor) return;

        const menu = MENUS[usuario.role] || MENUS.pendiente;
        const pagina = window.location.pathname.split("/").pop()
            || "dashboard.html";

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
                    >☰</button>

                    <div class="navbar-menu" id="navbarMenu">
                        ${menu.map(([nombre, ruta]) => `
                            <a
                                class="navbar-link ${pagina === ruta ? "active" : ""}"
                                href="${ruta}"
                                ${pagina === ruta ? 'aria-current="page"' : ""}
                            >${nombre}</a>
                        `).join("")}
                    </div>

                    <div class="navbar-user">
                        <div class="navbar-user-info">
                            <span class="navbar-user-name" id="navbarUserName"></span>
                            <span class="navbar-user-role" id="navbarUserRole"></span>
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

        document.getElementById("navbarUserName").textContent =
            usuario.nombre || usuario.email || "Usuario";

        document.getElementById("navbarUserRole").textContent =
            ROLES[usuario.role] || "Usuario";

        document.getElementById("navbarToggle").addEventListener("click", () => {
            const menu = document.getElementById("navbarMenu");
            const abierto = menu.classList.toggle("open");

            document.getElementById("navbarToggle").setAttribute(
                "aria-expanded",
                String(abierto)
            );
        });

        document.getElementById("navbarMenu").addEventListener("click", evento => {
            if (evento.target.closest("a")) {
                document.getElementById("navbarMenu").classList.remove("open");
                document.getElementById("navbarToggle").setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        });

        document.getElementById("btnCerrarSesion").addEventListener(
            "click",
            cerrarSesion
        );
    }

    async function cerrarSesion() {
        const boton = document.getElementById("btnCerrarSesion");
        if (boton) boton.disabled = true;

        try {
            await request("/api/logout", { method: "POST" });
            window.location.replace("/index.html");
        } catch (error) {
            console.error("Error al cerrar sesión:", error.message);
            if (boton) boton.disabled = false;
        }
    }

    async function iniciarSesion() {
        try {
            const resultado = await request("/api/session");
            const usuario = obtenerUsuario(resultado);

            if (!usuario || !usuario.role) {
                window.location.replace("/index.html");
                return null;
            }

            const permitidos = document.body.dataset.roles;

            if (permitidos) {
                const roles = permitidos.split(",").map(rol => rol.trim());

                if (!roles.includes(usuario.role)) {
                    window.location.replace("/empleados.html");
                    return null;
                }
            }

            session.usuario = usuario;
            mostrarNavbar(usuario);

            return usuario;
        } catch (error) {
            console.error("No se pudo verificar la sesión:", error.message);
            return null;
        }
    }

    session.ready = iniciarSesion();

    window.BIOXSession = session;
})();