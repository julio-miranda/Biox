(function () {
    "use strict";

    const API = "/api/inventario";

    const estado = {
        resumen: {},
        productos: [],
        categorias: [],
        proveedores: [],
        envases: [],
        recetas: [],
        cargando: false,
        guardando: false,
        productoEditando: null
    };

    const $ = (selector, root = document) =>
        root.querySelector(selector);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

    // ============================================================
    // PERMISOS
    // ============================================================

    function rolActual() {
        return String(window.BIOXSession?.usuario?.role || "")
            .trim()
            .toLowerCase();
    }

    function puedeGestionarProductos() {
        return ["administrador", "bodega"].includes(rolActual());
    }

    function puedeGestionarRecetas() {
        return rolActual() === "administrador";
    }

    function aplicarPermisosInterfaz() {
        $$("[data-inventory-write]").forEach(elemento => {
            const permiso = elemento.dataset.inventoryWrite;

            elemento.hidden = permiso === "recetas"
                ? !puedeGestionarRecetas()
                : !puedeGestionarProductos();
        });

        const celdaProductos = $("[data-inventory-products] td[colspan]");
        const celdaRecetas = $("[data-inventory-recipes] td[colspan]");

        if (celdaProductos) {
            celdaProductos.colSpan = puedeGestionarProductos() ? 8 : 7;
        }

        if (celdaRecetas) {
            celdaRecetas.colSpan = puedeGestionarRecetas() ? 6 : 5;
        }
    }

    // ============================================================
    // UTILIDADES
    // ============================================================

    function escapar(valor) {
        return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[caracter]);
    }

    function numero(valor, defecto = 0) {
        if (
            valor === null ||
            valor === undefined ||
            String(valor).trim() === ""
        ) {
            return defecto;
        }

        const resultado = Number(valor);

        return Number.isFinite(resultado) ? resultado : defecto;
    }

    function formatoNumero(valor) {
        return numero(valor).toLocaleString("es-SV", {
            maximumFractionDigits: 4
        });
    }

    function formatoDinero(valor) {
        return numero(valor).toLocaleString("en-US", {
            style: "currency",
            currency: "USD"
        });
    }

    function obtenerId(objeto, tipo) {
        if (!objeto) return "";

        const campos = {
            producto: ["productos_id", "producto_id", "id"],
            categoria: ["categorias_id", "categoria_id", "id"],
            receta: ["recetas_id", "receta_id", "id"],
            proveedor: ["proveedores_id", "proveedor_id", "id"],
            ingrediente: [
                "insumo_id",
                "producto_id",
                "productos_id",
                "id"
            ]
        };

        for (const campo of campos[tipo] || ["id"]) {
            if (objeto[campo] !== undefined && objeto[campo] !== null) {
                return String(objeto[campo]);
            }
        }

        return "";
    }

    function obtenerNombre(objeto) {
        return objeto?.nombre ??
            objeto?.producto ??
            objeto?.nombre_producto ??
            objeto?.razon_social_denominacion ??
            objeto?.razonSocialDenominacion ??
            objeto?.descripcion ??
            "Sin nombre";
    }

    function normalizarArray(respuesta) {
        if (Array.isArray(respuesta)) return respuesta;
        if (!respuesta || typeof respuesta !== "object") return [];

        for (const clave of [
            "datos",
            "data",
            "resultado",
            "productos",
            "categorias",
            "recetas",
            "proveedores",
            "envases",
            "items"
        ]) {
            if (Array.isArray(respuesta[clave])) {
                return respuesta[clave];
            }
        }

        for (const clave of ["datos", "data", "resultado"]) {
            const contenido = respuesta[clave];

            if (contenido && typeof contenido === "object") {
                const resultado = normalizarArray(contenido);

                if (resultado.length) return resultado;
            }
        }

        return [];
    }

    function normalizarObjeto(respuesta) {
        if (
            !respuesta ||
            typeof respuesta !== "object" ||
            Array.isArray(respuesta)
        ) {
            return {};
        }

        for (const clave of ["datos", "data", "resultado"]) {
            const contenido = respuesta[clave];

            if (
                contenido &&
                typeof contenido === "object" &&
                !Array.isArray(contenido)
            ) {
                return normalizarObjeto(contenido);
            }
        }

        return respuesta;
    }

    function productoActivo(producto) {
        return !(
            producto?.activo === false ||
            producto?.activo === 0 ||
            producto?.activo === "false" ||
            producto?.activo === "f"
        );
    }

    function recetaActiva(receta) {
        return !(
            receta?.activa === false ||
            receta?.activa === 0 ||
            receta?.activa === "false" ||
            receta?.activa === "f"
        );
    }

    function stockActual(producto) {
        return numero(
            producto?.stock_actual ??
            producto?.stock ??
            producto?.existencia
        );
    }

    function stockActualEnUnidades(producto) {
        if (String(producto?.tipo || "").toLowerCase() === "botella") {
            return numero(producto?.stock_actual_unidades);
        }

        return stockActual(producto);
    }

    function stockMinimo(producto) {
        if (String(producto?.tipo || "").toLowerCase() === "botella") {
            return numero(producto?.stock_minimo_unidades);
        }

        return numero(producto?.stock_minimo);
    }

    function esProductoInventariable(producto) {
        return ["insumo", "botella"].includes(
            String(producto?.tipo || "").toLowerCase()
        );
    }

    function esTragoPreparado(producto) {
        return String(producto?.tipo || "").toLowerCase() ===
            "trago_preparado";
    }

    function actualizarUnidadStockMinimo(formulario) {
        const tipo = String(
            formulario?.elements.namedItem("tipo")?.value || ""
        ).toLowerCase();

        const unidad = formulario?.elements.namedItem("unidad_medida")?.value;

        const etiqueta = formulario?.querySelector(
            "[data-stock-minimum-unit]"
        );

        if (etiqueta) {
            etiqueta.textContent = tipo === "botella"
                ? "botellas"
                : unidad || "unidad";
        }

        const control = formulario?.elements.namedItem("stock_minimo");

        if (control) {
            control.step = tipo === "botella" ? "1" : "any";
        }
    }

    // ============================================================
    // COMBOBOX
    // ============================================================

    const comboboxes = new Map();

    function normalizarTexto(texto) {
        return String(texto ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLocaleLowerCase("es")
            .trim();
    }

    function cerrarCombobox(combobox) {
        if (!combobox) return;

        combobox.lista.hidden = true;
        combobox.input.setAttribute("aria-expanded", "false");
        combobox.indiceActivo = -1;
    }

    function cerrarTodosLosComboboxes(excepto = null) {
        comboboxes.forEach(combobox => {
            if (combobox !== excepto) {
                cerrarCombobox(combobox);
            }
        });
    }

    function seleccionarOpcion(combobox, opcion) {
        if (!combobox || !opcion) return;

        combobox.hidden.value = opcion.value;
        combobox.input.value = opcion.label;
        combobox.seleccionado = opcion.value;

        cerrarCombobox(combobox);

        combobox.input.dispatchEvent(
            new Event("change", { bubbles: true })
        );
    }

    function renderizarOpcionesCombobox(combobox) {
        const busqueda = normalizarTexto(combobox.input.value);

        const opciones = combobox.opciones.filter(opcion =>
            normalizarTexto(opcion.label).includes(busqueda)
        );

        combobox.lista.innerHTML = "";

        if (!opciones.length) {
            const elemento = document.createElement("li");

            elemento.className = "combobox-empty";
            elemento.textContent = "No se encontraron resultados.";

            combobox.lista.appendChild(elemento);
            combobox.indiceActivo = -1;
            combobox.opcionesFiltradas = [];

            return;
        }

        opciones.forEach((opcion, indice) => {
            const elemento = document.createElement("li");
            const boton = document.createElement("button");

            boton.type = "button";
            boton.className = "combobox-option";
            boton.dataset.comboboxOption = "";
            boton.dataset.comboboxIndex = String(indice);
            boton.setAttribute("role", "option");
            boton.textContent = opcion.label;

            boton.setAttribute(
                "aria-selected",
                opcion.value === combobox.hidden.value
                    ? "true"
                    : "false"
            );

            elemento.appendChild(boton);
            combobox.lista.appendChild(elemento);
        });

        combobox.opcionesFiltradas = opciones;
    }

    function abrirCombobox(combobox) {
        if (!combobox || combobox.input.disabled) return;

        cerrarTodosLosComboboxes(combobox);

        renderizarOpcionesCombobox(combobox);

        combobox.lista.hidden = false;
        combobox.input.setAttribute("aria-expanded", "true");
    }

    function activarOpcionCombobox(combobox, indice) {
        const opciones = combobox.opcionesFiltradas || [];

        if (!opciones.length) return;

        const nuevoIndice = Math.max(
            0,
            Math.min(indice, opciones.length - 1)
        );

        combobox.indiceActivo = nuevoIndice;

        const botones = $$(
            "[data-combobox-option]",
            combobox.lista
        );

        botones.forEach((boton, posicion) => {
            const activo = posicion === nuevoIndice;

            boton.classList.toggle("is-active", activo);

            boton.setAttribute(
                "aria-selected",
                activo ? "true" : "false"
            );

            if (activo) {
                boton.scrollIntoView({
                    block: "nearest"
                });
            }
        });
    }

    function inicializarComboboxes() {
        $$("[data-combobox]").forEach(raiz => {
            const clave = raiz.dataset.combobox;

            if (comboboxes.has(clave)) return;

            const input = $("[data-combobox-input]", raiz);
            const hidden = $("[data-combobox-value]", raiz);
            const lista = $("[data-combobox-options]", raiz);

            if (!input || !hidden || !lista) {
                console.warn(
                    `El combobox "${clave}" no tiene todos los elementos requeridos.`
                );
                return;
            }

            const combobox = {
                clave,
                raiz,
                input,
                hidden,
                lista,
                opciones: [],
                opcionesFiltradas: [],
                indiceActivo: -1,
                seleccionado: hidden.value || ""
            };

            input.setAttribute("role", "combobox");
            input.setAttribute("aria-autocomplete", "list");
            input.setAttribute("aria-expanded", "false");

            lista.setAttribute("role", "listbox");
            lista.hidden = true;

            if (!input.id) {
                input.id = `combobox-${clave}`;
            }

            if (!lista.id) {
                lista.id = `combobox-list-${clave}`;
            }

            input.setAttribute("aria-controls", lista.id);

            input.addEventListener("focus", () => {
                abrirCombobox(combobox);
            });

            input.addEventListener("click", () => {
                abrirCombobox(combobox);
            });

            input.addEventListener("input", () => {
                const seleccion = combobox.opciones.find(
                    opcion => opcion.value === hidden.value
                );

                if (!seleccion || input.value !== seleccion.label) {
                    hidden.value = "";
                    combobox.seleccionado = "";
                }

                abrirCombobox(combobox);
            });

            input.addEventListener("keydown", event => {
                const abierto = !lista.hidden;
                const opciones = combobox.opcionesFiltradas || [];

                if (event.key === "ArrowDown") {
                    event.preventDefault();

                    if (!abierto) {
                        abrirCombobox(combobox);
                        return;
                    }

                    activarOpcionCombobox(
                        combobox,
                        combobox.indiceActivo + 1
                    );
                }

                if (event.key === "ArrowUp") {
                    event.preventDefault();

                    if (!abierto) {
                        abrirCombobox(combobox);
                        return;
                    }

                    activarOpcionCombobox(
                        combobox,
                        combobox.indiceActivo < 0
                            ? opciones.length - 1
                            : combobox.indiceActivo - 1
                    );
                }

                if (event.key === "Enter" && abierto) {
                    event.preventDefault();

                    const opcion = opciones[combobox.indiceActivo];

                    if (opcion) {
                        seleccionarOpcion(combobox, opcion);
                    } else if (opciones.length === 1) {
                        seleccionarOpcion(combobox, opciones[0]);
                    }
                }

                if (event.key === "Escape") {
                    cerrarCombobox(combobox);
                }
            });

            lista.addEventListener("mousedown", event => {
                event.preventDefault();
            });

            lista.addEventListener("click", event => {
                const boton = event.target.closest(
                    "[data-combobox-option]"
                );

                if (!boton) return;

                const indice = Number(boton.dataset.comboboxIndex);
                const opcion = combobox.opcionesFiltradas[indice];

                seleccionarOpcion(combobox, opcion);
            });

            comboboxes.set(clave, combobox);
        });
    }

    function configurarOpcionesCombobox(clave, opciones = []) {
        const combobox = comboboxes.get(clave);

        if (!combobox) return;

        combobox.opciones = opciones
            .filter(opcion =>
                opcion &&
                opcion.value !== undefined &&
                opcion.value !== null &&
                String(opcion.value).trim() !== ""
            )
            .map(opcion => ({
                value: String(opcion.value),
                label: String(opcion.label ?? "Sin nombre"),
                data: opcion.data ?? null
            }));

        const seleccion = combobox.opciones.find(
            opcion => opcion.value === combobox.hidden.value
        );

        if (seleccion) {
            combobox.input.value = seleccion.label;
            combobox.seleccionado = seleccion.value;
        } else {
            combobox.hidden.value = "";
            combobox.input.value = "";
            combobox.seleccionado = "";
        }

        if (!combobox.lista.hidden) {
            renderizarOpcionesCombobox(combobox);
        }
    }

    function limpiarCombobox(clave) {
        const combobox = comboboxes.get(clave);

        if (!combobox) return;

        combobox.input.value = "";
        combobox.hidden.value = "";
        combobox.seleccionado = "";

        cerrarCombobox(combobox);
    }

    function obtenerValorCombobox(clave) {
        const combobox = comboboxes.get(clave);

        if (!combobox) return "";

        const valor = combobox.hidden.value;

        const existe = combobox.opciones.some(
            opcion => opcion.value === valor
        );

        return existe ? valor : "";
    }

    document.addEventListener("click", event => {
        const objetivo = event.target instanceof Element
            ? event.target
            : event.target?.parentElement;

        if (!objetivo) return;

        comboboxes.forEach(combobox => {
            if (!combobox.raiz.contains(objetivo)) {
                cerrarCombobox(combobox);
            }
        });
    });

    // ============================================================
    // PETICIONES HTTP
    // ============================================================

    async function solicitar(ruta, opciones = {}) {
        const config = {
            method: opciones.method || "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(opciones.headers || {})
            }
        };

        if (opciones.body !== undefined) {
            config.headers["Content-Type"] = "application/json";
            config.body = JSON.stringify(opciones.body);
        }

        let respuesta;

        try {
            respuesta = await fetch(`${API}${ruta}`, config);
        } catch (error) {
            console.error("Error de conexión con inventario:", error);

            throw new Error(
                "No fue posible comunicarse con el servidor. Verifica la conexión e inténtalo nuevamente."
            );
        }

        let contenido = null;

        try {
            contenido = await respuesta.json();
        } catch (_) {
            contenido = null;
        }

        if (respuesta.status === 401) {
            throw new Error(
                "La sesión ha expirado. Inicia sesión nuevamente."
            );
        }

        if (respuesta.status === 403) {
            throw new Error(
                "No tienes permisos para realizar esta operación."
            );
        }

        if (
            !respuesta.ok ||
            contenido?.ok === false ||
            contenido?.success === false
        ) {
            throw new Error(
                contenido?.mensaje ||
                contenido?.message ||
                contenido?.error ||
                `No se pudo completar la operación (HTTP ${respuesta.status}).`
            );
        }

        return contenido;
    }

    // ============================================================
    // MENSAJES Y CONFIRMACIONES
    // ============================================================

    function mostrarMensaje(mensaje, tipo = "info") {
        const elemento = $("#mensaje");

        if (elemento) {
            elemento.textContent = mensaje;
            elemento.dataset.tipo = tipo;
            elemento.setAttribute("role", "status");
        }

        if (tipo === "error") {
            console.error(mensaje);
        }
    }

    async function notificar(mensaje, tipo = "success") {
        if (typeof Swal !== "undefined") {
            await Swal.fire({
                icon: tipo,
                title: tipo === "success"
                    ? "Operación completada"
                    : tipo === "error"
                        ? "No se pudo completar"
                        : "Aviso",
                text: mensaje,
                confirmButtonText: "Aceptar"
            });

            return;
        }

        window.alert(mensaje);
    }

    async function confirmar(mensaje) {
        if (typeof Swal !== "undefined") {
            const resultado = await Swal.fire({
                title: "¿Estás seguro?",
                text: mensaje,
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Sí, continuar",
                cancelButtonText: "Cancelar",
                reverseButtons: true
            });

            return resultado.isConfirmed;
        }

        return window.confirm(mensaje);
    }

    function mostrarEstadoTabla(cuerpo, columnas, mensaje) {
        if (!cuerpo) return;

        cuerpo.innerHTML = `
            <tr>
                <td colspan="${columnas}">
                    ${escapar(mensaje)}
                </td>
            </tr>
        `;
    }

    // ============================================================
    // RESUMEN
    // ============================================================

    function renderizarResumen() {
        const resumen = estado.resumen;
        const productosActivos = estado.productos.filter(productoActivo);

        const total = resumen.productos_activos ??
            resumen.total_productos ??
            resumen.totalProductos ??
            productosActivos.length;

        const valor = resumen.valor_inventario ??
            resumen.valor_total ??
            resumen.valorInventario ??
            productosActivos
                .filter(esProductoInventariable)
                .reduce(
                    (suma, producto) =>
                        suma +
                        stockActual(producto) *
                        numero(producto.costo_promedio),
                    0
                );

        if ($("#totalProductsCard")) {
            $("#totalProductsCard").textContent = formatoNumero(total);
        }

        if ($("#totalValueCard")) {
            $("#totalValueCard").textContent = formatoDinero(valor);
        }
    }

    // ============================================================
    // PRODUCTOS
    // ============================================================

    function renderizarProductos() {
        const cuerpo = $("[data-inventory-products]");

        if (!cuerpo) return;

        const busqueda = normalizarTexto($("#salesSearch")?.value || "");

        const productos = estado.productos.filter(producto => {
            const textoBusqueda = normalizarTexto([
                obtenerNombre(producto),
                producto.tipo,
                producto.categoria,
                producto.nombre_categoria
            ].join(" "));

            return textoBusqueda.includes(busqueda);
        });

        if (!productos.length) {
            mostrarEstadoTabla(
                cuerpo,
                puedeGestionarProductos() ? 8 : 7,
                estado.productos.length
                    ? "No hay productos que coincidan con la búsqueda."
                    : "No hay productos registrados."
            );

            return;
        }

        cuerpo.innerHTML = productos.map(producto => {
            const id = obtenerId(producto, "producto");
            const inventariable = esProductoInventariable(producto);
            const botella = String(producto.tipo || "").toLowerCase() ===
                "botella";

            const stock = stockActualEnUnidades(producto);
            const minimo = stockMinimo(producto);
            const bajo = inventariable && stock <= minimo;

            const detalleEnvases = botella
                ? `
                    <small class="inventory-stock-detail">
                        ${formatoNumero(producto.envases_cerrados)} cerradas ·
                        ${formatoNumero(producto.envases_abiertos)} abiertas
                    </small>
                `
                : "";

            const estadoStock = !inventariable
                ? "No aplica"
                : bajo
                    ? "Bajo"
                    : "Normal";

            const claseStock = !inventariable
                ? "status-na"
                : bajo
                    ? "status-low"
                    : "status-normal";

            const acciones = puedeGestionarProductos()
                ? `
                    <td>
                        <button
                            type="button"
                            class="action-button action-edit"
                            data-edit-product="${escapar(id)}"
                            aria-label="Editar ${escapar(obtenerNombre(producto))}">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </td>
                `
                : "";

            return `
                <tr>
                    <td>${escapar(obtenerNombre(producto))}</td>
                    <td>${escapar(producto.tipo || "—")}</td>
                    <td>
                        ${inventariable
                            ? `${formatoNumero(stock)}${detalleEnvases}`
                            : "—"}
                    </td>
                    <td>
                        ${escapar(botella
                            ? "botellas"
                            : producto.unidad_medida || "—")}
                    </td>
                    <td>${inventariable ? formatoNumero(minimo) : "—"}</td>
                    <td class="${claseStock}">${estadoStock}</td>
                    <td>${productoActivo(producto) ? "Activo" : "Inactivo"}</td>
                    ${acciones}
                </tr>
            `;
        }).join("");
    }

    // ============================================================
    // SELECTORES Y COMBOBOX
    // ============================================================

    function actualizarSelector(selector, elementos, texto, tipo) {
        if (!selector) return;

        const anterior = selector.value;

        selector.innerHTML = `
            <option value="">${escapar(texto)}</option>
        `;

        elementos.forEach(elemento => {
            const id = obtenerId(elemento, tipo);

            if (!id) return;

            const opcion = document.createElement("option");

            opcion.value = id;
            opcion.textContent = obtenerNombre(elemento);

            selector.appendChild(opcion);
        });

        if (
            Array.from(selector.options).some(
                opcion => opcion.value === anterior
            )
        ) {
            selector.value = anterior;
        }
    }

    function actualizarSelectores() {
        const categoriasActivas = estado.categorias.filter(categoria =>
            categoria.activo !== false &&
            categoria.activo !== 0
        );

        $$('[data-inventory-select="categoria"]').forEach(selector => {
            actualizarSelector(
                selector,
                categoriasActivas,
                "Selecciona una categoría",
                "categoria"
            );
        });

        configurarOpcionesCombobox(
            "producto-existente",
            estado.productos
                .filter(producto =>
                    esProductoInventariable(producto) &&
                    productoActivo(producto)
                )
                .map(producto => ({
                    value: obtenerId(producto, "producto"),
                    label: obtenerNombre(producto),
                    data: producto
                }))
        );

        configurarOpcionesCombobox(
            "proveedor-compra",
            estado.proveedores.map(proveedor => ({
                value: obtenerId(proveedor, "proveedor"),
                label: obtenerNombre(proveedor),
                data: proveedor
            }))
        );

        const ingredientes = estado.productos.filter(producto =>
            esProductoInventariable(producto) &&
            productoActivo(producto)
        );

        $$(".ingredient-product").forEach(selector => {
            const anterior = selector.value;

            selector.innerHTML = `
                <option value="">Selecciona un ingrediente</option>
            `;

            ingredientes.forEach(producto => {
                const opcion = document.createElement("option");

                opcion.value = obtenerId(producto, "producto");
                opcion.textContent = obtenerNombre(producto);

                selector.appendChild(opcion);
            });

            if (
                Array.from(selector.options).some(
                    opcion => opcion.value === anterior
                )
            ) {
                selector.value = anterior;
            }
        });
    }

    // ============================================================
    // CARGA DE DATOS
    // ============================================================

    async function cargarDatos() {
        if (estado.cargando) return;

        estado.cargando = true;
        mostrarMensaje("Cargando inventario...");

        try {
            const [
                resumen,
                productos,
                categorias,
                proveedores,
                recetas,
                envases
            ] = await Promise.all([
                solicitar("/resumen"),
                solicitar("/productos"),
                solicitar("/categorias"),
                solicitar("/proveedores"),
                solicitar("/recetas"),
                solicitar("/envases")
            ]);

            estado.resumen = normalizarObjeto(resumen);
            estado.productos = normalizarArray(productos);
            estado.categorias = normalizarArray(categorias);
            estado.proveedores = normalizarArray(proveedores);
            estado.recetas = normalizarArray(recetas);
            estado.envases = normalizarArray(envases);

            renderizarResumen();
            renderizarProductos();
            renderizarRecetas();
            actualizarSelectores();

            mostrarMensaje("Inventario actualizado.", "success");
        } catch (error) {
            mostrarMensaje(
                `No se pudo cargar el inventario: ${error.message}`,
                "error"
            );
        } finally {
            estado.cargando = false;
        }
    }

    // ============================================================
    // MODALES Y FORMULARIOS
    // ============================================================

    function abrirDialogo(dialogo) {
        if (!dialogo) return;

        if (typeof dialogo.showModal === "function") {
            if (!dialogo.open) dialogo.showModal();
        } else {
            dialogo.setAttribute("open", "");
        }
    }

    function cerrarFormulario(formulario) {
        const dialogo = formulario?.closest("dialog");

        if (!dialogo) return;

        if (
            dialogo.open &&
            typeof dialogo.close === "function"
        ) {
            dialogo.close();
        } else {
            dialogo.removeAttribute("open");
        }
    }

    function mostrarCampos(contenedor, visible) {
        if (!contenedor) return;

        contenedor.hidden = !visible;

        contenedor.querySelectorAll("input, select, textarea")
            .forEach(control => {
                control.disabled = !visible;
            });
    }

    // ============================================================
    // COMPRAS
    // ============================================================

    function productoSeleccionadoParaCompra(formulario, modo) {
        if (modo === "existente") {
            const id = obtenerValorCombobox("producto-existente");

            return estado.productos.find(producto =>
                obtenerId(producto, "producto") === id
            ) || null;
        }

        const tipo = formulario.elements.namedItem("tipo")?.value || "";
        const unidad =
            formulario.elements.namedItem("unidad_medida")?.value || "";

        return tipo
            ? {
                tipo,
                unidad_medida: unidad,
                stock_actual: 0
            }
            : null;
    }

    function actualizarResumenCompra() {
        const formulario = $('[data-inventory-form="producto"]');

        if (!formulario || estado.productoEditando) return;

        const modo =
            formulario.elements.namedItem("modo_producto")?.value || "nuevo";

        const producto = productoSeleccionadoParaCompra(formulario, modo);

        const cajas = Number(
            formulario.elements.namedItem("cajas")?.value
        );

        const unidadesPorCaja = Number(
            formulario.elements.namedItem("unidades_por_caja")?.value
        );

        const total = Number.isSafeInteger(cajas * unidadesPorCaja) &&
            Number.isInteger(cajas) &&
            cajas > 0 &&
            Number.isInteger(unidadesPorCaja) &&
            unidadesPorCaja > 0
            ? cajas * unidadesPorCaja
            : 0;

        const botella = producto?.tipo === "botella";

        const contenido = Number(
            formulario.elements.namedItem("contenido_inicial_ml")?.value
        );

        const totalControl = $("#productoTotalUnidades");
        const resumen = $("#productoCompraResumen");

        if (totalControl) {
            totalControl.value = formatoNumero(total) +
                (botella ? " botellas" : " unidades");
        }

        if (!resumen) return;

        if (!producto) {
            resumen.textContent = modo === "existente"
                ? "Selecciona el producto existente para consultar su stock."
                : "Indica las cajas y unidades por caja para calcular el total.";

            return;
        }

        const unidad = botella
            ? "ml"
            : producto.unidad_medida || "unidades";

        const stock = modo === "nuevo"
            ? 0
            : botella
                ? stockActualEnUnidades(producto)
                : stockActual(producto);

        const etiquetaStock = modo === "nuevo"
            ? "Existencia inicial"
            : "Stock actual";

        if (botella) {
            if (
                !total ||
                !Number.isFinite(contenido) ||
                contenido <= 0
            ) {
                resumen.textContent = etiquetaStock + ": " +
                    formatoNumero(stock) +
                    " botellas. Completa las cajas, las unidades por caja " +
                    "y los ml por botella para calcular la compra.";

                return;
            }

            const aumentoMl = total * contenido;

            resumen.textContent = etiquetaStock + ": " +
                formatoNumero(stock) +
                " botellas. Se agregarán " +
                formatoNumero(total) +
                " botellas (" +
                formatoNumero(aumentoMl) +
                " ml en total). Stock estimado después de guardar: " +
                formatoNumero(stock + total) +
                " botellas.";

            return;
        }

        if (!total) {
            resumen.textContent = etiquetaStock + ": " +
                formatoNumero(stock) +
                " " + unidad +
                ". Completa las cajas y las unidades por caja para calcular " +
                "la compra.";

            return;
        }

        resumen.textContent = etiquetaStock + ": " +
            formatoNumero(stock) +
            " " + unidad +
            ". Se agregarán " +
            formatoNumero(total) +
            " " + unidad +
            ". Stock estimado después de guardar: " +
            formatoNumero(stock + total) +
            " " + unidad + ".";
    }

    // ============================================================
    // AUTOLLENADO DEL PRODUCTO EXISTENTE
    // ============================================================

    function autollenarProductoExistente(
        formulario,
        producto,
        modoExistente
    ) {
        const detalle = $("#productoExistenteDetalle");

        const contenido = formulario.elements.namedItem(
            "contenido_inicial_ml"
        );

        if (!modoExistente || !producto) {
            if (detalle) detalle.hidden = true;

            if (modoExistente && contenido) {
                contenido.value = "";
            }

            return;
        }

        const categoria = estado.categorias.find(item =>
            obtenerId(item, "categoria") ===
            String(producto.categoria_id ?? "")
        );

        const botella = String(producto.tipo || "").toLowerCase() ===
            "botella";

        const stock = botella
            ? stockActualEnUnidades(producto)
            : stockActual(producto);

        const unidadStock = botella
            ? "botellas"
            : producto.unidad_medida || "unidades";

        const datos = {
            nombre: obtenerNombre(producto),
            categoria:
                categoria?.nombre ??
                producto.categoria ??
                producto.nombre_categoria ??
                "Sin categoría",
            tipo: producto.tipo ?? "—",
            unidad: producto.unidad_medida ?? "—",
            precio: formatoDinero(producto.precio),
            stock: `${formatoNumero(stock)} ${unidadStock}`
        };

        if (detalle) {
            Object.entries(datos).forEach(([campo, valor]) => {
                const destino = detalle.querySelector(
                    `[data-product-info="${campo}"]`
                );

                if (destino) {
                    destino.textContent = valor;
                }
            });

            detalle.hidden = false;
        }

        if (contenido) {
            contenido.value = botella
                ? String(producto.contenido_botella_ml ?? "")
                : "";
        }
    }

    // ============================================================
    // ACTUALIZAR FORMULARIO DE PRODUCTO
    // ============================================================

    function actualizarFormularioProducto() {
        const formulario = $('[data-inventory-form="producto"]');

        if (!formulario) return;

        const editando = Boolean(estado.productoEditando);

        const selectorModo =
            formulario.elements.namedItem("modo_producto");

        const modo = editando
            ? "editar"
            : selectorModo?.value || "nuevo";

        const creando = modo === "nuevo";
        const existente = modo === "existente";

        mostrarCampos(
            $("[data-product-mode-control]"),
            !editando
        );

        if (selectorModo) {
            selectorModo.disabled = editando;
        }

        $$("[data-product-new-field]").forEach(campo => {
            mostrarCampos(campo, creando || editando);
        });

        $$("[data-product-edit-field]").forEach(campo => {
            mostrarCampos(campo, editando);
        });

        mostrarCampos(
            $("[data-product-existing-field]"),
            existente && !editando
        );

        mostrarCampos(
            $("[data-product-entry]"),
            !editando
        );

        const selectorExistente =
            formulario.elements.namedItem("producto_existente_id");

        if (selectorExistente) {
            selectorExistente.required = false;
        }

        const busquedaProducto = $("#productoExistente");

        if (busquedaProducto) {
            busquedaProducto.required = existente && !editando;
        }

        const tipoControl = formulario.elements.namedItem("tipo");

        if (tipoControl) {
            Array.from(tipoControl.options).forEach(opcion => {
                opcion.disabled = !editando &&
                    !["insumo", "botella"].includes(opcion.value);
            });

            if (
                !editando &&
                !["insumo", "botella"].includes(tipoControl.value)
            ) {
                tipoControl.value = "insumo";
            }

            if (!editando && tipoControl.value === "botella") {
                const unidadControl =
                    formulario.elements.namedItem("unidad_medida");

                if (unidadControl) {
                    unidadControl.value = "ml";
                }
            }
        }

        const producto = editando
            ? estado.productos.find(item =>
                obtenerId(item, "producto") ===
                String(estado.productoEditando)
            )
            : productoSeleccionadoParaCompra(formulario, modo);

        autollenarProductoExistente(
            formulario,
            producto,
            existente && !editando
        );

        const botella = producto?.tipo === "botella";

        const contenidoCampos = $("#productoContenidoFields");

        const contenidoControl =
            formulario.elements.namedItem("contenido_inicial_ml");

        if (contenidoCampos) {
            contenidoCampos.hidden = !(!editando && botella);
        }

        if (contenidoControl) {
            contenidoControl.disabled = editando || !botella;
            contenidoControl.required = !editando && botella;
        }

        if (creando || editando) {
            actualizarUnidadStockMinimo(formulario);
        }

        const titulo = $("#productoModalTitle");

        if (titulo) {
            titulo.textContent = editando
                ? "Editar producto"
                : existente
                    ? "Agregar compra a producto existente"
                    : "Agregar producto nuevo";
        }

        const boton = formulario.querySelector('[type="submit"]');

        if (boton) {
            boton.textContent = editando
                ? "Guardar cambios"
                : existente
                    ? "Agregar compra"
                    : "Crear producto y agregar compra";
        }

        if (!editando) {
            actualizarResumenCompra();
        }
    }

    // ============================================================
    // CREAR Y EDITAR PRODUCTOS
    // ============================================================

    function nuevaProducto() {
        const formulario = $('[data-inventory-form="producto"]');

        if (!formulario) return;

        formulario.reset();

        const id = formulario.elements.namedItem("productos_id");

        if (id) id.value = "";

        const activo = formulario.elements.namedItem("activo");

        if (activo) activo.checked = true;

        estado.productoEditando = null;

        const modo = formulario.elements.namedItem("modo_producto");

        if (modo) modo.value = "nuevo";

        limpiarCombobox("producto-existente");
        limpiarCombobox("proveedor-compra");

        actualizarUnidadStockMinimo(formulario);
        actualizarSelectores();
        actualizarFormularioProducto();

        abrirDialogo($("#productoModal"));
    }

    function editarProducto(id) {
        const producto = estado.productos.find(item =>
            obtenerId(item, "producto") === String(id)
        );

        const formulario = $('[data-inventory-form="producto"]');

        if (!producto || !formulario) {
            mostrarMensaje("No se encontró el producto.", "error");
            return;
        }

        formulario.reset();

        limpiarCombobox("producto-existente");
        limpiarCombobox("proveedor-compra");

        const valores = {
            productos_id: obtenerId(producto, "producto"),
            nombre: producto.nombre ?? "",
            categoria_id: producto.categoria_id ?? "",
            tipo: producto.tipo ?? "insumo",
            unidad_medida: producto.unidad_medida ?? "unidad",
            precio: producto.precio ?? 0,
            costo_promedio: producto.costo_promedio ?? 0,
            stock_minimo: producto.stock_minimo_unidades ??
                producto.stock_minimo ?? 0
        };

        Object.entries(valores).forEach(([campo, valor]) => {
            const control = formulario.elements.namedItem(campo);

            if (control) {
                control.value = valor;
            }
        });

        actualizarUnidadStockMinimo(formulario);

        const activo = formulario.elements.namedItem("activo");

        if (activo) {
            activo.checked = productoActivo(producto);
        }

        estado.productoEditando = String(id);

        actualizarSelectores();
        actualizarFormularioProducto();

        abrirDialogo($("#productoModal"));
    }

    // ============================================================
    // DATOS Y VALIDACIÓN DE PRODUCTOS
    // ============================================================

    function datosProducto(formulario) {
        const datos = new FormData(formulario);

        const tipo = String(datos.get("tipo") || "").trim();

        const stockMinimoCapturado = Number(
            datos.get("stock_minimo") || 0
        );

        let stockMinimoAlmacenado = stockMinimoCapturado;

        if (tipo === "botella") {
            if (
                !Number.isSafeInteger(stockMinimoCapturado) ||
                stockMinimoCapturado < 0
            ) {
                throw new Error(
                    "El stock mínimo de botellas debe ser un número entero."
                );
            }

            const productoEditado = estado.productos.find(producto =>
                obtenerId(producto, "producto") ===
                String(estado.productoEditando)
            );

            const contenidoBotella = Number(
                productoEditado?.contenido_botella_ml ||
                datos.get("contenido_inicial_ml")
            );

            if (
                !Number.isFinite(contenidoBotella) ||
                contenidoBotella <= 0
            ) {
                throw new Error(
                    "No se pudo determinar el contenido de una botella para guardar el stock mínimo."
                );
            }

            stockMinimoAlmacenado =
                stockMinimoCapturado * contenidoBotella;
        }

        return {
            nombre: String(datos.get("nombre") || "").trim(),
            categoria_id: datos.get("categoria_id") || null,
            tipo,
            unidad_medida: String(
                datos.get("unidad_medida") || ""
            ).trim(),
            precio: Number(datos.get("precio")),
            costo_promedio: Number(
                datos.get("costo_promedio") || 0
            ),
            stock_minimo: stockMinimoAlmacenado,
            activo: datos.has("activo")
        };
    }

    function validarDatosProducto(datos, editando = false) {
        if (!datos.nombre) {
            throw new Error("El nombre del producto es obligatorio.");
        }

        if (!datos.tipo) {
            throw new Error("Selecciona el tipo de producto.");
        }

        if (!editando && !["insumo", "botella"].includes(datos.tipo)) {
            throw new Error(
                "Solo puedes crear productos de tipo insumo o botella desde este formulario. Los tragos preparados se crean desde la gestión de recetas."
            );
        }

        if (!datos.unidad_medida) {
            throw new Error("Selecciona la unidad de medida.");
        }

        if (
            datos.tipo === "botella" &&
            datos.unidad_medida !== "ml"
        ) {
            throw new Error(
                'Los productos de tipo botella deben utilizar la unidad "ml".'
            );
        }

        if (
            datos.tipo === "trago_preparado" &&
            datos.unidad_medida !== "unidad"
        ) {
            throw new Error(
                "Los tragos preparados deben utilizar la unidad unidad."
            );
        }

        for (const campo of [
            "precio",
            "costo_promedio",
            "stock_minimo"
        ]) {
            if (
                !Number.isFinite(datos[campo]) ||
                datos[campo] < 0
            ) {
                throw new Error(
                    `El valor de ${campo.replaceAll("_", " ")} no es válido.`
                );
            }
        }
    }

    // ============================================================
    // DATOS DE COMPRA
    // ============================================================

    function datosCompra(formulario, producto) {
        const datos = new FormData(formulario);

        const proveedorId = obtenerValorCombobox("proveedor-compra");

        const cajas = Number(datos.get("cajas"));
        const unidadesPorCaja = Number(
            datos.get("unidades_por_caja")
        );

        const costoPorCaja = Number(
            datos.get("costo_por_caja")
        );

        if (!proveedorId) {
            throw new Error("Selecciona el proveedor de la compra.");
        }

        if (
            !Number.isInteger(cajas) ||
            cajas < 1 ||
            !Number.isInteger(unidadesPorCaja) ||
            unidadesPorCaja < 1 ||
            !Number.isSafeInteger(cajas * unidadesPorCaja) ||
            cajas * unidadesPorCaja > 999999999
        ) {
            throw new Error(
                "Las cajas y unidades por caja deben ser números enteros positivos."
            );
        }

        if (
            String(datos.get("costo_por_caja") || "").trim() === "" ||
            !Number.isFinite(costoPorCaja) ||
            costoPorCaja < 0
        ) {
            throw new Error("Indica un costo por caja válido.");
        }

        const compra = {
            proveedor_id: proveedorId,
            cajas,
            unidades_por_caja: unidadesPorCaja,
            costo_por_caja: costoPorCaja,
            observacion: String(
                datos.get("observacion") || ""
            ).trim()
        };

        if (producto.tipo === "botella") {
            const contenido = Number(
                datos.get("contenido_inicial_ml")
            );

            if (!Number.isFinite(contenido) || contenido <= 0) {
                throw new Error(
                    "Indica el contenido inicial en ml de cada botella."
                );
            }

            compra.contenido_inicial_ml = contenido;
        }

        return compra;
    }

    // ============================================================
    // GUARDAR PRODUCTO
    // ============================================================

    async function guardarProducto(formulario) {
        const id = String(
            formulario.elements.namedItem("productos_id")?.value || ""
        ).trim();

        const modo =
            formulario.elements.namedItem("modo_producto")?.value || "nuevo";

        let mensaje;

        if (id) {
            const datos = datosProducto(formulario);

            validarDatosProducto(datos, true);

            const { activo, ...datosProductoAPI } = datos;

            await solicitar(
                `/productos/${encodeURIComponent(id)}`,
                {
                    method: "PUT",
                    body: datosProductoAPI
                }
            );

            const anterior = estado.productos.find(producto =>
                obtenerId(producto, "producto") === id
            );

            if (
                anterior &&
                productoActivo(anterior) !== activo
            ) {
                await solicitar(
                    `/productos/${encodeURIComponent(id)}/estado`,
                    {
                        method: "PATCH",
                        body: { activo }
                    }
                );
            }

            mensaje = "Producto actualizado.";
        } else if (modo === "existente") {
            const productoId = obtenerValorCombobox("producto-existente");

            const producto = estado.productos.find(item =>
                obtenerId(item, "producto") === productoId
            );

            if (
                !producto ||
                !productoActivo(producto) ||
                !esProductoInventariable(producto)
            ) {
                throw new Error(
                    "Selecciona un producto inventariable activo."
                );
            }

            await solicitar("/movimientos", {
                method: "POST",
                body: {
                    producto_id: productoId,
                    tipo: "entrada",
                    ...datosCompra(formulario, producto)
                }
            });

            mensaje = "Compra agregada al producto existente.";
        } else {
            const datos = datosProducto(formulario);

            validarDatosProducto(datos, false);

            if (!esProductoInventariable(datos)) {
                throw new Error(
                    "Solo puedes crear insumos o botellas desde este formulario."
                );
            }

            const datosProductoAPI = {
                nombre: datos.nombre,
                categoria_id: datos.categoria_id,
                tipo: datos.tipo,
                unidad_medida: datos.unidad_medida,
                precio: datos.precio,
                stock_minimo: datos.stock_minimo
            };

            const compra = datosCompra(formulario, datos);

            await solicitar("/productos/con-entrada", {
                method: "POST",
                body: {
                    ...datosProductoAPI,
                    ...compra
                }
            });

            mensaje = "Producto creado con su compra inicial.";
        }

        cerrarFormulario(formulario);

        await cargarDatos();
        await notificar(mensaje);
    }

    // ============================================================
    // RECETAS: UTILIDADES
    // ============================================================

    function ingredientesDe(receta) {
        const ingredientes = receta?.ingredientes ??
            receta?.detalles ??
            receta?.receta_detalle ??
            [];

        return Array.isArray(ingredientes) ? ingredientes : [];
    }

    function productoDeReceta(receta) {
        const id = String(
            receta?.producto_id ??
            receta?.productos_id ??
            ""
        );

        const producto = estado.productos.find(item =>
            obtenerId(item, "producto") === id
        );

        return receta?.producto_nombre ??
            receta?.nombre_producto ??
            (
                typeof receta?.producto === "string"
                    ? receta.producto
                    : null
            ) ??
            (producto ? obtenerNombre(producto) : "Sin producto");
    }

    function estimarConsumoReceta(ingredientes = []) {
        const lineas = ingredientes.map(ingrediente => {
            const ingredienteId = String(
                ingrediente.insumo_id ??
                ingrediente.producto_id ??
                ingrediente.productos_id ??
                ""
            );

            const producto = estado.productos.find(item =>
                obtenerId(item, "producto") === ingredienteId
            );

            const cantidad = Number(ingrediente.cantidad);

            if (!Number.isFinite(cantidad) || cantidad <= 0) {
                return null;
            }

            const tamanosEnvase = producto?.tipo === "botella"
                ? estado.envases
                    .filter(envase =>
                        String(envase.producto_id) === ingredienteId &&
                        Number(envase.contenido_inicial_ml) > 0
                    )
                    .map(envase => Number(envase.contenido_inicial_ml))
                : [];

            const envaseMinimo = tamanosEnvase.length
                ? Math.min(...tamanosEnvase)
                : null;

            return {
                nombre: ingrediente.nombre ??
                    ingrediente.insumo_nombre ??
                    ingrediente.producto_nombre ??
                    (producto ? obtenerNombre(producto) : "Ingrediente"),
                consumo: Math.round(cantidad * 1000) / 1000,
                unidad: ingrediente.unidad_medida ??
                    producto?.unidad_medida ??
                    "",
                consumeEnvaseCompleto: envaseMinimo !== null &&
                    cantidad >= envaseMinimo - 0.001
            };
        }).filter(Boolean);

        const advertencia = lineas.some(linea =>
            linea.consumeEnvaseCompleto
        );

        return {
            lineas,
            advertencia,
            mensaje: advertencia
                ? "La receta consume al menos un envase completo por unidad vendida. Revisa la cantidad del ingrediente."
                : ""
        };
    }

    function actualizarPreviewConsumoReceta() {
        const formulario = $('[data-inventory-form="receta"]');
        const preview = $("[data-recipe-consumption-preview]");

        if (!formulario || !preview) return;

        const ingredientes = $$(
            "[data-ingredient-row]",
            formulario
        ).map(fila => ({
            insumo_id: fila.querySelector(".ingredient-product")?.value,
            cantidad: fila.querySelector(".ingredient-quantity")?.value
        }));

        if (!ingredientes.some(item =>
            item.insumo_id && item.cantidad
        )) {
            preview.classList.remove("is-warning");

            preview.textContent =
                "Completa la receta para ver el consumo por unidad vendida.";

            return;
        }

        const estimado = estimarConsumoReceta(ingredientes);

        if (!estimado.lineas.length) {
            preview.classList.remove("is-warning");
            preview.textContent = "Ingresa cantidades válidas.";

            return;
        }

        const cantidades = estimado.lineas.map(linea =>
            linea.nombre + ": " +
            formatoNumero(linea.consumo) + " " +
            linea.unidad
        );

        preview.classList.toggle(
            "is-warning",
            estimado.advertencia
        );

        preview.textContent =
            "Por cada unidad vendida: " +
            cantidades.join("; ") +
            "." +
            (estimado.advertencia
                ? " " + estimado.mensaje
                : "");
    }

    // ============================================================
    // RENDERIZAR RECETAS
    // ============================================================

    function renderizarRecetas() {
        const cuerpo = $("[data-inventory-recipes]");

        if (!cuerpo) return;

        if (!estado.recetas.length) {
            mostrarEstadoTabla(
                cuerpo,
                puedeGestionarRecetas() ? 6 : 5,
                "No hay recetas registradas."
            );

            return;
        }

        cuerpo.innerHTML = estado.recetas.map(receta => {
            const id = obtenerId(receta, "receta");
            const ingredientes = ingredientesDe(receta);
            const activa = recetaActiva(receta);

            const consumo = estimarConsumoReceta(ingredientes);

            const claseConsumo = consumo.advertencia
                ? " is-warning"
                : "";

            const acciones = puedeGestionarRecetas()
                ? `
                    <td>
                        <button
                            type="button"
                            class="action-button action-edit"
                            data-edit-recipe="${escapar(id)}"
                            aria-label="Editar receta">
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        ${activa ? `
                            <button
                                type="button"
                                class="action-button action-delete"
                                data-delete-recipe="${escapar(id)}"
                                aria-label="Desactivar receta">
                                <i class="fa-solid fa-ban"></i>
                            </button>
                        ` : ""}
                    </td>
                `
                : "";

            return `
                <tr>
                    <td>${escapar(productoDeReceta(receta))}</td>
                    <td>${escapar(receta.descripcion || "—")}</td>

                    <td>
                        ${
                            ingredientes.length
                                ? ingredientes.map(ingrediente => {
                                    const ingredienteId = String(
                                        ingrediente.insumo_id ??
                                        ingrediente.producto_id ??
                                        ingrediente.productos_id ??
                                        ""
                                    );

                                    const producto = estado.productos.find(
                                        item =>
                                            obtenerId(item, "producto") ===
                                            ingredienteId
                                    );

                                    const nombre = ingrediente.nombre ??
                                        ingrediente.insumo_nombre ??
                                        ingrediente.producto_nombre ??
                                        (
                                            producto
                                                ? obtenerNombre(producto)
                                                : "Ingrediente"
                                        );

                                    const unidad =
                                        ingrediente.unidad_medida ??
                                        producto?.unidad_medida ??
                                        "";

                                    return `
                                        <div>
                                            ${escapar(nombre)}:
                                            ${formatoNumero(ingrediente.cantidad)}
                                            ${escapar(unidad)}
                                        </div>
                                    `;
                                }).join("")
                                : "Sin detalle de ingredientes"
                        }
                    </td>

                    <td class="recipe-consumption${claseConsumo}">
                        ${
                            consumo.lineas.length
                                ? consumo.lineas.map(linea =>
                                    escapar(linea.nombre) + ": " +
                                    formatoNumero(linea.consumo) + " " +
                                    escapar(linea.unidad)
                                ).join("<br>")
                                : "Sin consumo calculable"
                        }

                        ${
                            consumo.advertencia
                                ? "<small>" +
                                    escapar(consumo.mensaje) +
                                    "</small>"
                                : ""
                        }
                    </td>

                    <td>${activa ? "Activa" : "Inactiva"}</td>
                    ${acciones}
                </tr>
            `;
        }).join("");
    }

    // ============================================================
    // INGREDIENTES DEL FORMULARIO
    // ============================================================

    function crearFilaIngrediente(datos = {}) {
        const contenedor = $("[data-inventory-ingredients]");

        if (!contenedor) return;

        const fila = document.createElement("div");

        fila.className = "ingredient-row";
        fila.dataset.ingredientRow = "";

        fila.innerHTML = `
            <div class="form-group">
                <label>Ingrediente</label>

                <select class="ingredient-product" required>
                    <option value="">Selecciona un ingrediente</option>
                </select>
            </div>

            <div class="form-group">
                <label>Cantidad</label>

                <input
                    class="ingredient-quantity"
                    type="number"
                    min="0.000001"
                    step="any"
                    required>
            </div>

            <button
                type="button"
                class="ingredient-remove"
                data-remove-ingredient
                aria-label="Quitar ingrediente">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        contenedor.appendChild(fila);

        actualizarSelectores();

        fila.querySelector(".ingredient-product").value = String(
            datos.insumo_id ??
            datos.producto_id ??
            datos.productos_id ??
            ""
        );

        fila.querySelector(".ingredient-quantity").value =
            datos.cantidad ?? "";

        actualizarPreviewConsumoReceta();
    }

    function recopilarIngredientes() {
        const filas = $$("[data-ingredient-row]");

        if (!filas.length) {
            throw new Error("Agrega al menos un ingrediente.");
        }

        const ids = new Set();

        return filas.map((fila, indice) => {
            const insumo_id =
                fila.querySelector(".ingredient-product")?.value || "";

            const cantidad = Number(
                fila.querySelector(".ingredient-quantity")?.value
            );

            if (!insumo_id) {
                throw new Error(
                    `Selecciona el ingrediente ${indice + 1}.`
                );
            }

            if (ids.has(insumo_id)) {
                throw new Error(
                    "No repitas ingredientes en la receta. Suma sus cantidades."
                );
            }

            if (!Number.isFinite(cantidad) || cantidad <= 0) {
                throw new Error(
                    `La cantidad del ingrediente ${indice + 1} debe ser mayor que cero.`
                );
            }

            const producto = estado.productos.find(item =>
                obtenerId(item, "producto") === insumo_id
            );

            if (!producto || !productoActivo(producto)) {
                throw new Error(
                    `El ingrediente ${indice + 1} no existe o está inactivo.`
                );
            }

            if (!esProductoInventariable(producto)) {
                throw new Error(
                    `"${obtenerNombre(producto)}" no puede utilizarse como ingrediente.`
                );
            }

            if (
                producto.tipo === "botella" &&
                producto.unidad_medida !== "ml"
            ) {
                throw new Error(
                    `La botella "${obtenerNombre(producto)}" debe utilizar mililitros.`
                );
            }

            ids.add(insumo_id);

            return {
                insumo_id,
                cantidad
            };
        });
    }

    // ============================================================
    // CREAR RECETA
    // ============================================================

    function nuevaReceta() {
        const formulario = $('[data-inventory-form="receta"]');

        if (!formulario) return;

        formulario.reset();

        const id = formulario.elements.namedItem("recetas_id");

        if (id) id.value = "";

        const activa = formulario.elements.namedItem("activa");

        if (activa) {
            activa.checked = true;
            activa.disabled = true;
        }

        const contenedor = $("[data-inventory-ingredients]");

        if (contenedor) {
            contenedor.innerHTML = "";
        }

        if ($("#recetaModalTitle")) {
            $("#recetaModalTitle").textContent =
                "Crear trago preparado";
        }

        const boton = formulario.querySelector('[type="submit"]');

        if (boton) {
            boton.textContent = "Crear trago y guardar receta";
        }

        actualizarSelectores();
        crearFilaIngrediente();

        abrirDialogo($("#recetaModal"));
    }

    // ============================================================
    // EDITAR RECETA
    // ============================================================

    async function editarReceta(id) {
        let receta = estado.recetas.find(item =>
            obtenerId(item, "receta") === String(id)
        );

        if (!receta) {
            mostrarMensaje("No se encontró la receta.", "error");
            return;
        }

        let ingredientes = ingredientesDe(receta);

        if (!ingredientes.length) {
            try {
                const detalle = normalizarObjeto(
                    await solicitar(
                        `/recetas/${encodeURIComponent(id)}`
                    )
                );

                receta = {
                    ...receta,
                    ...detalle
                };

                ingredientes = ingredientesDe(receta);
            } catch (error) {
                mostrarMensaje(
                    `No se pudo cargar el detalle de la receta: ${error.message}`,
                    "error"
                );

                return;
            }
        }

        const formulario = $('[data-inventory-form="receta"]');

        if (!formulario) return;

        formulario.reset();

        const valores = {
            recetas_id: obtenerId(receta, "receta"),
            descripcion: receta.descripcion ?? ""
        };

        Object.entries(valores).forEach(([campo, valor]) => {
            const control = formulario.elements.namedItem(campo);

            if (control) {
                control.value = valor;
            }
        });

        const activa = formulario.elements.namedItem("activa");

        if (activa) {
            activa.checked = recetaActiva(receta);
            activa.disabled = true;
        }

        const contenedor = $("[data-inventory-ingredients]");

        if (contenedor) {
            contenedor.innerHTML = "";
        }

        if ($("#recetaModalTitle")) {
            $("#recetaModalTitle").textContent = "Editar receta";
        }

        const boton = formulario.querySelector('[type="submit"]');

        if (boton) {
            boton.textContent = "Guardar cambios";
        }

        actualizarSelectores();

        if (ingredientes.length) {
            ingredientes.forEach(ingrediente =>
                crearFilaIngrediente(ingrediente)
            );
        } else {
            crearFilaIngrediente();
        }

        abrirDialogo($("#recetaModal"));
    }

    // ============================================================
    // GUARDAR RECETA
    // ============================================================

    async function guardarReceta(formulario) {
        const id = String(
            formulario.elements.namedItem("recetas_id")?.value || ""
        ).trim();

        const f = new FormData(formulario);

        const descripcion = String(
            f.get("descripcion") || ""
        ).trim();

        let producto_id = "";

        if (id) {
            const recetaExistente = estado.recetas.find(item =>
                obtenerId(item, "receta") === id
            );

            producto_id = String(
                recetaExistente?.producto_id ??
                recetaExistente?.productos_id ??
                ""
            ).trim();

            if (!producto_id) {
                const detalle = normalizarObjeto(
                    await solicitar(
                        `/recetas/${encodeURIComponent(id)}`
                    )
                );

                producto_id = String(
                    detalle.producto_id ??
                    detalle.productos_id ??
                    ""
                ).trim();
            }

            if (!producto_id) {
                throw new Error(
                    "No se pudo identificar el trago preparado asociado a esta receta."
                );
            }

            const producto = estado.productos.find(item =>
                obtenerId(item, "producto") === producto_id
            );

            if (!producto || !esTragoPreparado(producto)) {
                throw new Error(
                    "La receta no está asociada a un trago preparado válido."
                );
            }

            if (!productoActivo(producto)) {
                throw new Error(
                    "No se puede guardar una receta para un trago preparado inactivo."
                );
            }
        } else {
            const nombre = String(
                f.get("producto_nuevo_nombre") || ""
            ).trim();

            const categoriaId = String(
                f.get("producto_nuevo_categoria_id") || ""
            ).trim();

            const precioValor = String(
                f.get("producto_nuevo_precio") ?? ""
            ).trim();

            const precio = Number(precioValor);

            if (!nombre || nombre.length > 150) {
                throw new Error(
                    "El nombre del trago preparado es obligatorio y admite hasta 150 caracteres."
                );
            }

            const categoria = estado.categorias.find(item =>
                obtenerId(item, "categoria") === categoriaId
            );

            if (
                !categoria ||
                categoria.activo === false ||
                categoria.activo === 0
            ) {
                throw new Error("Selecciona una categoría activa.");
            }

            if (
                !precioValor ||
                !Number.isFinite(precio) ||
                precio < 0
            ) {
                throw new Error("Ingresa un precio de venta válido.");
            }
        }

        const ingredientes = recopilarIngredientes();

        const payload = {
            descripcion,
            ingredientes
        };

        if (id) {
            payload.producto_id = producto_id;
        } else {
            payload.producto_nuevo = {
                nombre: String(
                    f.get("producto_nuevo_nombre")
                ).trim(),
                categoria_id: String(
                    f.get("producto_nuevo_categoria_id")
                ).trim(),
                precio: Number(
                    f.get("producto_nuevo_precio")
                )
            };
        }

        await solicitar(
            id
                ? `/recetas/${encodeURIComponent(id)}`
                : "/recetas",
            {
                method: id ? "PUT" : "POST",
                body: payload
            }
        );

        cerrarFormulario(formulario);

        await cargarDatos();

        await notificar(
            id
                ? "Receta actualizada."
                : "Trago preparado y receta creados correctamente."
        );
    }

    // ============================================================
    // DESACTIVAR RECETA
    // ============================================================

    async function eliminarReceta(id) {
        const receta = estado.recetas.find(item =>
            obtenerId(item, "receta") === String(id)
        );

        if (!receta) {
            throw new Error("No se encontró la receta.");
        }

        if (!recetaActiva(receta)) {
            await notificar("La receta ya está desactivada.", "info");
            return;
        }

        const aceptado = await confirmar(
            `¿Deseas desactivar la receta de "${productoDeReceta(receta)}"?`
        );

        if (!aceptado) return;

        try {
            await solicitar(
                `/recetas/${encodeURIComponent(id)}/estado`,
                {
                    method: "PATCH",
                    body: {
                        activa: false
                    }
                }
            );

            await cargarDatos();
            await notificar("Receta desactivada.");
        } catch (error) {
            await notificar(
                `No se pudo desactivar la receta: ${error.message}`,
                "error"
            );
        }
    }

    // ============================================================
    // GUARDAR FORMULARIOS
    // ============================================================

    async function guardarFormulario(formulario) {
        if (estado.guardando) return;

        estado.guardando = true;

        const boton = formulario.querySelector('[type="submit"]');
        const textoOriginal = boton?.textContent || "";

        if (boton) {
            boton.disabled = true;
            boton.textContent = "Guardando...";
        }

        try {
            const tipoFormulario = formulario.dataset.inventoryForm;

            if (tipoFormulario === "producto") {
                await guardarProducto(formulario);
            } else if (tipoFormulario === "receta") {
                await guardarReceta(formulario);
            } else {
                throw new Error("Formulario no reconocido.");
            }
        } catch (error) {
            await notificar(
                error.message || "No se pudo guardar la información.",
                "error"
            );
        } finally {
            estado.guardando = false;

            if (boton) {
                boton.disabled = false;

                boton.textContent = textoOriginal ||
                    (
                        formulario.dataset.inventoryForm === "receta"
                            ? "Guardar receta"
                            : "Guardar producto"
                    );
            }
        }
    }

    // ============================================================
    // EVENTOS
    // ============================================================

    function registrarEventos() {
        inicializarComboboxes();

        $("#btnRecargar")?.addEventListener("click", cargarDatos);
        $("#btnAdd")?.addEventListener("click", nuevaProducto);
        $("#btnAddReceta")?.addEventListener("click", nuevaReceta);

        $("#modoProducto")?.addEventListener("change", () => {
            const modo = $("#modoProducto")?.value;

            if (modo === "nuevo") {
                limpiarCombobox("producto-existente");

                const formulario = $('[data-inventory-form="producto"]');

                const contenido = formulario?.elements.namedItem(
                    "contenido_inicial_ml"
                );

                if (contenido) {
                    contenido.value = "";
                }

                const detalle = $("#productoExistenteDetalle");

                if (detalle) {
                    detalle.hidden = true;
                }
            }

            actualizarFormularioProducto();
        });

        $("#productoExistente")?.addEventListener(
            "change",
            actualizarFormularioProducto
        );

        [
            "#productoCajas",
            "#productoUnidadesCaja",
            "#productoCostoCaja",
            "#productoContenido"
        ].forEach(selector => {
            $(selector)?.addEventListener(
                "input",
                actualizarResumenCompra
            );
        });

        $("#btnAgregarIngrediente")?.addEventListener(
            "click",
            () => crearFilaIngrediente()
        );

        const formularioReceta = $('[data-inventory-form="receta"]');

        ["input", "change"].forEach(tipoEvento => {
            formularioReceta?.addEventListener(
                tipoEvento,
                actualizarPreviewConsumoReceta
            );
        });

        $("#salesSearch")?.addEventListener(
            "input",
            renderizarProductos
        );

        $("#productoTipo")?.addEventListener("change", () => {
            actualizarFormularioProducto();
        });

        $("#productoUnidad")?.addEventListener("change", () => {
            actualizarUnidadStockMinimo(
                $('[data-inventory-form="producto"]')
            );
        });

        $("#btnRecetas")?.addEventListener("click", () => {
            const panel = $("#recetasPanel");

            if (!panel) return;

            panel.hidden = !panel.hidden;

            if (!panel.hidden) {
                panel.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            }
        });

        $("#btnCerrarRecetas")?.addEventListener("click", () => {
            if ($("#recetasPanel")) {
                $("#recetasPanel").hidden = true;
            }
        });

        document.addEventListener("click", event => {
            const objetivo = event.target instanceof Element
                ? event.target
                : event.target?.parentElement;

            if (!objetivo) return;

            const editarProductoBtn =
                objetivo.closest("[data-edit-product]");

            if (editarProductoBtn) {
                editarProducto(
                    editarProductoBtn.dataset.editProduct
                );

                return;
            }

            const editarRecetaBtn =
                objetivo.closest("[data-edit-recipe]");

            if (editarRecetaBtn) {
                editarReceta(
                    editarRecetaBtn.dataset.editRecipe
                );

                return;
            }

            const eliminarRecetaBtn =
                objetivo.closest("[data-delete-recipe]");

            if (eliminarRecetaBtn) {
                eliminarReceta(
                    eliminarRecetaBtn.dataset.deleteRecipe
                );

                return;
            }

            const quitarBtn =
                objetivo.closest("[data-remove-ingredient]");

            if (quitarBtn) {
                quitarBtn
                    .closest("[data-ingredient-row]")
                    ?.remove();

                actualizarPreviewConsumoReceta();
            }
        });

        $$("[data-inventory-form]").forEach(formulario => {
            formulario.addEventListener("submit", event => {
                event.preventDefault();

                if (formulario.reportValidity()) {
                    guardarFormulario(formulario);
                }
            });
        });

        $$("[data-inventory-cancel]").forEach(boton => {
            boton.addEventListener("click", () => {
                cerrarFormulario(boton.closest("form"));
            });
        });

        $$("dialog[data-inventory-modal]").forEach(dialogo => {
            dialogo.addEventListener("click", event => {
                if (event.target === dialogo) {
                    dialogo.close();
                }
            });
        });
    }

    // ============================================================
    // INICIALIZACIÓN
    // ============================================================

    async function inicializar() {
        if (document.body.dataset.page !== "inventario") {
            return;
        }

        registrarEventos();

        try {
            if (window.BIOXSession?.ready) {
                await window.BIOXSession.ready;
            }
        } catch (error) {
            console.error(
                "No se pudo inicializar la sesión:",
                error
            );
        }

        aplicarPermisosInterfaz();

        await cargarDatos();
    }

    // ============================================================
    // API PÚBLICA
    // ============================================================

    window.InventoryClient = {
        cargarDatos,
        crearFilaIngrediente,
        editarProducto,
        editarReceta,
        eliminarReceta,
        nuevaProducto,
        nuevaReceta,
        renderizarProductos,
        renderizarRecetas,
        renderizarResumen,
        estado
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            inicializar
        );
    } else {
        inicializar();
    }
})();