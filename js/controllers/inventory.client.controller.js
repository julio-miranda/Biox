
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
        productoEditando: null,
        recetaEditando: null
    };

    const $ = (selector, root = document) => root.querySelector(selector);

    const $$ = (selector, root = document) =>
        Array.from(root.querySelectorAll(selector));

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
            ingrediente: ["insumo_id", "producto_id", "productos_id", "id"]
        };

        for (const campo of campos[tipo] || ["id"]) {
            if (objeto[campo] !== undefined && objeto[campo] !== null) {
                return String(objeto[campo]);
            }
        }

        return "";
    }

    function obtenerNombre(objeto) {
        return objeto?.nombre
            ?? objeto?.producto
            ?? objeto?.nombre_producto
            ?? objeto?.descripcion
            ?? "Sin nombre";
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

        return [];
    }

    function normalizarObjeto(respuesta) {
        if (!respuesta || typeof respuesta !== "object") return {};

        for (const clave of ["datos", "data", "resultado"]) {
            if (
                respuesta[clave] &&
                typeof respuesta[clave] === "object" &&
                !Array.isArray(respuesta[clave])
            ) {
                return respuesta[clave];
            }
        }

        return respuesta;
    }

    async function solicitar(ruta, opciones = {}) {
        const configuracion = {
            method: opciones.method || "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json",
                ...(opciones.headers || {})
            }
        };

        if (opciones.body !== undefined) {
            configuracion.headers["Content-Type"] = "application/json";
            configuracion.body = JSON.stringify(opciones.body);
        }

        const respuesta = await fetch(`${API}${ruta}`, configuracion);

        let contenido = null;

        try {
            contenido = await respuesta.json();
        } catch (_) {
            contenido = null;
        }

        if (respuesta.status === 401) {
            throw new Error("La sesión ha expirado. Inicia sesión nuevamente.");
        }

        if (!respuesta.ok || contenido?.ok === false) {
            throw new Error(
                contenido?.mensaje ||
                contenido?.message ||
                contenido?.error ||
                `Error HTTP ${respuesta.status}`
            );
        }

        return contenido;
    }

    function mostrarMensaje(mensaje, tipo = "info") {
        const elemento = $("#mensaje");

        if (elemento) {
            elemento.textContent = mensaje;
            elemento.dataset.tipo = tipo;
        }

        if (tipo === "error") {
            console.error(mensaje);
        }
    }

    function confirmar(mensaje) {
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                title: "¿Estás seguro?",
                text: mensaje,
                icon: "warning",
                showCancelButton: true,
                confirmButtonText: "Sí, continuar",
                cancelButtonText: "Cancelar",
                reverseButtons: true
            }).then(resultado => resultado.isConfirmed);
        }

        return Promise.resolve(window.confirm(mensaje));
    }

    async function notificar(mensaje, tipo = "success") {
        if (typeof Swal !== "undefined") {
            await Swal.fire({
                icon: tipo,
                title: tipo === "success" ? "Operación completada" : "Aviso",
                text: mensaje,
                confirmButtonText: "Aceptar"
            });
        } else {
            window.alert(mensaje);
        }
    }

    function obtenerCuerpoProductos() {
        return $("[data-inventory-products]");
    }

    function obtenerCuerpoRecetas() {
        return $("[data-inventory-recipes]");
    }

    function mostrarEstadoTabla(cuerpo, columnas, mensaje) {
        if (!cuerpo) return;

        cuerpo.innerHTML = `
            <tr>
                <td colspan="${columnas}">${escapar(mensaje)}</td>
            </tr>
        `;
    }

    function stockActual(producto) {
        return numero(
            producto.stock_actual ??
            producto.stock ??
            producto.existencia ??
            0
        );
    }

    function stockMinimo(producto) {
        return numero(producto.stock_minimo ?? 0);
    }

    function esProductoInventariable(producto) {
        return ["insumo", "botella"].includes(
            String(producto.tipo || "").toLowerCase()
        );
    }

    function productoActivo(producto) {
        return producto.activo !== false &&
            producto.activo !== 0 &&
            producto.activo !== "false";
    }

    function renderizarResumen() {
        const resumen = estado.resumen || {};
        const productos = estado.productos;

        const totalProductos = resumen.total_productos ??
            resumen.totalProductos ??
            productos.length;

        const valor = resumen.valor_inventario ??
            resumen.valor_total ??
            resumen.valorInventario ??
            productos.reduce((suma, producto) => {
                return suma +
                    stockActual(producto) *
                    numero(producto.costo_promedio ?? producto.precio);
            }, 0);

        const stockBajo = resumen.stock_bajo ??
            resumen.productos_stock_bajo ??
            productos.filter(producto =>
                esProductoInventariable(producto) &&
                stockActual(producto) <= stockMinimo(producto)
            ).length;

        const total = $("#totalProductsCard");
        const valorElemento = $("#totalValueCard");
        const bajo = $("#lowStockCard");

        if (total) total.textContent = formatoNumero(totalProductos);
        if (valorElemento) valorElemento.textContent = formatoDinero(valor);
        if (bajo) bajo.textContent = formatoNumero(stockBajo);

        renderizarStockBajo();
    }

    function renderizarStockBajo() {
        const panel = $("#lowStockPanel");
        const contenido = $("#lowStockContent");

        if (!panel || !contenido) return;

        const productosBajos = estado.productos.filter(producto =>
            productoActivo(producto) &&
            esProductoInventariable(producto) &&
            stockActual(producto) <= stockMinimo(producto)
        );

        if (!productosBajos.length) {
            panel.hidden = true;
            contenido.innerHTML = "";
            return;
        }

        panel.hidden = false;

        contenido.innerHTML = `
            <ul>
                ${productosBajos.map(producto => `
                    <li>
                        <strong>${escapar(obtenerNombre(producto))}</strong>:
                        ${formatoNumero(stockActual(producto))}
                        ${escapar(producto.unidad_medida || "")}
                        (mínimo: ${formatoNumero(stockMinimo(producto))})
                    </li>
                `).join("")}
            </ul>
        `;
    }

    function renderizarProductos() {
        const cuerpo = obtenerCuerpoProductos();
        if (!cuerpo) return;

        const busqueda = ($("#salesSearch")?.value || "")
            .trim()
            .toLocaleLowerCase("es");

        const productos = estado.productos.filter(producto => {
            const texto = [
                obtenerNombre(producto),
                producto.tipo,
                producto.categoria,
                producto.nombre_categoria
            ].join(" ").toLocaleLowerCase("es");

            return texto.includes(busqueda);
        });

        if (!productos.length) {
            mostrarEstadoTabla(
                cuerpo,
                8,
                estado.productos.length
                    ? "No hay productos que coincidan con la búsqueda."
                    : "No hay productos registrados."
            );
            return;
        }

        cuerpo.innerHTML = productos.map(producto => {
            const id = obtenerId(producto, "producto");
            const inventariable = esProductoInventariable(producto);
            const stock = stockActual(producto);
            const minimo = stockMinimo(producto);

            let estadoStock = "No aplica";
            let claseStock = "status-na";

            if (inventariable) {
                const bajo = stock <= minimo;
                estadoStock = bajo ? "Bajo" : "Normal";
                claseStock = bajo ? "status-low" : "status-normal";
            }

            return `
                <tr>
                    <td>${escapar(obtenerNombre(producto))}</td>
                    <td>${escapar(producto.tipo || "—")}</td>
                    <td>${inventariable ? formatoNumero(stock) : "—"}</td>
                    <td>${escapar(producto.unidad_medida || "—")}</td>
                    <td>${inventariable ? formatoNumero(minimo) : "—"}</td>
                    <td class="${claseStock}">${estadoStock}</td>
                    <td>${productoActivo(producto) ? "Activo" : "Inactivo"}</td>
                    <td>
                        <button
                            type="button"
                            class="action-button action-edit"
                            data-edit-product="${escapar(id)}"
                            title="Editar producto"
                            aria-label="Editar ${escapar(obtenerNombre(producto))}">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function renderizarRecetas() {
        const cuerpo = obtenerCuerpoRecetas();
        if (!cuerpo) return;

        if (!estado.recetas.length) {
            mostrarEstadoTabla(cuerpo, 6, "No hay recetas registradas.");
            return;
        }

        cuerpo.innerHTML = estado.recetas.map(receta => {
            const id = obtenerId(receta, "receta");
            const ingredientes = receta.ingredientes ||
                receta.detalles ||
                receta.receta_detalle ||
                [];

            const nombreProducto =
                receta.producto_nombre ||
                receta.nombre_producto ||
                receta.producto ||
                obtenerNombre(
                    estado.productos.find(
                        producto =>
                            obtenerId(producto, "producto") ===
                            String(receta.producto_id ?? receta.productos_id ?? "")
                    )
                );

            const activo = receta.activa !== false &&
                receta.activa !== 0 &&
                receta.activa !== "false";

            return `
                <tr>
                    <td>${escapar(nombreProducto)}</td>
                    <td>${escapar(receta.descripcion || "—")}</td>
                    <td>${formatoNumero(receta.rendimiento ?? 1)}</td>
                    <td>
                        ${ingredientes.length
                            ? ingredientes.map(ingrediente => {
                                const nombre =
                                    ingrediente.insumo_nombre ||
                                    ingrediente.producto_nombre ||
                                    ingrediente.nombre ||
                                    obtenerNombre(
                                        estado.productos.find(
                                            producto =>
                                                obtenerId(producto, "producto") ===
                                                String(
                                                    ingrediente.insumo_id ??
                                                    ingrediente.producto_id ??
                                                    ""
                                                )
                                        )
                                    );

                                return `
                                    <div>
                                        ${escapar(nombre)}:
                                        ${formatoNumero(ingrediente.cantidad)}
                                        ${escapar(ingrediente.unidad_medida || "")}
                                    </div>
                                `;
                            }).join("")
                            : "Sin detalle de ingredientes"
                        }
                    </td>
                    <td>${activo ? "Activa" : "Inactiva"}</td>
                    <td>
                        <button
                            type="button"
                            class="action-button action-edit"
                            data-edit-recipe="${escapar(id)}"
                            title="Editar receta"
                            aria-label="Editar receta">
                            <i class="fa-solid fa-pen"></i>
                        </button>

                        <button
                            type="button"
                            class="action-button action-delete"
                            data-delete-recipe="${escapar(id)}"
                            title="Eliminar receta"
                            aria-label="Eliminar receta">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");
    }

    function actualizarSelector(selector, elementos, textoInicial, tipo) {
        if (!selector) return;

        const valorAnterior = selector.value;

        selector.innerHTML = `
            <option value="">${escapar(textoInicial)}</option>
        `;

        elementos.forEach(elemento => {
            const id = obtenerId(elemento, tipo);
            if (!id) return;

            const opcion = document.createElement("option");
            opcion.value = id;
            opcion.textContent = obtenerNombre(elemento);
            selector.appendChild(opcion);
        });

        if ([...selector.options].some(opcion => opcion.value === valorAnterior)) {
            selector.value = valorAnterior;
        }
    }

    function actualizarSelectores() {
        actualizarSelector(
            $('[data-inventory-select="categoria"]'),
            estado.categorias,
            "Selecciona una categoría",
            "categoria"
        );

        const preparados = estado.productos.filter(producto =>
            String(producto.tipo || "").toLowerCase() === "trago_preparado"
        );

        actualizarSelector(
            $('[data-inventory-select="producto-preparado"]'),
            preparados,
            "Selecciona el producto preparado",
            "producto"
        );

        const ingredientes = estado.productos.filter(producto =>
            ["insumo", "botella"].includes(
                String(producto.tipo || "").toLowerCase()
            ) && productoActivo(producto)
        );

        $$(".ingredient-product").forEach(selector => {
            const valorAnterior = selector.value;

            selector.innerHTML = `
                <option value="">Selecciona un ingrediente</option>
            `;

            ingredientes.forEach(producto => {
                const opcion = document.createElement("option");
                opcion.value = obtenerId(producto, "producto");
                opcion.textContent = obtenerNombre(producto);
                selector.appendChild(opcion);
            });

            if ([...selector.options].some(opcion =>
                opcion.value === valorAnterior
            )) {
                selector.value = valorAnterior;
            }
        });
    }

    async function cargarDatos() {
        if (estado.cargando) return;

        estado.cargando = true;
        mostrarMensaje("Cargando información del inventario...");

        try {
            const resultados = await Promise.all([
                solicitar("/resumen"),
                solicitar("/productos"),
                solicitar("/categorias"),
                solicitar("/proveedores"),
                solicitar("/recetas"),
                solicitar("/envases")
            ]);

            estado.resumen = normalizarObjeto(resultados[0]);
            estado.productos = normalizarArray(resultados[1]);
            estado.categorias = normalizarArray(resultados[2]);
            estado.proveedores = normalizarArray(resultados[3]);
            estado.recetas = normalizarArray(resultados[4]);
            estado.envases = normalizarArray(resultados[5]);

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

        if (dialogo?.open && typeof dialogo.close === "function") {
            dialogo.close();
        } else if (dialogo) {
            dialogo.removeAttribute("open");
        }
    }

    function nuevaProducto() {
        const formulario = $('[data-inventory-form="producto"]');
        if (!formulario) return;

        formulario.reset();

        const id = formulario.elements.namedItem("productos_id");
        if (id) id.value = "";

        const activo = formulario.elements.namedItem("activo");
        if (activo) activo.checked = true;

        estado.productoEditando = null;

        $("#productoModalTitle").textContent = "Agregar producto";
        formulario.querySelector('[type="submit"]').textContent =
            "Guardar producto";

        actualizarSelectores();
        abrirDialogo($("#productoModal"));
    }

    function editarProducto(id) {
        const producto = estado.productos.find(
            elemento => obtenerId(elemento, "producto") === String(id)
        );

        const formulario = $('[data-inventory-form="producto"]');

        if (!producto || !formulario) {
            mostrarMensaje("No se encontró el producto que deseas editar.", "error");
            return;
        }

        formulario.reset();

        const campos = [
            "productos_id",
            "nombre",
            "categoria_id",
            "tipo",
            "unidad_medida",
            "precio",
            "costo_promedio",
            "stock_minimo"
        ];

        const valores = {
            productos_id: obtenerId(producto, "producto"),
            nombre: producto.nombre ?? "",
            categoria_id: producto.categoria_id ?? producto.categorias_id ?? "",
            tipo: producto.tipo ?? "insumo",
            unidad_medida: producto.unidad_medida ?? "unidad",
            precio: producto.precio ?? 0,
            costo_promedio: producto.costo_promedio ?? 0,
            stock_minimo: producto.stock_minimo ?? 0
        };

        campos.forEach(campo => {
            const control = formulario.elements.namedItem(campo);
            if (control) control.value = valores[campo];
        });

        const activo = formulario.elements.namedItem("activo");
        if (activo) activo.checked = productoActivo(producto);

        estado.productoEditando = id;

        $("#productoModalTitle").textContent = "Editar producto";
        formulario.querySelector('[type="submit"]').textContent =
            "Guardar cambios";

        actualizarSelectores();
        abrirDialogo($("#productoModal"));
    }

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

            <div class="form-group">
                <label>Unidad</label>
                <select class="ingredient-unit" required>
                    <option value="unidad">Unidad</option>
                    <option value="ml">Mililitros (ml)</option>
                    <option value="litro">Litros</option>
                    <option value="gramo">Gramos</option>
                    <option value="kilogramo">Kilogramos</option>
                </select>
            </div>

            <div class="form-group">
                <label>Desperdicio (%)</label>
                <input
                    class="ingredient-waste"
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value="0">
            </div>

            <button
                type="button"
                class="ingredient-remove"
                data-remove-ingredient
                title="Quitar ingrediente"
                aria-label="Quitar ingrediente">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;

        contenedor.appendChild(fila);
        actualizarSelectores();

        const producto = fila.querySelector(".ingredient-product");
        const cantidad = fila.querySelector(".ingredient-quantity");
        const unidad = fila.querySelector(".ingredient-unit");
        const desperdicio = fila.querySelector(".ingredient-waste");

        const idProducto = datos.insumo_id ??
            datos.producto_id ??
            datos.productos_id ??
            "";

        if (idProducto !== "") producto.value = String(idProducto);
        cantidad.value = datos.cantidad ?? "";
        unidad.value = datos.unidad_medida ?? "unidad";
        desperdicio.value = datos.desperdicio ?? 0;
    }

    function recopilarIngredientes() {
        const filas = $$("[data-ingredient-row]");
        const ingredientes = [];

        filas.forEach((fila, indice) => {
            const insumoId = fila.querySelector(".ingredient-product").value;
            const cantidad = Number(
                fila.querySelector(".ingredient-quantity").value
            );
            const unidad = fila.querySelector(".ingredient-unit").value;
            const desperdicio = Number(
                fila.querySelector(".ingredient-waste").value || 0
            );

            if (!insumoId) {
                throw new Error(
                    `Selecciona el ingrediente de la fila ${indice + 1}.`
                );
            }

            if (!Number.isFinite(cantidad) || cantidad <= 0) {
                throw new Error(
                    `La cantidad del ingrediente ${indice + 1} debe ser mayor que cero.`
                );
            }

            if (
                !Number.isFinite(desperdicio) ||
                desperdicio < 0 ||
                desperdicio > 100
            ) {
                throw new Error(
                    `El desperdicio de la fila ${indice + 1} debe estar entre 0 y 100.`
                );
            }

            ingredientes.push({
                insumo_id: insumoId,
                cantidad,
                unidad_medida: unidad,
                desperdicio
            });
        });

        if (!ingredientes.length) {
            throw new Error("Agrega al menos un ingrediente a la receta.");
        }

        return ingredientes;
    }

    function nuevaReceta() {
        const formulario = $('[data-inventory-form="receta"]');
        if (!formulario) return;

        formulario.reset();

        const id = formulario.elements.namedItem("recetas_id");
        if (id) id.value = "";

        const activa = formulario.elements.namedItem("activa");
        if (activa) activa.checked = true;

        const rendimiento = formulario.elements.namedItem("rendimiento");
        if (rendimiento) rendimiento.value = "1";

        const contenedor = $("[data-inventory-ingredients]");
        if (contenedor) contenedor.innerHTML = "";

        estado.recetaEditando = null;

        $("#recetaModalTitle").textContent = "Agregar receta";
        formulario.querySelector('[type="submit"]').textContent =
            "Guardar receta";

        actualizarSelectores();
        crearFilaIngrediente();

        abrirDialogo($("#recetaModal"));
    }

    async function editarReceta(id) {
        let receta = estado.recetas.find(
            elemento => obtenerId(elemento, "receta") === String(id)
        );

        if (!receta) {
            mostrarMensaje("No se encontró la receta seleccionada.", "error");
            return;
        }

        /*
         * Algunas APIs devuelven el detalle de ingredientes al consultar
         * una receta individual. Si el listado no contiene ingredientes,
         * intentamos obtener el detalle desde GET /recetas/:id.
         */
        let ingredientes = receta.ingredientes ||
            receta.detalles ||
            receta.receta_detalle ||
            [];

        if (!ingredientes.length) {
            try {
                const respuesta = await solicitar(
                    `/recetas/${encodeURIComponent(id)}`
                );

                const detalle = normalizarObjeto(respuesta);

                receta = { ...receta, ...detalle };

                ingredientes = receta.ingredientes ||
                    receta.detalles ||
                    receta.receta_detalle ||
                    [];
            } catch (error) {
                console.error(
                    "No se pudo recuperar el detalle de la receta:",
                    error
                );
            }
        }

        const formulario = $('[data-inventory-form="receta"]');
        if (!formulario) return;

        formulario.reset();

        const valores = {
            recetas_id: obtenerId(receta, "receta"),
            producto_id: receta.producto_id ?? receta.productos_id ?? "",
            descripcion: receta.descripcion ?? "",
            rendimiento: receta.rendimiento ?? 1
        };

        Object.entries(valores).forEach(([campo, valor]) => {
            const control = formulario.elements.namedItem(campo);
            if (control) control.value = valor;
        });

        const activa = formulario.elements.namedItem("activa");
        if (activa) {
            activa.checked = receta.activa !== false &&
                receta.activa !== 0 &&
                receta.activa !== "false";
        }

        const contenedor = $("[data-inventory-ingredients]");
        if (contenedor) contenedor.innerHTML = "";

        estado.recetaEditando = id;

        $("#recetaModalTitle").textContent = "Editar receta";
        formulario.querySelector('[type="submit"]').textContent =
            "Guardar cambios";

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

    async function eliminarReceta(id) {
        const receta = estado.recetas.find(
            elemento => obtenerId(elemento, "receta") === String(id)
        );

        if (!receta) {
            mostrarMensaje("No se encontró la receta que deseas eliminar.", "error");
            return;
        }

        const aceptado = await confirmar(
            `Se eliminará la receta de "${receta.producto_nombre || receta.nombre_producto || receta.producto || "este producto"}". Esta operación no se puede deshacer desde esta pantalla.`
        );

        if (!aceptado) return;

        try {
            await solicitar(
                `/recetas/${encodeURIComponent(id)}`,
                { method: "DELETE" }
            );

            estado.recetas = estado.recetas.filter(
                elemento => obtenerId(elemento, "receta") !== String(id)
            );

            renderizarRecetas();

            await notificar("La receta se eliminó correctamente.");
            await cargarDatos();
        } catch (error) {
            await notificar(
                `No se pudo eliminar la receta: ${error.message}`,
                "error"
            );
        }
    }

    function datosProducto(formulario) {
        const datos = new FormData(formulario);

        return {
            nombre: String(datos.get("nombre") || "").trim(),
            categoria_id: datos.get("categoria_id"),
            tipo: datos.get("tipo"),
            unidad_medida: datos.get("unidad_medida"),
            precio: Number(datos.get("precio")),
            costo_promedio: Number(datos.get("costo_promedio") || 0),
            stock_minimo: Number(datos.get("stock_minimo") || 0),
            activo: datos.has("activo")
        };
    }

    async function guardarProducto(formulario) {
        const id = String(
            formulario.elements.namedItem("productos_id")?.value || ""
        ).trim();

        const datos = datosProducto(formulario);

        if (!datos.nombre) {
            throw new Error("El nombre del producto es obligatorio.");
        }

        if (!datos.categoria_id) {
            throw new Error("Selecciona una categoría.");
        }

        if (
            !Number.isFinite(datos.precio) ||
            datos.precio < 0 ||
            !Number.isFinite(datos.costo_promedio) ||
            datos.costo_promedio < 0 ||
            !Number.isFinite(datos.stock_minimo) ||
            datos.stock_minimo < 0
        ) {
            throw new Error("Verifica los valores numéricos del producto.");
        }

        if (id) {
            await solicitar(
                `/productos/${encodeURIComponent(id)}`,
                {
                    method: "PUT",
                    body: datos
                }
            );
        } else {
            await solicitar("/productos", {
                method: "POST",
                body: datos
            });
        }

        cerrarFormulario(formulario);
        await notificar(
            id ? "Producto actualizado correctamente." : "Producto agregado correctamente."
        );
        await cargarDatos();
    }

    async function guardarReceta(formulario) {
        const id = String(
            formulario.elements.namedItem("recetas_id")?.value || ""
        ).trim();

        const datos = new FormData(formulario);

        const productoId = String(datos.get("producto_id") || "").trim();
        const descripcion = String(datos.get("descripcion") || "").trim();
        const rendimiento = Number(datos.get("rendimiento"));
        const activa = datos.has("activa");

        if (!productoId) {
            throw new Error("Selecciona el producto preparado.");
        }

        if (!Number.isFinite(rendimiento) || rendimiento <= 0) {
            throw new Error("El rendimiento debe ser mayor que cero.");
        }

        const producto = estado.productos.find(
            elemento => obtenerId(elemento, "producto") === productoId
        );

        if (
            producto &&
            String(producto.tipo || "").toLowerCase() !== "trago_preparado"
        ) {
            throw new Error(
                "La receta debe asociarse a un producto de tipo trago_preparado."
            );
        }

        const ingredientes = recopilarIngredientes();

        const payload = {
            producto_id: productoId,
            descripcion,
            rendimiento,
            activa,
            ingredientes
        };

        if (id) {
            await solicitar(
                `/recetas/${encodeURIComponent(id)}`,
                {
                    method: "PUT",
                    body: payload
                }
            );
        } else {
            await solicitar("/recetas", {
                method: "POST",
                body: payload
            });
        }

        cerrarFormulario(formulario);

        await notificar(
            id ? "Receta actualizada correctamente." : "Receta agregada correctamente."
        );

        await cargarDatos();
    }

    async function guardarFormulario(formulario) {
        const boton = formulario.querySelector('[type="submit"]');

        if (boton) {
            boton.disabled = true;
            boton.dataset.textoOriginal = boton.textContent;
            boton.textContent = "Guardando...";
        }

        try {
            const tipo = formulario.dataset.inventoryForm;

            if (tipo === "producto") {
                await guardarProducto(formulario);
            } else if (tipo === "receta") {
                await guardarReceta(formulario);
            } else {
                throw new Error(`Formulario no reconocido: ${tipo}`);
            }
        } catch (error) {
            await notificar(error.message || "No se pudo guardar la información.", "error");
        } finally {
            if (boton) {
                boton.disabled = false;
                boton.textContent = boton.dataset.textoOriginal ||
                    (formulario.dataset.inventoryForm === "receta"
                        ? "Guardar receta"
                        : "Guardar producto");
                delete boton.dataset.textoOriginal;
            }
        }
    }

    function registrarEventos() {
        $("#btnRecargar")?.addEventListener("click", cargarDatos);

        $("#btnAdd")?.addEventListener("click", nuevaProducto);

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
            const panel = $("#recetasPanel");
            if (panel) panel.hidden = true;
        });

        $("#btnAddReceta")?.addEventListener("click", nuevaReceta);

        $("#btnAgregarIngrediente")?.addEventListener("click", () => {
            crearFilaIngrediente();
        });

        $("#salesSearch")?.addEventListener("input", renderizarProductos);

        document.addEventListener("click", event => {
            const editarProductoBoton = event.target.closest("[data-edit-product]");
            if (editarProductoBoton) {
                editarProducto(editarProductoBoton.dataset.editProduct);
                return;
            }

            const editarRecetaBoton = event.target.closest("[data-edit-recipe]");
            if (editarRecetaBoton) {
                editarReceta(editarRecetaBoton.dataset.editRecipe);
                return;
            }

            const eliminarRecetaBoton = event.target.closest("[data-delete-recipe]");
            if (eliminarRecetaBoton) {
                eliminarReceta(eliminarRecetaBoton.dataset.deleteRecipe);
                return;
            }

            const quitarIngredienteBoton = event.target.closest(
                "[data-remove-ingredient]"
            );

            if (quitarIngredienteBoton) {
                const fila = quitarIngredienteBoton.closest("[data-ingredient-row]");
                fila?.remove();
            }
        });

        $$("[data-inventory-form]").forEach(formulario => {
            formulario.addEventListener("submit", event => {
                event.preventDefault();

                if (!formulario.reportValidity()) return;

                guardarFormulario(formulario);
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

    async function inicializar() {
        if (document.body.dataset.page !== "inventario") return;

        registrarEventos();

        try {
            if (window.BIOXSession?.ready) {
                await window.BIOXSession.ready;
            }
        } catch (error) {
            console.error("No se pudo inicializar la sesión:", error);
        }

        await cargarDatos();
    }

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
        document.addEventListener("DOMContentLoaded", inicializar);
    } else {
        inicializar();
    }
})();