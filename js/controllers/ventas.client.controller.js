
"use strict";

(() => {
    const API = "/api/ventas";
    const CLAVE_BORRADOR = "BIOX_VENTAS_BORRADOR_V1";

    const estado = {
        productos: [],
        ventas: [],
        carrito: [],
        cargando: false,
        enviando: false
    };

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const escapar = valor => String(valor ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[c]);

    function dinero(valor) {
        return Number(valor || 0).toLocaleString("en-US", {
            style: "currency",
            currency: "USD"
        });
    }

    function numero(valor) {
        const resultado = Number(valor);
        return Number.isFinite(resultado) ? resultado : 0;
    }

    function obtenerArray(respuesta) {
        if (Array.isArray(respuesta)) return respuesta;

        for (const clave of ["datos", "data", "resultado", "items"]) {
            if (Array.isArray(respuesta?.[clave])) {
                return respuesta[clave];
            }
        }

        return [];
    }

    function obtenerObjeto(respuesta) {
        return respuesta?.datos ??
            respuesta?.data ??
            respuesta?.resultado ??
            respuesta ??
            {};
    }

    async function request(url, opciones = {}) {
        const sesion = window.BIOXSession;

        if (!sesion || typeof sesion.request !== "function") {
            throw new Error(
                "La sesión de BIOX no está disponible. Comprueba js/session.js."
            );
        }

        if (sesion.ready) {
            await sesion.ready;
        }

        return sesion.request(url, {
            ...opciones,
            cache: "no-store"
        });
    }

    function mostrarMensaje(mensaje, tipo = "info") {
        const elemento = $("#salesMessage");
        if (!elemento) return;

        elemento.textContent = mensaje;
        elemento.dataset.tipo = tipo;
    }

    async function alerta(mensaje, tipo = "success") {
        if (window.Swal) {
            await window.Swal.fire({
                icon: tipo,
                title: tipo === "success" ? "Operación completada" : "Aviso",
                text: mensaje,
                confirmButtonText: "Aceptar"
            });
        } else {
            window.alert(mensaje);
        }
    }

    async function confirmar(mensaje) {
        if (window.Swal) {
            const resultado = await window.Swal.fire({
                title: "Confirmar operación",
                text: mensaje,
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Continuar",
                cancelButtonText: "Cancelar"
            });

            return resultado.isConfirmed;
        }

        return window.confirm(mensaje);
    }

    function idProducto(producto) {
        return String(
            producto.productos_id ??
            producto.producto_id ??
            producto.id ??
            ""
        );
    }

    function nombreProducto(producto) {
        return producto.nombre ??
            producto.producto ??
            "Producto sin nombre";
    }

    function esPreparado(producto) {
        return producto.tipo === "trago_preparado";
    }

    function esBotella(productoId) {
        return estado.productos.some(producto =>
            idProducto(producto) === productoId &&
            producto.tipo === "botella"
        );
    }

    function pasoCantidad(productoId) {
        return esBotella(productoId) ? "1" : "0.001";
    }

    function minimoCantidad(productoId) {
        return esBotella(productoId) ? "1" : "0.001";
    }

    function validarCantidad(producto, cantidad) {
        if (!Number.isFinite(cantidad) || cantidad <= 0) {
            throw new Error("La cantidad debe ser mayor que cero.");
        }

        if (producto.tipo === "botella" && !Number.isInteger(cantidad)) {
            throw new Error(
                "La cantidad de botellas debe ser un número entero."
            );
        }

        if (Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 1e-8) {
            throw new Error(
                "La cantidad admite hasta tres decimales, según el inventario."
            );
        }
    }

    function productoDisponible(producto) {
        if (!producto.activo) return false;

        if (esPreparado(producto) && !producto.tiene_receta) {
            return false;
        }

        return true;
    }

    function obtenerProductoSeleccionado(selector) {
        const id = selector?.id === "productSelect"
            ? $("#selectedProductId")?.value
            : selector?.value;

        return estado.productos.find(
            producto => idProducto(producto) === String(id)
        );
    }

    function etiquetaProducto(producto) {
        return `${nombreProducto(producto)} — ${dinero(producto.precio)}`;
    }

    function normalizarBusqueda(valor) {
        return String(valor ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("es-SV")
            .trim();
    }

    function cerrarOpcionesProducto() {
        const input = $("#productSelect");
        const opciones = $("#productOptions");
        if (!input || !opciones) return;

        opciones.hidden = true;
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        input.dataset.activeIndex = "-1";
    }

    function renderizarOpcionesProducto(consulta = "") {
        const input = $("#productSelect");
        const opciones = $("#productOptions");
        if (!input || !opciones) return;

        const busqueda = normalizarBusqueda(consulta);
        const productos = estado.productos
            .filter(productoDisponible)
            .filter(producto =>
                normalizarBusqueda(etiquetaProducto(producto))
                    .includes(busqueda)
            );

        if (!productos.length) {
            opciones.innerHTML = `
                <div class="sales-combobox__empty" role="option" aria-disabled="true">
                    No hay productos que coincidan.
                </div>`;
        } else {
            opciones.innerHTML = productos.map((producto, indice) => `
                <button
                    type="button"
                    id="product-option-${indice}"
                    class="sales-combobox__option"
                    role="option"
                    aria-selected="false"
                    data-product-id="${escapar(idProducto(producto))}">
                    <span>${escapar(nombreProducto(producto))}</span>
                    <span class="sales-combobox__price">${escapar(dinero(producto.precio))}</span>
                    ${esPreparado(producto)
                        ? '<small>Se descuentan los ingredientes de su receta</small>'
                        : ""}
                </button>
            `).join("");
        }

        opciones.hidden = false;
        input.setAttribute("aria-expanded", "true");
        input.dataset.activeIndex = "-1";
        input.removeAttribute("aria-activedescendant");
    }

    function seleccionarProducto(id) {
        const producto = estado.productos.find(item =>
            idProducto(item) === String(id)
        );
        const input = $("#productSelect");
        const idSeleccionado = $("#selectedProductId");

        if (!producto || !productoDisponible(producto) || !input || !idSeleccionado) {
            return;
        }

        input.value = etiquetaProducto(producto);
        idSeleccionado.value = idProducto(producto);
        cerrarOpcionesProducto();

        const cantidad = $("#saleQuantity");
        if (cantidad) {
            cantidad.step = producto.tipo === "botella" ? "1" : "0.001";
            cantidad.min = producto.tipo === "botella" ? "1" : "0.001";
            if (producto.tipo === "botella" && Number(cantidad.value) < 1) {
                cantidad.value = "1";
            }
        }
    }

    function moverOpcionProducto(direccion) {
        const input = $("#productSelect");
        const opciones = $("#productOptions");
        if (!input || !opciones) return;

        if (opciones.hidden) {
            const haySeleccion = Boolean($("#selectedProductId")?.value);
            renderizarOpcionesProducto(haySeleccion ? "" : input.value);
        }

        const botones = Array.from(
            opciones.querySelectorAll("button[data-product-id]")
        );
        if (!botones.length) return;

        const actual = Number(input.dataset.activeIndex || -1);
        const siguiente = actual < 0
            ? (direccion > 0 ? 0 : botones.length - 1)
            : Math.max(0, Math.min(botones.length - 1, actual + direccion));

        botones.forEach((boton, indice) => {
            const activo = indice === siguiente;
            boton.setAttribute("aria-selected", String(activo));
            boton.classList.toggle("is-active", activo);
        });

        input.dataset.activeIndex = String(siguiente);
        input.setAttribute("aria-activedescendant", botones[siguiente].id);
        botones[siguiente].scrollIntoView({ block: "nearest" });
    }

    async function cargarProductos() {
        const respuesta = await request(`${API}/productos`);
        estado.productos = obtenerArray(respuesta);

        renderizarSelectores();
    }

    async function cargarVentas() {
        const parametros = new URLSearchParams();

        const desde = $("#salesDateFrom")?.value;
        const hasta = $("#salesDateTo")?.value;

        if (desde) parametros.set("desde", desde);
        if (hasta) parametros.set("hasta", hasta);

        const sufijo = parametros.toString()
            ? `?${parametros.toString()}`
            : "";

        const respuesta = await request(`${API}${sufijo}`);

        estado.ventas = obtenerArray(respuesta);
        renderizarVentas();
    }

    async function cargarTodo() {
        if (estado.cargando) return;

        estado.cargando = true;
        mostrarMensaje("Cargando ventas y productos...");

        try {
            await Promise.all([
                cargarProductos(),
                cargarVentas()
            ]);

            renderizarCarrito();
            mostrarMensaje("Información actualizada.", "success");
        } catch (error) {
            mostrarMensaje(
                `No se pudo cargar la información: ${error.message}`,
                "error"
            );
        } finally {
            estado.cargando = false;
        }
    }

    function renderizarSelectores() {
        const input = $("#productSelect");
        const idSeleccionado = $("#selectedProductId");
        if (!input || !idSeleccionado) return;

        const producto = estado.productos.find(item =>
            idProducto(item) === idSeleccionado.value &&
            productoDisponible(item)
        );

        if (producto) {
            input.value = etiquetaProducto(producto);
        } else {
            input.value = "";
            idSeleccionado.value = "";
        }

        if (!$("#productOptions").hidden) {
            renderizarOpcionesProducto(input.value);
        }
    }

    function agregarAlCarrito(producto, cantidad) {
        if (!producto) {
            throw new Error("Selecciona un producto.");
        }

        if (!productoDisponible(producto)) {
            throw new Error(
                "El producto está inactivo o no tiene una receta activa."
            );
        }

        validarCantidad(producto, cantidad);

        const id = idProducto(producto);
        const existente = estado.carrito.find(
            item => item.producto_id === id
        );

        if (existente) {
            existente.cantidad += cantidad;
        } else {
            estado.carrito.push({
                producto_id: id,
                nombre: nombreProducto(producto),
                precio: numero(producto.precio),
                cantidad
            });
        }

        renderizarCarrito();
    }

    function renderizarCarrito() {
        const cuerpo = $("#cartBody");
        if (!cuerpo) return;

        if (!estado.carrito.length) {
            cuerpo.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-message">
                        El carrito está vacío.
                    </td>
                </tr>
            `;

            $("#cartSubtotal").textContent = dinero(0);
            return;
        }

        cuerpo.innerHTML = estado.carrito.map((item, indice) => `
            <tr>
                <td>${escapar(item.nombre)}</td>
                <td>
                    <input
                        type="number"
                        min="${minimoCantidad(item.producto_id)}"
                        step="${pasoCantidad(item.producto_id)}"
                        value="${numero(item.cantidad)}"
                        data-cart-quantity="${indice}"
                        aria-label="Cantidad de ${escapar(item.nombre)}"
                        style="width:100px">
                </td>
                <td>${dinero(item.precio)}</td>
                <td>${dinero(item.precio * item.cantidad)}</td>
                <td>
                    <button
                        type="button"
                        class="btn-danger btn-icon"
                        data-remove-cart="${indice}"
                        aria-label="Eliminar ${escapar(item.nombre)}">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `).join("");

        const subtotal = estado.carrito.reduce(
            (suma, item) => suma + item.precio * item.cantidad,
            0
        );

        $("#cartSubtotal").textContent = dinero(subtotal);
    }

    function guardarBorrador() {
        try {
            const borrador = {
                productos: estado.carrito,
                metodo_pago: $("#paymentMethod")?.value || "efectivo",
                mesa_numero: $("#saleTableNumber")?.value || "",
                guardado_en: new Date().toISOString()
            };

            localStorage.setItem(
                CLAVE_BORRADOR,
                JSON.stringify(borrador)
            );

            mostrarMensaje(
                "Borrador guardado en este navegador. Aún no es una venta registrada.",
                "success"
            );
        } catch (error) {
            mostrarMensaje(
                `No se pudo guardar el borrador: ${error.message}`,
                "error"
            );
        }
    }

    async function recuperarBorrador() {
        try {
            const texto = localStorage.getItem(CLAVE_BORRADOR);
            if (!texto) return;

            const borrador = JSON.parse(texto);

            if (!Array.isArray(borrador.productos)) return;

            const recuperar = await confirmar(
                "Hay un borrador de venta guardado en este navegador. ¿Deseas recuperarlo?"
            );

            if (!recuperar) return;

            estado.carrito = borrador.productos
                .filter(item =>
                    estado.productos.some(
                        producto => idProducto(producto) === String(item.producto_id)
                    )
                )
                .map(item => ({
                    producto_id: String(item.producto_id),
                    nombre: String(item.nombre || ""),
                    precio: numero(item.precio),
                    cantidad: numero(item.cantidad)
                }))
                .filter(item => item.cantidad > 0);

            if ($("#paymentMethod")) {
                $("#paymentMethod").value =
                    borrador.metodo_pago || "efectivo";
            }

            if ($("#saleTableNumber")) {
                $("#saleTableNumber").value =
                    borrador.mesa_numero || "";
            }

            renderizarCarrito();
        } catch (error) {
            console.error("No se pudo recuperar el borrador:", error);
        }
    }

    async function finalizarVenta() {
        if (estado.enviando) return;

        if (!estado.carrito.length) {
            await alerta("Agrega al menos un producto al carrito.", "warning");
            return;
        }

        const mesa = $("#saleTableNumber")?.value.trim() || "";

        if (mesa && (!Number.isInteger(Number(mesa)) || Number(mesa) < 1)) {
            await alerta("El número de mesa debe ser un entero positivo.", "warning");
            return;
        }

        const aceptado = await confirmar(
            `Se registrará una venta por ${$("#cartSubtotal").textContent}. ¿Deseas continuar?`
        );

        if (!aceptado) return;

        estado.enviando = true;

        const boton = $("#btnFinalize");
        if (boton) {
            boton.disabled = true;
            boton.textContent = "Registrando...";
        }

        try {
            const payload = {
                metodo_pago: $("#paymentMethod").value,
                mesa_numero: mesa || null,
                productos: estado.carrito.map(item => ({
                    producto_id: item.producto_id,
                    cantidad: Number(item.cantidad)
                }))
            };

            const respuesta = await request(API, {
                method: "POST",
                body: JSON.stringify(payload)
            });

            const venta = obtenerObjeto(respuesta);

            estado.carrito = [];

            localStorage.removeItem(CLAVE_BORRADOR);

            renderizarCarrito();

            await cargarTodo();

            await alerta(
                `Venta registrada correctamente. Total: ${dinero(venta.total)}.`
            );
        } catch (error) {
            await alerta(
                `No se pudo finalizar la venta: ${error.message}`,
                "error"
            );
        } finally {
            estado.enviando = false;

            if (boton) {
                boton.disabled = false;
                boton.innerHTML =
                    '<i class="fa-solid fa-check"></i> Finalizar venta';
            }
        }
    }

    function fechaLegible(valor) {
        if (!valor) return "—";

        const fecha = new Date(valor);

        if (Number.isNaN(fecha.getTime())) return "—";

        return fecha.toLocaleString("es-SV");
    }

    function renderizarVentas() {
        const cuerpo = $("#salesBody");
        if (!cuerpo) return;

        const busqueda = ($("#salesSearch")?.value || "")
            .trim()
            .toLocaleLowerCase("es");

        const filtradas = estado.ventas.filter(venta => {
            const productos = Array.isArray(venta.productos)
                ? venta.productos
                : [];

            const texto = [
                venta.ventas_id,
                venta.usuario_nombre,
                venta.metodo_pago,
                ...productos.map(producto => producto.nombre)
            ].join(" ").toLocaleLowerCase("es");

            return texto.includes(busqueda);
        });

        if (!filtradas.length) {
            cuerpo.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-message">
                        No hay ventas que mostrar.
                    </td>
                </tr>
            `;
            return;
        }

        cuerpo.innerHTML = filtradas.map(venta => {
            const productos = Array.isArray(venta.productos)
                ? venta.productos
                : [];

            const resumen = productos.map(producto =>
                `${escapar(producto.nombre)} × ${numero(producto.cantidad)}`
            ).join(", ") || "Sin detalle";

            const anulada = venta.estado === "anulada";

            return `
                <tr>
                    <td>${escapar(String(venta.ventas_id).slice(0, 8))}</td>
                    <td>${resumen}</td>
                    <td>${dinero(venta.total)}</td>
                    <td>${escapar(venta.metodo_pago || "—")}</td>
                    <td>${escapar(venta.usuario_nombre || "—")}</td>
                    <td>${escapar(fechaLegible(venta.created_at))}</td>
                    <td>
                        <span class="sale-status ${anulada ? "cancelled" : ""}">
                            ${escapar(venta.estado || "—")}
                        </span>
                    </td>
                    <td>
                        <button
                            type="button"
                            class="btn-outline btn-icon"
                            data-sale-detail="${escapar(venta.ventas_id)}"
                            title="Ver detalle">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    async function verDetalleVenta(id) {
        try {
            const respuesta = await request(
                `${API}/${encodeURIComponent(id)}`
            );

            const venta = obtenerObjeto(respuesta);
            const detalles = Array.isArray(venta.detalles)
                ? venta.detalles
                : [];

            $("#saleDetailContent").innerHTML = `
                <p><strong>Número:</strong> ${escapar(venta.ventas_id)}</p>
                <p><strong>Usuario:</strong> ${escapar(venta.usuario_nombre || "—")}</p>
                <p><strong>Fecha:</strong> ${escapar(fechaLegible(venta.created_at))}</p>
                <p><strong>Método de pago:</strong> ${escapar(venta.metodo_pago || "—")}</p>
                <p><strong>Mesa:</strong> ${escapar(venta.mesa_numero || "—")}</p>

                <div class="table-responsive">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Cantidad</th>
                                <th>Precio</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${detalles.map(item => `
                                <tr>
                                    <td>${escapar(item.producto_nombre)}</td>
                                    <td>${numero(item.cantidad)}</td>
                                    <td>${dinero(item.precio_unitario)}</td>
                                    <td>${dinero(item.total_linea)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>

                <p><strong>Total: ${dinero(venta.total)}</strong></p>
            `;

            const dialogo = $("#saleDetailModal");

            if (dialogo.showModal) {
                dialogo.showModal();
            } else {
                dialogo.setAttribute("open", "");
            }
        } catch (error) {
            await alerta(
                `No se pudo cargar el detalle: ${error.message}`,
                "error"
            );
        }
    }

    function registrarEventos() {
        $("#btnReloadSales")?.addEventListener("click", cargarTodo);
        $("#btnFilterSales")?.addEventListener("click", cargarVentas);
        $("#salesSearch")?.addEventListener("input", renderizarVentas);

        $("#btnAddToCart")?.addEventListener("click", async () => {
            try {
                const producto = obtenerProductoSeleccionado($("#productSelect"));
                const cantidad = Number($("#saleQuantity").value);

                agregarAlCarrito(producto, cantidad);
                mostrarMensaje("Producto agregado al carrito.", "success");
            } catch (error) {
                await alerta(error.message, "warning");
            }
        });

        const productoInput = $("#productSelect");
        const productoOpciones = $("#productOptions");

        productoInput?.addEventListener("focus", () => {
            const haySeleccion = Boolean($("#selectedProductId")?.value);
            renderizarOpcionesProducto(haySeleccion ? "" : productoInput.value);
        });

        productoInput?.addEventListener("input", () => {
            $("#selectedProductId").value = "";
            renderizarOpcionesProducto(productoInput.value);
        });

        productoInput?.addEventListener("keydown", event => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                moverOpcionProducto(1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moverOpcionProducto(-1);
            } else if (event.key === "Enter" && productoOpciones && !productoOpciones.hidden) {
                const botones = Array.from(
                    productoOpciones.querySelectorAll("button[data-product-id]")
                );
                const indiceActivo = Number(productoInput.dataset.activeIndex || -1);
                const opcion = indiceActivo >= 0
                    ? botones[indiceActivo]
                    : botones[0];

                if (opcion) {
                    event.preventDefault();
                    seleccionarProducto(opcion.dataset.productId);
                }
            } else if (event.key === "Escape" && productoOpciones && !productoOpciones.hidden) {
                event.preventDefault();
                cerrarOpcionesProducto();
            }
        });

        productoOpciones?.addEventListener("mousedown", event => {
            if (event.target.closest("button[data-product-id]")) {
                event.preventDefault();
            }
        });

        productoOpciones?.addEventListener("click", event => {
            const opcion = event.target.closest("button[data-product-id]");
            if (opcion) seleccionarProducto(opcion.dataset.productId);
        });

        $("#btnClearCart")?.addEventListener("click", async () => {
            if (!estado.carrito.length) return;

            if (!await confirmar("¿Deseas vaciar el carrito?")) return;

            estado.carrito = [];
            renderizarCarrito();
            mostrarMensaje("Carrito vaciado.", "success");
        });

        $("#btnSaveDraft")?.addEventListener("click", guardarBorrador);
        $("#btnFinalize")?.addEventListener("click", finalizarVenta);

        document.addEventListener("click", event => {
            if (!event.target.closest(".sales-combobox")) {
                cerrarOpcionesProducto();
            }

            const quitar = event.target.closest("[data-remove-cart]");

            if (quitar) {
                estado.carrito.splice(
                    Number(quitar.dataset.removeCart),
                    1
                );
                renderizarCarrito();
                return;
            }

            const detalle = event.target.closest("[data-sale-detail]");

            if (detalle) {
                verDetalleVenta(detalle.dataset.saleDetail);
            }
        });

        document.addEventListener("change", event => {
            const campo = event.target.closest("[data-cart-quantity]");
            if (!campo) return;

            const indice = Number(campo.dataset.cartQuantity);
            const cantidad = Number(campo.value);
            const producto = estado.productos.find(item =>
                idProducto(item) === estado.carrito[indice]?.producto_id
            );

            try {
                validarCantidad(producto || {}, cantidad);
            } catch (error) {
                alerta(error.message, "warning");
                renderizarCarrito();
                return;
            }

            if (estado.carrito[indice]) {
                estado.carrito[indice].cantidad = cantidad;
                renderizarCarrito();
            }
        });

        document.querySelectorAll("[data-close-dialog]").forEach(boton => {
            boton.addEventListener("click", () => {
                boton.closest("dialog")?.close();
            });
        });
    }

    async function inicializar() {
        if (document.body.dataset.page !== "ventas") return;

        registrarEventos();

        try {
            if (window.BIOXSession?.ready) {
                await window.BIOXSession.ready;
            }

            await cargarTodo();
            await recuperarBorrador();
        } catch (error) {
            mostrarMensaje(
                `No se pudo inicializar el módulo: ${error.message}`,
                "error"
            );
        }
    }

    window.VentasClient = {
        cargarTodo,
        cargarProductos,
        cargarVentas,
        renderizarCarrito,
        renderizarVentas,
        finalizarVenta,
        estado
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", inicializar);
    } else {
        inicializar();
    }
})();
