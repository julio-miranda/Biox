
"use strict";

const pool = require("../db");

// ============================================================
// CONSTANTES
// ============================================================

const TIPOS_PRODUCTO = new Set([
    "insumo",
    "botella",
    "trago_preparado",
    "servicio"
]);

const UNIDADES = new Set([
    "unidad",
    "ml",
    "litro",
    "gramo",
    "kilogramo"
]);

const TIPOS_MOVIMIENTO = new Set([
    "entrada",
    "salida",
    "ajuste_entrada",
    "ajuste_salida",
    "devolucion"
]);

const MOVIMIENTOS_POSITIVOS = new Set([
    "entrada",
    "ajuste_entrada",
    "devolucion"
]);

const MOVIMIENTOS_NEGATIVOS = new Set([
    "salida",
    "ajuste_salida"
]);

const TIPOS_CON_INVENTARIO = new Set([
    "insumo",
    "botella"
]);

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================
// ERRORES Y VALIDACIONES
// ============================================================

function errorValidacion(mensaje, status = 400) {
    const error = new Error(mensaje);
    error.status = status;
    error.esValidacion = true;
    return error;
}

function validarUUID(valor, nombre, opciones = {}) {
    if (
        (valor === undefined || valor === null || valor === "") &&
        opciones.opcional
    ) {
        return null;
    }

    const id = String(valor ?? "").trim();

    if (!UUID_REGEX.test(id)) {
        throw errorValidacion(`${nombre} no es un identificador válido.`);
    }

    return id;
}

function numero(valor, nombre, opciones = {}) {
    if (
        valor === undefined ||
        valor === null ||
        String(valor).trim() === ""
    ) {
        if (opciones.opcional) return null;

        if (opciones.permitirCeroVacio && valor === "") return 0;

        throw errorValidacion(`${nombre} es obligatorio.`);
    }

    const resultado = Number(valor);

    if (!Number.isFinite(resultado)) {
        throw errorValidacion(`${nombre} debe ser un número válido.`);
    }

    if (
        opciones.minimo !== undefined &&
        resultado < opciones.minimo
    ) {
        throw errorValidacion(
            `${nombre} debe ser como mínimo ${opciones.minimo}.`
        );
    }

    if (
        opciones.maximo !== undefined &&
        resultado > opciones.maximo
    ) {
        throw errorValidacion(
            `${nombre} no puede superar ${opciones.maximo}.`
        );
    }

    if (
        opciones.entero &&
        !Number.isInteger(resultado)
    ) {
        throw errorValidacion(`${nombre} debe ser un número entero.`);
    }

    return resultado;
}

function texto(valor, nombre, opciones = {}) {
    const resultado = String(valor ?? "").trim();

    if (opciones.requerido && !resultado) {
        throw errorValidacion(`${nombre} es obligatorio.`);
    }

    if (
        opciones.maximo &&
        resultado.length > opciones.maximo
    ) {
        throw errorValidacion(
            `${nombre} no puede superar ${opciones.maximo} caracteres.`
        );
    }

    return resultado || null;
}

function validarUnidadYTipo(tipo, unidad) {
    if (!TIPOS_PRODUCTO.has(tipo)) {
        throw errorValidacion("El tipo de producto no es válido.");
    }

    if (!UNIDADES.has(unidad)) {
        throw errorValidacion("La unidad de medida no es válida.");
    }

    if (tipo === "botella" && unidad !== "ml") {
        throw errorValidacion(
            'Los productos de tipo "botella" deben utilizar la unidad "ml".'
        );
    }

    if (
        ["trago_preparado", "servicio"].includes(tipo) &&
        unidad !== "unidad"
    ) {
        throw errorValidacion(
            'Los tragos preparados y servicios deben utilizar la unidad "unidad".'
        );
    }
}

function costoEnviado(datos, costoPredeterminado, nombre) {
    const valor =
        datos.costo_compra ??
        datos.costo_unitario ??
        datos.costo;

    if (
        valor === undefined ||
        valor === null ||
        String(valor).trim() === ""
    ) {
        return numero(costoPredeterminado, nombre, { minimo: 0 });
    }

    return numero(valor, nombre, { minimo: 0 });
}

function obtenerCategoriaId(datos, valorActual = null) {
    if (!Object.prototype.hasOwnProperty.call(datos, "categoria_id")) {
        return valorActual;
    }

    return validarUUID(
        datos.categoria_id,
        "La categoría",
        { opcional: true }
    );
}

// Convierte errores comunes de PostgreSQL en mensajes seguros.
// El error original se registra en el servidor.
function traducirErrorBD(error) {
    if (!error || error.esValidacion) return error;

    switch (error.code) {
        case "23505":
            return errorValidacion(
                "Ya existe un registro con esos datos.",
                409
            );

        case "23503":
            return errorValidacion(
                "No se puede completar la operación porque el registro está relacionado con otros datos.",
                409
            );

        case "23514":
        case "22P02":
        case "22003":
        case "22001":
            return errorValidacion(
                "Los datos enviados no cumplen las validaciones de la base de datos."
            );

        case "23502":
            return errorValidacion(
                "Falta un dato obligatorio para guardar el registro."
            );

        case "40001":
        case "40P01":
            return errorValidacion(
                "La operación tuvo un conflicto de concurrencia. Inténtalo nuevamente.",
                409
            );

        case "ECONNREFUSED":
        case "ECONNRESET":
        case "ETIMEDOUT":
            return errorValidacion(
                "No fue posible comunicarse con la base de datos. Inténtalo más tarde.",
                503
            );

        default:
            return error;
    }
}

// ============================================================
// TRANSACCIONES
// ============================================================

async function transaccion(callback) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const resultado = await callback(client);

        await client.query("COMMIT");

        return resultado;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (errorRollback) {
            console.error(
                "Error al revertir la transacción:",
                errorRollback
            );
        }

        const errorTraducido = traducirErrorBD(error);

        if (errorTraducido === error) {
            console.error("Error en transacción de inventario:", error);
        }

        throw errorTraducido;
    } finally {
        client.release();
    }
}

async function consultar(query, parametros = []) {
    try {
        return await pool.query(query, parametros);
    } catch (error) {
        const errorTraducido = traducirErrorBD(error);

        if (errorTraducido === error) {
            console.error("Error en consulta de inventario:", error);
        }

        throw errorTraducido;
    }
}

// ============================================================
// CONSULTAS AUXILIARES
// ============================================================

async function obtenerProductoBloqueado(client, productoId) {
    const id = validarUUID(productoId, "El producto");

    const { rows } = await client.query(
        `
        SELECT
            p.*,
            COALESCE(s.stock_actual, 0) AS stock_actual
        FROM catalogo.productos p
        LEFT JOIN inventario.v_stock_actual s
            ON s.productos_id = p.productos_id
        WHERE p.productos_id = $1
        FOR UPDATE OF p
        `,
        [id]
    );

    if (rows.length === 0) {
        throw errorValidacion("El producto solicitado no existe.", 404);
    }

    return rows[0];
}

async function productoTieneReferencias(client, productoId) {
    const { rows } = await client.query(
        `
        SELECT
            EXISTS (
                SELECT 1
                FROM inventario.movimientos_stock
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1
                FROM inventario.envases
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1
                FROM catalogo.receta_detalle
                WHERE insumo_id = $1
            )
            OR EXISTS (
                SELECT 1
                FROM catalogo.recetas
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1
                FROM ventas.venta_detalle
                WHERE producto_id = $1
            ) AS tiene_referencias
        `,
        [productoId]
    );

    return rows[0].tiene_referencias;
}

// ============================================================
// RESUMEN
// ============================================================

async function obtenerResumen() {
    const { rows } = await consultar(`
        WITH stock AS (
            SELECT
                productos_id,
                stock_actual,
                stock_minimo,
                activo,
                costo_promedio
            FROM inventario.v_stock_actual
        )
        SELECT
            (
                SELECT COUNT(*)::INTEGER
                FROM catalogo.productos
                WHERE activo = TRUE
            ) AS productos_activos,

            (
                SELECT COUNT(*)::INTEGER
                FROM stock
                WHERE activo = TRUE
                  AND stock_actual <= stock_minimo
            ) AS productos_bajo_minimo,

            (
                SELECT COUNT(*)::INTEGER
                FROM catalogo.productos
                WHERE tipo = 'trago_preparado'
                  AND activo = TRUE
            ) AS tragos_preparados,

            (
                SELECT COUNT(*)::INTEGER
                FROM inventario.envases
                WHERE estado = 'abierta'
                  AND contenido_actual_ml > 0
            ) AS envases_abiertos,

            (
                SELECT COALESCE(
                    SUM(stock_actual * COALESCE(costo_promedio, 0)),
                    0
                )
                FROM stock
                WHERE activo = TRUE
            ) AS valor_inventario
    `);

    return rows[0];
}

// ============================================================
// CATEGORÍAS Y PROVEEDORES
// ============================================================

async function obtenerCategorias() {
    const { rows } = await consultar(`
        SELECT categorias_id, nombre, descripcion, activo
        FROM catalogo.categorias
        WHERE activo = TRUE
        ORDER BY nombre
    `);

    return rows;
}

async function obtenerProveedores() {
    const { rows } = await consultar(`
        SELECT
            proveedores_id,
            nombre,
            nit,
            nrc,
            razon_social_denominacion,
            telefono,
            email,
            ubicacion
        FROM catalogo.proveedores
        WHERE activo = TRUE
        ORDER BY nombre
    `);

    return rows;
}

// ============================================================
// PRODUCTOS
// ============================================================

async function obtenerProductos() {
    const { rows } = await consultar(`
        SELECT
            p.productos_id,
            p.categoria_id,
            p.nombre,
            p.tipo,
            p.unidad_medida,
            p.precio,
            p.costo_promedio,
            p.stock_minimo,
            p.activo,
            p.created_at,
            p.updated_at,
            COALESCE(s.stock_actual, 0) AS stock_actual,

            GREATEST(
                p.stock_minimo - COALESCE(s.stock_actual, 0),
                0
            ) AS cantidad_sugerida,

            (
                SELECT COUNT(*)::INTEGER
                FROM inventario.envases e
                WHERE e.producto_id = p.productos_id
                  AND e.estado = 'abierta'
                  AND e.contenido_actual_ml > 0
            ) AS envases_abiertos,

            (
                SELECT COUNT(*)::INTEGER
                FROM inventario.envases e
                WHERE e.producto_id = p.productos_id
                  AND e.estado = 'cerrada'
                  AND e.contenido_actual_ml > 0
            ) AS envases_cerrados,

            EXISTS (
                SELECT 1
                FROM inventario.movimientos_stock ms
                WHERE ms.producto_id = p.productos_id
            ) AS tiene_movimientos,

            (
                NOT EXISTS (
                    SELECT 1 FROM inventario.movimientos_stock ms
                    WHERE ms.producto_id = p.productos_id
                )
                AND NOT EXISTS (
                    SELECT 1 FROM inventario.envases e
                    WHERE e.producto_id = p.productos_id
                )
                AND NOT EXISTS (
                    SELECT 1 FROM catalogo.receta_detalle rd
                    WHERE rd.insumo_id = p.productos_id
                )
                AND NOT EXISTS (
                    SELECT 1 FROM catalogo.recetas r
                    WHERE r.producto_id = p.productos_id
                )
                AND NOT EXISTS (
                    SELECT 1 FROM ventas.venta_detalle vd
                    WHERE vd.producto_id = p.productos_id
                )
            ) AS puede_cambiar_tipo

        FROM catalogo.productos p
        LEFT JOIN inventario.v_stock_actual s
            ON s.productos_id = p.productos_id
        ORDER BY p.nombre
    `);

    return rows;
}

async function crearProducto(datos = {}) {
    const nombre = texto(datos.nombre, "El nombre", {
        requerido: true,
        maximo: 150
    });

    const tipo = texto(datos.tipo, "El tipo", { requerido: true });
    const unidad = texto(
        datos.unidad_medida,
        "La unidad de medida",
        { requerido: true }
    );

    validarUnidadYTipo(tipo, unidad);

    const precio = numero(datos.precio ?? 0, "El precio", { minimo: 0 });
    const costoPromedio = numero(
        datos.costo_promedio ?? 0,
        "El costo promedio",
        { minimo: 0 }
    );
    const stockMinimo = numero(
        datos.stock_minimo ?? 0,
        "El stock mínimo",
        { minimo: 0 }
    );
    const categoriaId = obtenerCategoriaId(datos);

    return transaccion(async (client) => {
        if (categoriaId) {
            const categoria = await client.query(
                `
                SELECT categorias_id
                FROM catalogo.categorias
                WHERE categorias_id = $1 AND activo = TRUE
                `,
                [categoriaId]
            );

            if (categoria.rows.length === 0) {
                throw errorValidacion(
                    "La categoría seleccionada no existe o está inactiva."
                );
            }
        }

        const { rows } = await client.query(
            `
            INSERT INTO catalogo.productos (
                categoria_id,
                nombre,
                tipo,
                unidad_medida,
                precio,
                costo_promedio,
                stock_minimo,
                activo
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *
            `,
            [
                categoriaId,
                nombre,
                tipo,
                unidad,
                precio,
                costoPromedio,
                stockMinimo
            ]
        );

        return rows[0];
    });
}

async function actualizarProducto(productoId, datos = {}) {
    const id = validarUUID(productoId, "El producto");

    return transaccion(async (client) => {
        const actual = await obtenerProductoBloqueado(client, id);

        const nombre = Object.prototype.hasOwnProperty.call(datos, "nombre")
            ? texto(datos.nombre, "El nombre", {
                requerido: true,
                maximo: 150
            })
            : actual.nombre;

        const tipo = Object.prototype.hasOwnProperty.call(datos, "tipo")
            ? texto(datos.tipo, "El tipo", { requerido: true })
            : actual.tipo;

        const unidad = Object.prototype.hasOwnProperty.call(
            datos,
            "unidad_medida"
        )
            ? texto(datos.unidad_medida, "La unidad de medida", {
                requerido: true
            })
            : actual.unidad_medida;

        validarUnidadYTipo(tipo, unidad);

        if (tipo !== actual.tipo || unidad !== actual.unidad_medida) {
            if (await productoTieneReferencias(client, id)) {
                throw errorValidacion(
                    "No se puede cambiar el tipo o la unidad de un producto que ya tiene movimientos, envases, recetas o ventas."
                );
            }
        }

        const precio = numero(
            datos.precio ?? actual.precio,
            "El precio",
            { minimo: 0 }
        );
        const costoPromedio = numero(
            datos.costo_promedio ?? actual.costo_promedio,
            "El costo promedio",
            { minimo: 0 }
        );
        const stockMinimo = numero(
            datos.stock_minimo ?? actual.stock_minimo,
            "El stock mínimo",
            { minimo: 0 }
        );
        const categoriaId = obtenerCategoriaId(datos, actual.categoria_id);

        if (categoriaId) {
            const categoria = await client.query(
                `
                SELECT categorias_id
                FROM catalogo.categorias
                WHERE categorias_id = $1 AND activo = TRUE
                `,
                [categoriaId]
            );

            if (categoria.rows.length === 0) {
                throw errorValidacion(
                    "La categoría seleccionada no existe o está inactiva."
                );
            }
        }

        const { rows } = await client.query(
            `
            UPDATE catalogo.productos
            SET
                categoria_id = $2,
                nombre = $3,
                tipo = $4,
                unidad_medida = $5,
                precio = $6,
                costo_promedio = $7,
                stock_minimo = $8,
                updated_at = NOW()
            WHERE productos_id = $1
            RETURNING *
            `,
            [
                id,
                categoriaId,
                nombre,
                tipo,
                unidad,
                precio,
                costoPromedio,
                stockMinimo
            ]
        );

        return rows[0];
    });
}

async function cambiarEstadoProducto(productoId, activo) {
    const id = validarUUID(productoId, "El producto");

    if (typeof activo !== "boolean") {
        throw errorValidacion("El estado del producto no es válido.");
    }

    const { rows } = await consultar(
        `
        UPDATE catalogo.productos
        SET activo = $2, updated_at = NOW()
        WHERE productos_id = $1
        RETURNING *
        `,
        [id, activo]
    );

    if (rows.length === 0) {
        throw errorValidacion("El producto solicitado no existe.", 404);
    }

    return rows[0];
}

// ============================================================
// ENVASES
// ============================================================

async function obtenerEnvases(productoId = null) {
    const id = productoId
        ? validarUUID(productoId, "El producto")
        : null;

    const { rows } = await consultar(
        `
        SELECT
            e.envases_id,
            e.producto_id,
            p.nombre AS producto,
            e.proveedor_id,
            pr.nombre AS proveedor,
            e.contenido_inicial_ml,
            e.contenido_actual_ml,
            e.estado,
            e.fecha_apertura,
            e.costo_compra,
            e.observacion,
            e.created_at,
            e.updated_at
        FROM inventario.envases e
        INNER JOIN catalogo.productos p
            ON p.productos_id = e.producto_id
        LEFT JOIN catalogo.proveedores pr
            ON pr.proveedores_id = e.proveedor_id
        WHERE ($1::UUID IS NULL OR e.producto_id = $1::UUID)
        ORDER BY
            CASE e.estado
                WHEN 'abierta' THEN 0
                WHEN 'cerrada' THEN 1
                WHEN 'vacia' THEN 2
                ELSE 3
            END,
            e.contenido_actual_ml ASC,
            e.created_at ASC
        `,
        [id]
    );

    return rows;
}

// ============================================================
// MOVIMIENTOS DE BOTELLAS
// ============================================================

async function registrarMovimientoBotella(
    client,
    datos,
    usuarioId,
    producto,
    tipoMovimiento,
    cantidad,
    proveedorId,
    observacion
) {
    const productoId = producto.productos_id;

    if (producto.unidad_medida !== "ml") {
        throw errorValidacion(
            'El producto botella debe utilizar la unidad "ml".'
        );
    }

    if (MOVIMIENTOS_POSITIVOS.has(tipoMovimiento)) {
        if (!Number.isInteger(cantidad)) {
            throw errorValidacion(
                "La cantidad de envases que ingresan debe ser un número entero."
            );
        }

        const contenidoInicial = numero(
            datos.contenido_inicial_ml,
            "El contenido inicial de cada botella",
            { minimo: Number.EPSILON }
        );

        const stockAnterior = Number(producto.stock_actual || 0);
        const costoPromedioAnterior = Number(
            producto.costo_promedio || 0
        );

        const costoPorEnvase = costoEnviado(
            datos,
            costoPromedioAnterior * contenidoInicial,
            "El costo de cada botella"
        );

        const costoPorMl = costoPorEnvase / contenidoInicial;

        if (!Number.isFinite(costoPorMl)) {
            throw errorValidacion("No se pudo calcular el costo por mililitro.");
        }

        const movimientos = [];
        const cantidadTotalMl = cantidad * contenidoInicial;

        for (let i = 0; i < cantidad; i += 1) {
            const { rows: envaseRows } = await client.query(
                `
                INSERT INTO inventario.envases (
                    producto_id,
                    proveedor_id,
                    contenido_inicial_ml,
                    contenido_actual_ml,
                    estado,
                    costo_compra,
                    observacion
                )
                VALUES ($1, $2, $3, $3, 'cerrada', $4, $5)
                RETURNING envases_id
                `,
                [
                    productoId,
                    proveedorId,
                    contenidoInicial,
                    costoPorEnvase,
                    observacion
                ]
            );

            const envaseId = envaseRows[0].envases_id;

            const { rows: movimientoRows } = await client.query(
                `
                INSERT INTO inventario.movimientos_stock (
                    producto_id,
                    usuario_id,
                    proveedor_id,
                    envase_id,
                    tipo,
                    cantidad,
                    costo,
                    observacion
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                `,
                [
                    productoId,
                    usuarioId || null,
                    proveedorId,
                    envaseId,
                    tipoMovimiento,
                    contenidoInicial,
                    costoPorMl,
                    observacion
                ]
            );

            movimientos.push(movimientoRows[0]);
        }

        const nuevoStock = stockAnterior + cantidadTotalMl;
        const nuevoCostoPromedio = nuevoStock > 0
            ? (
                stockAnterior * costoPromedioAnterior +
                cantidadTotalMl * costoPorMl
            ) / nuevoStock
            : costoPorMl;

        await client.query(
            `
            UPDATE catalogo.productos
            SET costo_promedio = $2, updated_at = NOW()
            WHERE productos_id = $1
            `,
            [productoId, nuevoCostoPromedio]
        );

        return {
            producto_id: productoId,
            tipo: tipoMovimiento,
            envases_registrados: cantidad,
            cantidad_ml: cantidadTotalMl,
            movimientos
        };
    }

    if (!MOVIMIENTOS_NEGATIVOS.has(tipoMovimiento)) {
        throw errorValidacion(
            "El tipo de movimiento no está permitido para botellas."
        );
    }

    const stockDisponible = Number(producto.stock_actual || 0);

    if (stockDisponible + 0.0001 < cantidad) {
        throw errorValidacion(
            `Contenido insuficiente. Disponible: ${stockDisponible} ml; solicitado: ${cantidad} ml.`
        );
    }

    let restante = cantidad;

    const { rows: envases } = await client.query(
        `
        SELECT
            envases_id,
            contenido_actual_ml,
            estado
        FROM inventario.envases
        WHERE producto_id = $1
          AND estado IN ('abierta', 'cerrada')
          AND contenido_actual_ml > 0
        ORDER BY
            CASE WHEN estado = 'abierta' THEN 0 ELSE 1 END,
            contenido_actual_ml ASC,
            created_at ASC,
            envases_id ASC
        FOR UPDATE
        `,
        [productoId]
    );

    const movimientos = [];

    for (const envase of envases) {
        if (restante <= 0.0000001) break;

        const disponible = Number(envase.contenido_actual_ml);
        const descontar = Math.min(restante, disponible);

        await client.query(
            `
            UPDATE inventario.envases
            SET
                contenido_actual_ml = GREATEST(
                    contenido_actual_ml - $2,
                    0
                ),
                estado = CASE
                    WHEN contenido_actual_ml - $2 <= 0
                        THEN 'vacia'
                    ELSE 'abierta'
                END,
                fecha_apertura = COALESCE(fecha_apertura, NOW()),
                updated_at = NOW()
            WHERE envases_id = $1
            `,
            [envase.envases_id, descontar]
        );

        const { rows: movimientoRows } = await client.query(
            `
            INSERT INTO inventario.movimientos_stock (
                producto_id,
                usuario_id,
                proveedor_id,
                envase_id,
                tipo,
                cantidad,
                costo,
                observacion
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            `,
            [
                productoId,
                usuarioId || null,
                proveedorId,
                envase.envases_id,
                tipoMovimiento,
                descontar,
                Number(producto.costo_promedio || 0),
                observacion
            ]
        );

        movimientos.push(movimientoRows[0]);
        restante -= descontar;
    }

    if (restante > 0.0001) {
        throw errorValidacion(
            "No fue posible completar la salida con el contenido disponible."
        );
    }

    return {
        producto_id: productoId,
        tipo: tipoMovimiento,
        cantidad_ml: cantidad,
        movimientos
    };
}

// ============================================================
// MOVIMIENTOS DE INSUMOS
// ============================================================

async function registrarMovimientoInsumo(
    client,
    datos,
    usuarioId,
    producto,
    tipoMovimiento,
    cantidad,
    proveedorId,
    observacion
) {
    const productoId = producto.productos_id;

    if (producto.tipo !== "insumo") {
        throw errorValidacion(
            "Solo los productos de tipo insumo admiten movimientos ordinarios."
        );
    }

    const stockActual = Number(producto.stock_actual || 0);
    const esPositivo = MOVIMIENTOS_POSITIVOS.has(tipoMovimiento);
    const esNegativo = MOVIMIENTOS_NEGATIVOS.has(tipoMovimiento);

    if (!esPositivo && !esNegativo) {
        throw errorValidacion("El tipo de movimiento no está permitido.");
    }

    if (esNegativo && stockActual + 0.0001 < cantidad) {
        throw errorValidacion(
            `Existencias insuficientes. Disponible: ${stockActual} ${producto.unidad_medida}; solicitado: ${cantidad} ${producto.unidad_medida}.`
        );
    }

    const costo = esNegativo
        ? Number(producto.costo_promedio || 0)
        : costoEnviado(
            datos,
            producto.costo_promedio || 0,
            "El costo unitario"
        );

    const { rows } = await client.query(
        `
        INSERT INTO inventario.movimientos_stock (
            producto_id,
            usuario_id,
            proveedor_id,
            tipo,
            cantidad,
            costo,
            observacion
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
            productoId,
            usuarioId || null,
            proveedorId,
            tipoMovimiento,
            cantidad,
            costo,
            observacion
        ]
    );

    if (esPositivo) {
        const nuevoStock = stockActual + cantidad;
        const costoAnterior = Number(producto.costo_promedio || 0);

        const nuevoCostoPromedio = nuevoStock > 0
            ? (
                stockActual * costoAnterior +
                cantidad * costo
            ) / nuevoStock
            : costo;

        await client.query(
            `
            UPDATE catalogo.productos
            SET costo_promedio = $2, updated_at = NOW()
            WHERE productos_id = $1
            `,
            [productoId, nuevoCostoPromedio]
        );
    }

    return rows[0];
}

async function registrarMovimiento(datos = {}, usuarioId) {
    const productoId = validarUUID(
        datos.producto_id,
        "El producto"
    );

    const tipoMovimiento = texto(
        datos.tipo,
        "El tipo de movimiento",
        { requerido: true }
    );

    if (!TIPOS_MOVIMIENTO.has(tipoMovimiento)) {
        throw errorValidacion("El tipo de movimiento no está permitido.");
    }

    const cantidad = numero(
        datos.cantidad,
        "La cantidad",
        { minimo: Number.EPSILON }
    );

    const proveedorId = validarUUID(
        datos.proveedor_id,
        "El proveedor",
        { opcional: true }
    );

    const observacion = texto(
        datos.observacion,
        "La observación",
        { maximo: 1000 }
    );

    const idUsuario = usuarioId
        ? validarUUID(usuarioId, "El usuario")
        : null;

    return transaccion(async (client) => {
        if (proveedorId) {
            const proveedor = await client.query(
                `
                SELECT proveedores_id
                FROM catalogo.proveedores
                WHERE proveedores_id = $1 AND activo = TRUE
                `,
                [proveedorId]
            );

            if (proveedor.rows.length === 0) {
                throw errorValidacion(
                    "El proveedor no existe o está inactivo."
                );
            }
        }

        const producto = await obtenerProductoBloqueado(
            client,
            productoId
        );

        if (!producto.activo) {
            throw errorValidacion(
                "No se pueden registrar movimientos para un producto inactivo."
            );
        }

        if (!TIPOS_CON_INVENTARIO.has(producto.tipo)) {
            throw errorValidacion(
                "Los tragos preparados y servicios no admiten movimientos manuales."
            );
        }

        if (producto.tipo === "botella") {
            return registrarMovimientoBotella(
                client,
                datos,
                idUsuario,
                producto,
                tipoMovimiento,
                cantidad,
                proveedorId,
                observacion
            );
        }

        return registrarMovimientoInsumo(
            client,
            datos,
            idUsuario,
            producto,
            tipoMovimiento,
            cantidad,
            proveedorId,
            observacion
        );
    });
}

// ============================================================
// RECETAS: VALIDACIÓN E INGREDIENTES
// ============================================================

function normalizarIngredientes(ingredientes) {
    if (!Array.isArray(ingredientes) || ingredientes.length === 0) {
        throw errorValidacion(
            "La receta debe tener al menos un ingrediente."
        );
    }

    const vistos = new Set();

    return ingredientes.map((ingrediente, indice) => {
        if (!ingrediente || typeof ingrediente !== "object") {
            throw errorValidacion(
                `El ingrediente de la fila ${indice + 1} no es válido.`
            );
        }

        const productoId = validarUUID(
            ingrediente.insumo_id || ingrediente.producto_id,
            `El producto ingrediente de la fila ${indice + 1}`
        );

        const clave = productoId.toLowerCase();

        if (vistos.has(clave)) {
            throw errorValidacion(
                "No repitas el mismo producto en una receta. Suma sus cantidades."
            );
        }

        vistos.add(clave);

        return {
            insumo_id: productoId,
            cantidad: numero(
                ingrediente.cantidad,
                `La cantidad del ingrediente ${indice + 1}`,
                { minimo: Number.EPSILON }
            ),
            desperdicio: numero(
                ingrediente.desperdicio ?? 0,
                `El desperdicio del ingrediente ${indice + 1}`,
                { minimo: 0, maximo: 100 }
            )
        };
    });
}

async function validarIngredientes(client, ingredientes) {
    for (const ingrediente of ingredientes) {
        const { rows } = await client.query(
            `
            SELECT productos_id, nombre, tipo, unidad_medida, activo
            FROM catalogo.productos
            WHERE productos_id = $1
            FOR SHARE
            `,
            [ingrediente.insumo_id]
        );

        if (rows.length === 0) {
            throw errorValidacion(
                "Uno de los ingredientes seleccionados no existe."
            );
        }

        const producto = rows[0];

        if (!producto.activo) {
            throw errorValidacion(
                `El ingrediente "${producto.nombre}" está inactivo.`
            );
        }

        if (!TIPOS_CON_INVENTARIO.has(producto.tipo)) {
            throw errorValidacion(
                `El producto "${producto.nombre}" no puede utilizarse como ingrediente.`
            );
        }

        if (
            producto.tipo === "botella" &&
            producto.unidad_medida !== "ml"
        ) {
            throw errorValidacion(
                `El ingrediente "${producto.nombre}" debe utilizar mililitros.`
            );
        }
    }
}

async function insertarIngredientes(client, recetaId, ingredientes) {
    for (const ingrediente of ingredientes) {
        await client.query(
            `
            INSERT INTO catalogo.receta_detalle (
                receta_id,
                insumo_id,
                cantidad,
                desperdicio
            )
            VALUES ($1, $2, $3, $4)
            `,
            [
                recetaId,
                ingrediente.insumo_id,
                ingrediente.cantidad,
                ingrediente.desperdicio
            ]
        );
    }
}

// ============================================================
// CONSULTAR RECETAS
// ============================================================

async function obtenerRecetas() {
    const { rows } = await consultar(`
        SELECT
            r.recetas_id,
            r.producto_id,
            p.nombre AS producto,
            p.activo AS producto_activo,
            r.descripcion,
            r.rendimiento,
            r.activa,
            r.created_at,
            r.updated_at,

            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'insumo_id', rd.insumo_id,
                            'producto_id', rd.insumo_id,
                            'nombre', pi.nombre,
                            'tipo', pi.tipo,
                            'unidad_medida', pi.unidad_medida,
                            'cantidad', rd.cantidad,
                            'desperdicio', rd.desperdicio
                        )
                        ORDER BY pi.nombre
                    )
                    FROM catalogo.receta_detalle rd
                    INNER JOIN catalogo.productos pi
                        ON pi.productos_id = rd.insumo_id
                    WHERE rd.receta_id = r.recetas_id
                ),
                '[]'::JSONB
            ) AS ingredientes

        FROM catalogo.recetas r
        INNER JOIN catalogo.productos p
            ON p.productos_id = r.producto_id
        ORDER BY p.nombre
    `);

    return rows;
}

// ============================================================
// CREAR RECETA
// ============================================================

async function crearReceta(datos = {}) {
    const productoId = validarUUID(
        datos.producto_id,
        "El producto preparado"
    );

    const descripcion = texto(
        datos.descripcion,
        "La descripción",
        { maximo: 1000 }
    );

    const rendimiento = numero(
        datos.rendimiento,
        "El rendimiento",
        { minimo: Number.EPSILON }
    );

    const ingredientes = normalizarIngredientes(datos.ingredientes);

    return transaccion(async (client) => {
        const { rows: productoRows } = await client.query(
            `
            SELECT productos_id, nombre, tipo, activo
            FROM catalogo.productos
            WHERE productos_id = $1
            FOR UPDATE
            `,
            [productoId]
        );

        if (productoRows.length === 0) {
            throw errorValidacion(
                "El producto preparado no existe.",
                404
            );
        }

        const producto = productoRows[0];

        if (producto.tipo !== "trago_preparado") {
            throw errorValidacion(
                "Solo se pueden crear recetas para productos de tipo trago_preparado."
            );
        }

        if (!producto.activo) {
            throw errorValidacion(
                "No se puede crear una receta para un producto inactivo."
            );
        }

        await validarIngredientes(client, ingredientes);

        const existente = await client.query(
            `
            SELECT recetas_id
            FROM catalogo.recetas
            WHERE producto_id = $1
            `,
            [productoId]
        );

        if (existente.rows.length > 0) {
            throw errorValidacion(
                "Este producto ya tiene una receta. Utiliza la opción de editar.",
                409
            );
        }

        const { rows } = await client.query(
            `
            INSERT INTO catalogo.recetas (
                producto_id,
                descripcion,
                rendimiento,
                activa
            )
            VALUES ($1, $2, $3, TRUE)
            RETURNING *
            `,
            [productoId, descripcion, rendimiento]
        );

        const receta = rows[0];

        await insertarIngredientes(
            client,
            receta.recetas_id,
            ingredientes
        );

        return receta;
    });
}

// ============================================================
// ACTUALIZAR RECETA
// ============================================================

async function actualizarReceta(recetaId, datos = {}) {
    const id = validarUUID(recetaId, "La receta");

    const descripcion = texto(
        datos.descripcion,
        "La descripción",
        { maximo: 1000 }
    );

    const rendimiento = numero(
        datos.rendimiento,
        "El rendimiento",
        { minimo: Number.EPSILON }
    );

    const ingredientes = normalizarIngredientes(datos.ingredientes);

    return transaccion(async (client) => {
        const { rows } = await client.query(
            `
            SELECT
                r.*,
                p.tipo,
                p.activo AS producto_activo
            FROM catalogo.recetas r
            INNER JOIN catalogo.productos p
                ON p.productos_id = r.producto_id
            WHERE r.recetas_id = $1
            FOR UPDATE OF r, p
            `,
            [id]
        );

        if (rows.length === 0) {
            throw errorValidacion("La receta solicitada no existe.", 404);
        }

        const receta = rows[0];

        if (receta.tipo !== "trago_preparado") {
            throw errorValidacion(
                "La receta no está relacionada con un trago preparado."
            );
        }

        if (!receta.producto_activo) {
            throw errorValidacion(
                "No se puede actualizar la receta porque el producto está inactivo."
            );
        }

        await validarIngredientes(client, ingredientes);

        await client.query(
            `
            UPDATE catalogo.recetas
            SET descripcion = $2,
                rendimiento = $3,
                updated_at = NOW()
            WHERE recetas_id = $1
            `,
            [id, descripcion, rendimiento]
        );

        await client.query(
            `
            DELETE FROM catalogo.receta_detalle
            WHERE receta_id = $1
            `,
            [id]
        );

        await insertarIngredientes(client, id, ingredientes);

        return {
            recetas_id: id,
            producto_id: receta.producto_id,
            descripcion,
            rendimiento,
            activa: receta.activa
        };
    });
}

// ============================================================
// DESACTIVAR RECETA
// ============================================================

async function desactivarReceta(recetaId) {
    const id = validarUUID(recetaId, "La receta");

    const { rows } = await consultar(
        `
        UPDATE catalogo.recetas
        SET activa = FALSE, updated_at = NOW()
        WHERE recetas_id = $1
        RETURNING *
        `,
        [id]
    );

    if (rows.length === 0) {
        throw errorValidacion("La receta solicitada no existe.", 404);
    }

    return rows[0];
}

// ============================================================
// EXPORTACIONES
// ============================================================

module.exports = {
    obtenerResumen,
    obtenerCategorias,
    obtenerProveedores,

    obtenerProductos,
    crearProducto,
    actualizarProducto,
    cambiarEstadoProducto,

    obtenerEnvases,
    registrarMovimiento,

    obtenerRecetas,
    crearReceta,
    actualizarReceta,
    desactivarReceta
};