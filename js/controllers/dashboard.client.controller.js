"use strict";

(() => {
    const DETALLES = {
        "ventas.html": {
            descripcion: "Registra ventas y consulta las transacciones del establecimiento."
        },
        "inventario.html": {
            descripcion: "Consulta existencias, niveles mínimos y recetas."
        },
        "categorias.html": {
            descripcion: "Organiza los productos y las categorías comerciales."
        },
        "proveedores.html": {
            descripcion: "Administra los proveedores y su información de contacto."
        },
        "afluencia.html": {
            descripcion: "Registra las entradas y salidas de personas en el local."
        },
        "satisfaccion.html": {
            descripcion: "Consulta y captura información de satisfacción del cliente."
        },
        "empleados.html": {
            descripcion: "Gestiona usuarios, roles y acceso al sistema."
        }
    };

    const escapar = valor => String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);

    async function iniciar() {
        const sesion = window.BIOXSession;
        if (!sesion) return;

        const usuario = await sesion.ready;
        if (!usuario) return;

        const nombre = usuario.nombre || usuario.email || "usuario";
        document.getElementById("welcomeName").textContent = nombre;

        const modulos = typeof sesion.obtenerModulos === "function"
            ? sesion.obtenerModulos().filter(modulo => modulo.ruta !== "dashboard.html")
            : [];
        const grid = document.getElementById("moduleGrid");
        const panel = document.getElementById("modulePanel");
        const empty = document.getElementById("noModules");

        document.getElementById("moduleCount").textContent =
            `${modulos.length} ${modulos.length === 1 ? "módulo disponible" : "módulos disponibles"}`;

        if (modulos.length === 0) {
            panel.hidden = true;
            empty.hidden = false;
            return;
        }

        panel.hidden = false;
        empty.hidden = true;

        grid.innerHTML = modulos.map(modulo => {
            const detalle = DETALLES[modulo.ruta] || {
                descripcion: "Abre este módulo de BIOX."
            };

            return `
                <article class="stat-card">
                    <h3>${escapar(modulo.nombre)}</h3>
                    <div class="section-note">${escapar(detalle.descripcion)}</div>
                    <a class="btn btn-primary" href="${escapar(modulo.ruta)}">Abrir módulo</a>
                </article>
            `;
        }).join("");
    }

    document.addEventListener("DOMContentLoaded", iniciar);
})();
