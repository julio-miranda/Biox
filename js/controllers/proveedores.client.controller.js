"use strict";

(async () => {
    const $ = id => document.getElementById(id);
    const API = "/api/proveedores";
    const api = window.BIOXSession?.request;
    const form = $("proveedorForm");
    const dialog = $("proveedorModal");
    const tbody = $("proveedoresTableBody");
    const mensaje = $("mensajeProveedores");
    const guardar = $("btnGuardarProveedor");

    if (!api || !form || !dialog || !tbody) return;
    if (!(await window.BIOXSession.ready)) return;

    let proveedores = [];
    let temporizadorMensaje;

    function escapar(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[caracter]);
    }

    function mostrarMensaje(texto, tipo = "success") {
        mensaje.textContent = texto;
        mensaje.className = `message show ${tipo}`;
        clearTimeout(temporizadorMensaje);
        temporizadorMensaje = setTimeout(() => {
            mensaje.className = "message";
        }, 5000);
    }

    function actualizarTabla() {
        const busqueda = $("buscarProveedor").value.trim().toLocaleLowerCase("es-SV");
        const filtroEstado = $("filtroEstadoProveedor").value;

        const lista = proveedores.filter(proveedor => {
            const activo = proveedor.activo === true;
            const coincideEstado = filtroEstado === "todos" ||
                (filtroEstado === "activos" && activo) ||
                (filtroEstado === "inactivos" && !activo);
            const texto = [
                proveedor.nombre,
                proveedor.razon_social_denominacion,
                proveedor.nit,
                proveedor.nrc,
                proveedor.telefono,
                proveedor.email,
                proveedor.ubicacion
            ].join(" ").toLocaleLowerCase("es-SV");

            return coincideEstado && texto.includes(busqueda);
        });

        $("contadorProveedores").textContent =
            `${lista.length} ${lista.length === 1 ? "proveedor" : "proveedores"}`;

        if (!lista.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        ${proveedores.length ? "No hay proveedores que coincidan con la búsqueda." : "No hay proveedores registrados."}
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = lista.map(proveedor => {
            const id = escapar(proveedor.proveedores_id);
            const activo = proveedor.activo === true;
            const razonSocial = proveedor.razon_social_denominacion
                ? `<span class="secondary-text">${escapar(proveedor.razon_social_denominacion)}</span>`
                : "";

            return `
                <tr>
                    <td><strong>${escapar(proveedor.nombre)}</strong>${razonSocial}</td>
                    <td>${escapar(proveedor.nit || "—")}</td>
                    <td>${escapar(proveedor.nrc || "—")}</td>
                    <td>${escapar(proveedor.telefono || "—")}</td>
                    <td>${escapar(proveedor.email || "—")}</td>
                    <td>
                        <span class="badge ${activo ? "badge-active" : "badge-inactive"}">
                            ${activo ? "Activo" : "Inactivo"}
                        </span>
                    </td>
                    <td>
                        <div class="actions">
                            <button type="button" class="btn btn-secondary btn-small"
                                data-accion="editar" data-id="${id}">Editar</button>
                            ${activo ? `
                                <button type="button" class="btn btn-danger btn-small"
                                    data-accion="eliminar" data-id="${id}">Eliminar</button>` : ""}
                        </div>
                    </td>
                </tr>`;
        }).join("");
    }

    async function cargarProveedores() {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-state">Cargando proveedores...</td></tr>';

        try {
            const resultado = await api(API);
            proveedores = Array.isArray(resultado.data) ? resultado.data : [];
            actualizarTabla();
        } catch (error) {
            mostrarMensaje(error.message, "error");
            tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No se pudieron cargar los proveedores.</td></tr>';
        }
    }

    function limpiarFormulario() {
        form.reset();
        $("proveedorId").value = "";
        $("proveedorActivo").checked = true;
        $("grupoEstadoProveedor").hidden = true;
        $("tituloProveedorModal").textContent = "Añadir proveedor";
        guardar.textContent = "Guardar proveedor";
    }

    function abrirNuevo() {
        limpiarFormulario();
        dialog.showModal();
        $("proveedorNombre").focus();
    }

    function abrirEdicion(id) {
        const proveedor = proveedores.find(item =>
            String(item.proveedores_id) === String(id)
        );
        if (!proveedor) return;

        limpiarFormulario();
        $("proveedorId").value = proveedor.proveedores_id;
        $("proveedorNombre").value = proveedor.nombre || "";
        $("proveedorRazonSocial").value = proveedor.razon_social_denominacion || "";
        $("proveedorNit").value = proveedor.nit || "";
        $("proveedorNrc").value = proveedor.nrc || "";
        $("proveedorTelefono").value = proveedor.telefono || "";
        $("proveedorEmail").value = proveedor.email || "";
        $("proveedorUbicacion").value = proveedor.ubicacion || "";
        $("proveedorActivo").checked = proveedor.activo === true;
        $("grupoEstadoProveedor").hidden = false;
        $("tituloProveedorModal").textContent = "Editar proveedor";
        guardar.textContent = "Guardar cambios";
        dialog.showModal();
        $("proveedorNombre").focus();
    }

    async function guardarProveedor(evento) {
        evento.preventDefault();
        if (!form.reportValidity()) return;

        const id = $("proveedorId").value;
        const datos = {
            nombre: $("proveedorNombre").value.trim(),
            razon_social_denominacion: $("proveedorRazonSocial").value.trim() || null,
            nit: $("proveedorNit").value.trim() || null,
            nrc: $("proveedorNrc").value.trim() || null,
            telefono: $("proveedorTelefono").value.trim() || null,
            email: $("proveedorEmail").value.trim() || null,
            ubicacion: $("proveedorUbicacion").value.trim() || null
        };

        if (id) datos.activo = $("proveedorActivo").checked;

        guardar.disabled = true;
        guardar.textContent = "Guardando...";

        try {
            const editando = Boolean(id);
            await api(editando ? `${API}/${encodeURIComponent(id)}` : API, {
                method: editando ? "PUT" : "POST",
                body: JSON.stringify(datos)
            });

            dialog.close();
            limpiarFormulario();
            mostrarMensaje(editando ? "Proveedor actualizado." : "Proveedor creado.");
            await cargarProveedores();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        } finally {
            guardar.disabled = false;
            guardar.textContent = $("proveedorId").value
                ? "Guardar cambios"
                : "Guardar proveedor";
        }
    }

    async function eliminarProveedor(id) {
        const proveedor = proveedores.find(item =>
            String(item.proveedores_id) === String(id)
        );
        if (!proveedor) return;

        const confirmar = window.confirm(
            `¿Eliminar a ${proveedor.nombre}? El proveedor se desactivará y sus referencias históricas se conservarán.`
        );
        if (!confirmar) return;

        try {
            const resultado = await api(`${API}/${encodeURIComponent(id)}`, {
                method: "DELETE"
            });
            mostrarMensaje(resultado.message || "Proveedor desactivado.");
            await cargarProveedores();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }

    form.addEventListener("submit", guardarProveedor);
    $("btnNuevoProveedor").addEventListener("click", abrirNuevo);
    $("btnCancelarProveedor").addEventListener("click", () => dialog.close());
    $("btnRecargarProveedores").addEventListener("click", cargarProveedores);
    $("buscarProveedor").addEventListener("input", actualizarTabla);
    $("filtroEstadoProveedor").addEventListener("change", actualizarTabla);

    tbody.addEventListener("click", evento => {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;

        if (boton.dataset.accion === "editar") {
            abrirEdicion(boton.dataset.id);
        } else if (boton.dataset.accion === "eliminar") {
            eliminarProveedor(boton.dataset.id);
        }
    });

    dialog.addEventListener("click", evento => {
        if (evento.target === dialog) dialog.close();
    });

    dialog.addEventListener("close", limpiarFormulario);
    await cargarProveedores();
})();
