"use strict";

(() => {
    const $ = selector => document.querySelector(selector);
    const form = $("#afluenciaForm");
    const tbody = $("#afluenciaTableBody");
    let cargando = false;
    let guardando = false;

    function escapar(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[caracter]);
    }

    function mostrarMensaje(mensaje, tipo = "info") {
        const elemento = $("#afluenciaMensaje");
        elemento.textContent = mensaje;

        if (!mensaje) {
            elemento.className = "message";
            return;
        }

        elemento.className = `message show ${tipo === "success" ? "success" : tipo === "error" ? "error" : ""}`.trim();
    }

    function formatoFechaHora(valor) {
        const fecha = new Date(valor);
        if (Number.isNaN(fecha.getTime())) return "Fecha no disponible";

        return new Intl.DateTimeFormat("es-SV", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "America/El_Salvador"
        }).format(fecha);
    }

    function actualizarResumen(resumen = {}) {
        $("#totalEntradas").textContent = Number(resumen.entradas || 0).toLocaleString("es-SV");
        $("#totalSalidas").textContent = Number(resumen.salidas || 0).toLocaleString("es-SV");
        $("#totalMovimientos").textContent = Number(resumen.movimientos || 0).toLocaleString("es-SV");
    }

    function renderizar(datos = []) {
        $("#contadorAfluencia").textContent = `${datos.length} ${datos.length === 1 ? "registro" : "registros"}`;

        if (!datos.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Todavía no hay movimientos registrados.</td></tr>';
            return;
        }

        tbody.innerHTML = datos.map(registro => {
            const entrada = registro.tipo_movimiento === "entrada";
            const tipo = entrada ? "Entrada" : "Salida";
            const clase = entrada ? "badge-success" : "badge-danger";

            return `
                <tr>
                    <td>${escapar(formatoFechaHora(registro.created_at))}</td>
                    <td><span class="badge ${clase}">${tipo}</span></td>
                    <td><strong>${Number(registro.cantidad || 0).toLocaleString("es-SV")}</strong></td>
                    <td>${escapar(registro.usuario_nombre || "Usuario eliminado")}</td>
                    <td>${escapar(registro.observacion || "—")}</td>
                </tr>
            `;
        }).join("");
    }

    async function cargar() {
        if (cargando) return;
        cargando = true;
        $("#btnActualizarAfluencia").disabled = true;

        try {
            const respuesta = await window.BIOXSession.request("/api/afluencia");
            actualizarResumen(respuesta.resumen);
            renderizar(Array.isArray(respuesta.datos) ? respuesta.datos : []);
        } catch (error) {
            mostrarMensaje(error.message || "No se pudo cargar afluencia.", "error");
            tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No se pudieron cargar los movimientos.</td></tr>';
        } finally {
            cargando = false;
            $("#btnActualizarAfluencia").disabled = false;
        }
    }

    form.addEventListener("submit", async evento => {
        evento.preventDefault();
        if (guardando) return;

        const boton = $("#btnRegistrarAfluencia");
        const datos = {
            tipo_movimiento: $("#tipoMovimiento").value,
            cantidad: Number($("#cantidadAfluencia").value),
            observacion: $("#observacionAfluencia").value.trim()
        };

        guardando = true;
        boton.disabled = true;
        boton.textContent = "Guardando...";
        mostrarMensaje("");

        try {
            const respuesta = await window.BIOXSession.request("/api/afluencia", {
                method: "POST",
                body: JSON.stringify(datos)
            });
            form.reset();
            $("#cantidadAfluencia").value = "1";
            mostrarMensaje(respuesta.mensaje || "Movimiento registrado.", "success");
            await cargar();
        } catch (error) {
            mostrarMensaje(error.message || "No se pudo registrar el movimiento.", "error");
        } finally {
            guardando = false;
            boton.disabled = false;
            boton.textContent = "Registrar movimiento";
        }
    });

    $("#btnActualizarAfluencia").addEventListener("click", cargar);

    document.addEventListener("DOMContentLoaded", async () => {
        const sesion = window.BIOXSession;
        if (!sesion) return;
        const usuario = await sesion.ready;
        if (usuario) await cargar();
    });
})();
