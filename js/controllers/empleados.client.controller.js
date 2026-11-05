"use strict";

(async () => {
    const $ = id => document.getElementById(id);
    const API = "/api/empleados";
    const api = window.BIOXSession.request;

    const ROLES = {
        administrador: "Administrador",
        barra: "Barra",
        bodega: "Bodega",
        pendiente: "Pendiente"
    };

    const form = $("empleadoForm");
    const idInput = $("empleadoId");
    const nombre = $("nombre");
    const telefono = $("telefono");
    const email = $("email");
    const role = $("role");
    const password = $("password");
    const nuevaPassword = $("nuevaPassword");
    const activo = $("activo");
    const btnGuardar = $("btnGuardar");
    const btnCancelar = $("btnCancelar");
    const tbody = $("empleadosTableBody");
    const mensaje = $("mensaje");

    let empleados = [];
    let temporizador;

    function mostrarMensaje(texto, tipo = "info") {
        mensaje.textContent = texto;
        mensaje.className = `message show ${tipo}`;

        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            mensaje.className = "message";
        }, 5000);
    }

    function escapar(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[c]);
    }

    function fecha(valor) {
        if (!valor || Number.isNaN(new Date(valor).getTime())) {
            return "—";
        }

        return new Date(valor).toLocaleDateString("es-SV");
    }

    function renderizarEmpleados() {
        const busqueda = $("buscarEmpleado").value.trim().toLowerCase();

        const lista = empleados.filter(e =>
            [e.nombre, e.email, e.telefono, e.role].some(valor =>
                String(valor || "").toLowerCase().includes(busqueda)
            )
        );

        $("contadorEmpleados").textContent =
            `${lista.length} ${lista.length === 1 ? "usuario" : "usuarios"}`;

        if (!lista.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        No se encontraron usuarios.
                    </td>
                </tr>`;
            return;
        }

        tbody.innerHTML = lista.map(e => {
            const id = escapar(e.usuarios_id);
            const habilitado = e.activo === true;

            return `
                <tr>
                    <td>
                        <span class="employee-name">${escapar(e.nombre)}</span>
                        <span class="secondary-text">${escapar(e.email)}</span>
                    </td>
                    <td>${escapar(e.telefono || "—")}</td>
                    <td>
                        <span class="badge badge-role">
                            ${escapar(ROLES[e.role] || e.role)}
                        </span>
                    </td>
                    <td>
                        <span class="badge ${habilitado ? "badge-active" : "badge-inactive"}">
                            ${habilitado ? "Activo" : "Inactivo"}
                        </span>
                    </td>
                    <td>${escapar(fecha(e.created_at))}</td>
                    <td>
                        <div class="actions">
                            <button class="btn btn-secondary btn-small"
                                data-accion="editar" data-id="${id}">
                                Editar
                            </button>
                            <button class="btn ${habilitado ? "btn-danger" : "btn-success"} btn-small"
                                data-accion="estado" data-id="${id}"
                                data-activo="${habilitado}">
                                ${habilitado ? "Desactivar" : "Activar"}
                            </button>
                            <button class="btn btn-secondary btn-small"
                                data-accion="contrasena" data-id="${id}">
                                Contraseña
                            </button>
                        </div>
                    </td>
                </tr>`;
        }).join("");
    }

    async function cargarEmpleados() {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="loading-state">Cargando usuarios...</td>
            </tr>`;

        try {
            const resultado = await api(API);
            empleados = Array.isArray(resultado.data) ? resultado.data : [];
            renderizarEmpleados();
        } catch (error) {
            mostrarMensaje(error.message, "error");
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        No se pudieron cargar los usuarios.
                    </td>
                </tr>`;
        }
    }

    function limpiarFormulario() {
        form.reset();
        idInput.value = "";
        activo.checked = true;
        role.value = "pendiente";
        password.required = true;

        $("grupoPassword").classList.remove("hidden");
        $("grupoNuevaPassword").classList.add("hidden");
        $("tituloFormulario").textContent = "Registrar empleado";
        btnGuardar.textContent = "Registrar empleado";
        btnCancelar.classList.add("hidden");
    }

    async function editarEmpleado(id) {
        try {
            const resultado = await api(`${API}/${encodeURIComponent(id)}`);
            const e = resultado.data;

            if (!e) throw new Error("Usuario no encontrado.");

            idInput.value = e.usuarios_id;
            nombre.value = e.nombre || "";
            telefono.value = e.telefono || "";
            email.value = e.email || "";
            role.value = e.role || "pendiente";
            activo.checked = e.activo === true;

            password.value = "";
            password.required = false;
            nuevaPassword.value = "";

            $("grupoPassword").classList.add("hidden");
            $("grupoNuevaPassword").classList.remove("hidden");
            $("tituloFormulario").textContent = "Editar empleado";
            btnGuardar.textContent = "Guardar cambios";
            btnCancelar.classList.remove("hidden");

            $("formularioCard").scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }

    async function guardarEmpleado(evento) {
        evento.preventDefault();

        const id = idInput.value;
        const editando = Boolean(id);

        if (!nombre.value.trim() || !email.value.trim()) {
            mostrarMensaje("El nombre y el correo son obligatorios.", "error");
            return;
        }

        if ((!editando && password.value.length < 8) ||
            (nuevaPassword.value && nuevaPassword.value.length < 8)) {
            mostrarMensaje(
                "La contraseña debe tener al menos 8 caracteres.",
                "error"
            );
            return;
        }

        const datos = {
            nombre: nombre.value.trim(),
            telefono: telefono.value.trim() || null,
            email: email.value.trim(),
            role: role.value,
            activo: activo.checked
        };

        if (!editando) datos.password = password.value;

        btnGuardar.disabled = true;
        btnGuardar.textContent = "Guardando...";

        try {
            await api(editando ? `${API}/${encodeURIComponent(id)}` : API, {
                method: editando ? "PUT" : "POST",
                body: JSON.stringify(datos)
            });

            if (editando && nuevaPassword.value) {
                await api(`${API}/${encodeURIComponent(id)}/contrasena`, {
                    method: "PATCH",
                    body: JSON.stringify({ password: nuevaPassword.value })
                });
            }

            mostrarMensaje(
                editando ? "Empleado actualizado." : "Empleado registrado.",
                "success"
            );

            limpiarFormulario();
            await cargarEmpleados();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        } finally {
            btnGuardar.disabled = false;
            btnGuardar.textContent = idInput.value
                ? "Guardar cambios"
                : "Registrar empleado";
        }
    }

    async function cambiarEstado(id, estadoActual) {
        const nuevoEstado = !estadoActual;

        if (!confirm(`¿Deseas ${nuevoEstado ? "activar" : "desactivar"} esta cuenta?`)) {
            return;
        }

        try {
            await api(`${API}/${encodeURIComponent(id)}/estado`, {
                method: "PATCH",
                body: JSON.stringify({ activo: nuevoEstado })
            });

            mostrarMensaje("Estado actualizado.", "success");
            await cargarEmpleados();
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }

    async function cambiarContrasena(id) {
        const password = prompt("Nueva contraseña (mínimo 8 caracteres):");

        if (password === null) return;

        if (password.length < 8) {
            mostrarMensaje(
                "La contraseña debe tener al menos 8 caracteres.",
                "error"
            );
            return;
        }

        if (!confirm("¿Confirmas el cambio de contraseña?")) return;

        try {
            await api(`${API}/${encodeURIComponent(id)}/contrasena`, {
                method: "PATCH",
                body: JSON.stringify({ password })
            });

            mostrarMensaje("Contraseña actualizada.", "success");
        } catch (error) {
            mostrarMensaje(error.message, "error");
        }
    }

    form.addEventListener("submit", guardarEmpleado);
    btnCancelar.addEventListener("click", limpiarFormulario);
    $("btnLimpiar").addEventListener("click", limpiarFormulario);
    $("btnRecargar").addEventListener("click", cargarEmpleados);
    $("buscarEmpleado").addEventListener("input", renderizarEmpleados);

    tbody.addEventListener("click", evento => {
        const boton = evento.target.closest("button[data-accion]");
        if (!boton) return;

        const { id, accion, activo } = boton.dataset;
        if (!id) return;

        if (accion === "editar") editarEmpleado(id);
        if (accion === "estado") cambiarEstado(id, activo === "true");
        if (accion === "contrasena") cambiarContrasena(id);
    });

    const usuario = await window.BIOXSession.ready;

    if (usuario && usuario.role === "administrador") {
        await cargarEmpleados();
    }
})();