"use strict";

(async () => {
    const $ = id => document.getElementById(id);
    const API = "/api/categorias";
    const api = window.BIOXSession?.request;
    const form = $("categoriaForm");
    const dialog = $("categoriaModal");
    const tbody = $("categoriasTableBody");
    const mensaje = $("mensajeCategorias");
    const guardar = $("btnGuardarCategoria");

    if (!api || !form || !dialog || !tbody) return;
    if (!(await window.BIOXSession.ready)) return;

    let categorias = [];
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
        const busqueda = $("buscarCategoria").value.trim().toLocaleLowerCase("es-SV");
        const filtro = $("filtroEstadoCategoria").value;
        const lista = categorias.filter(categoria => {
            const activa = categoria.activo === true;
            const coincideEstado = filtro === "todos" ||
                (filtro === "activas" && activa) ||
                (filtro === "inactivas" && !activa);
            const texto = `${categoria.nombre || ""} ${categoria.descripcion || ""}`
                .toLocaleLowerCase("es-SV");
            return coincideEstado && texto.includes(busqueda);
        });

        $("contadorCategorias").textContent =
            `${lista.length} ${lista.length === 1 ? "categoría" : "categorías"}`;

        if (!lista.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="empty-state">
                        ${categorias.length ? "No hay categorías que coincidan con la búsqueda." : "No hay categorías registradas."}
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = lista.map(categoria => {
            const id = escapar(categoria.categorias_id);
            const activa = categoria.activo === true;
            return `
                <tr>
                    <td><strong>${escapar(categoria.nombre)}</strong></td>
                    <td>${escapar(categoria.descripcion || "—")}</td>
                    <td>
                        <span class="badge ${activa ? "badge-active" : "badge-inactive"}">
                            ${activa ? "Activa" : "Inactiva"}
                        </span>
                    </td>
                    <td>
                        <div class="actions">
                            <button type="button" class="btn btn-secondary btn-small"
                                data-accion="editar" data-id="${id}">Editar</button>
                            ${activa ? `
                                <button type="button" class="btn btn-danger btn-small"
                                    data-accion="eliminar" data-id="${id}">Eliminar</button>` : ""}
                        </div>
                    </td>
                </tr>`;
        }).join("");
    }

    async function cargarCategorias() {
        tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Cargando categorías...</td></tr>';
        try {
            const resultado = await api(API);
            categorias = Array.isArray(resultado.data) ? resultado.data : [];
            actualizarTabla();
        } catch (error) {
            mostrarMensaje(error.message, "error");
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No se pudieron cargar las categorías.</td></tr>';
        }
    }

    function limpiarFormulario() {
        form.reset();
        $("categoriaId").value = "";
        $("categoriaActiva").checked = true;
        $("grupoEstadoCategoria").hidden = true;
        $("tituloCategoriaModal").textContent = "Añadir categoría";
        guardar.textContent = "Guardar categoría";
    }

    function abrirNueva() {
        limpiarFormulario();
        dialog.showModal();
        $("categoriaNombre").focus();
    }

    function abrirEdicion(id) {
        const categoria = categorias.find(item =>
            String(item.categorias_id) === String(id)
        );
        if (!categoria) return;

        limpiarFormulario();
        $("categoriaId").value = categoria.categorias_id;
        $("categoriaNombre").value = categoria.nombre || "";
        $("categoriaDescripcion").value = categoria.descripcion || "";
        $("categoriaActiva").checked = categoria.activo === true;
        $("grupoEstadoCategoria").hidden = false;
        $("tituloCategoriaModal").textContent = "Editar categoría";
        guardar.textContent = "Guardar cambios";
        dialog.showModal();
        $("categoriaNombre").focus();
    }

    async function guardarCategoria(evento) {
        evento.preventDefault();
        if (!form.reportValidity()) return;

        const id = $("categoriaId").value;
        const datos = {
            nombre: $("categoriaNombre").value.trim(),
            descripcion: $("categoriaDescripcion").value.trim() || null
        };
        if (id) datos.activo = $("categoriaActiva").checked;

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
            mostrarMensaje(editando ? "Categoría actualizada." : "Categoría creada.");
            await cargarCategorias();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        } finally {
            guardar.disabled = false;
            guardar.textContent = $("categoriaId").value
                ? "Guardar cambios"
                : "Guardar categoría";
        }
    }

    async function eliminarCategoria(id) {
        const categoria = categorias.find(item =>
            String(item.categorias_id) === String(id)
        );
        if (!categoria) return;

        if (!window.confirm(
            `¿Desactivar la categoría "${categoria.nombre}"? Los productos relacionados conservarán esta categoría.`
        )) return;

        try {
            const resultado = await api(`${API}/${encodeURIComponent(id)}`, {
                method: "DELETE"
            });
            mostrarMensaje(resultado.message || "Categoría desactivada.");
            await cargarCategorias();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }

    form.addEventListener("submit", guardarCategoria);
    $("btnNuevaCategoria").addEventListener("click", abrirNueva);
    $("btnCancelarCategoria").addEventListener("click", () => dialog.close());
    $("btnRecargarCategorias").addEventListener("click", cargarCategorias);
    $("buscarCategoria").addEventListener("input", actualizarTabla);
    $("filtroEstadoCategoria").addEventListener("change", actualizarTabla);

    tbody.addEventListener("click", evento => {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;
        if (boton.dataset.accion === "editar") {
            abrirEdicion(boton.dataset.id);
        } else if (boton.dataset.accion === "eliminar") {
            eliminarCategoria(boton.dataset.id);
        }
    });

    dialog.addEventListener("click", evento => {
        if (evento.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", limpiarFormulario);

    await cargarCategorias();
})();
