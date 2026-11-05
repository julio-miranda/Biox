
"use strict";

const db = require("../db");

const TIPOS_INVENTARIABLES = new Set([
    "insumo",
    "botella"
]);

const METODOS_PAGO = new Set([
    "efectivo",
    "tarjeta",
    "transferencia",
    "otro"
]);

function crearError(mensaje, statusCode = 400) {
    const error = new Error(mensaje);
    error.statusCode = statusCode;
    return error;
}

function redondear(valor) {
    return Math.round(
        (Number(valor) + Number.EPSILON) * 100
    ) / 100;
}

function redondearCantidad(valor) {
    return Math.round(
        (Number(valor) + Number.EPSILON) * 1000
    ) / 1000;
}

function obtenerArray(valor) {
    if (Array.isArray(valor)) {
        return valor;
    }

    if (valor && typeof valor === "object") {
        for (const clave of [
            "datos",
            "data",
            "resultado",
            "items"
        ]) {
            if (Array.isArray(valor[clave])) {
                return valor[clave];
            }
        }
    }

    return [];
}

// ============================================================
// PRODUCTOS
// ============================================================

async function listarProductos() {
    const consulta = `
        SELECT
            p.productos_id,
            p.nombre,
            p.tipo,
            p.unidad_medida,
            p.precio,
            p.costo_promedio,
            p.stock_minimo,
            p.activo,
            COALESCE(s.stock_actual, 0) AS stock_actual,
            CASE
                WHEN p.tipo = 'trago_preparado' THEN EXISTS (
                    SELECT 1
                    FROM catalogo.recetas r
                    WHERE r.producto_id = p.productos_id
                      AND r.activa = TRUE
                )
                ELSE TRUE
            END AS tiene_receta
        FROM catalogo.productos p
        LEFT JOIN inventario.v_stock_actual s
            ON s.productos_id = p.productos_id
        WHERE p.activo = TRUE
        ORDER BY p.nombre ASC
    `;

    const resultado = await db.query(consulta);

    return resultado.rows;
}

// ============================================================
// LISTAR VENTAS
// ============================================================

async function listarVentas(filtros = {}) {
    const condiciones = [];
    const parametros = [];

    if (filtros.desde) {
        parametros.push(filtros.desde);

        condiciones.push(
            `v.created_at >= $${parametros.length}::date`
        );
    }

    if (filtros.hasta) {
        parametros.push(filtros.hasta);

        condiciones.push(
            `v.created_at < ($${parametros.length}::date + INTERVAL '1 day')`
        );
    }

    if (filtros.estado) {
        parametros.push(filtros.estado);

        condiciones.push(
            `v.estado = $${parametros.length}`
        );
    }

    const where = condiciones.length
        ? `WHERE ${condiciones.join(" AND ")}`
        : "";

    const consulta = `
        SELECT
            v.ventas_id,
            v.usuario_id,
            v.subtotal,
            v.descuento,
            v.impuesto,
            v.total,
            v.metodo_pago,
            v.estado,
            v.observacion,
            v.mesa_numero,
            v.created_at,
            COALESCE(
                u.nombre,
                u.email,
                'Usuario'
            ) AS usuario_nombre,
            COALESCE(
                detalles.productos,
                '[]'::json
            ) AS productos
        FROM ventas.ventas v
        LEFT JOIN seguridad.usuarios u
            ON u.usuarios_id = v.usuario_id
        LEFT JOIN LATERAL (
            SELECT
                json_agg(
                    json_build_object(
                        'producto_id', p.productos_id,
                        'nombre', p.nombre,
                        'cantidad', d.cantidad,
                        'precio_unitario', d.precio_unitario,
                        'costo_unitario', d.costo_unitario,
                        'total_linea', d.total_linea
                    )
                    ORDER BY p.nombre
                ) AS productos
            FROM ventas.venta_detalle d
            JOIN catalogo.productos p
                ON p.productos_id = d.producto_id
            WHERE d.venta_id = v.ventas_id
        ) detalles ON TRUE
        ${where}
        ORDER BY v.created_at DESC
        LIMIT 200
    `;

    const resultado = await db.query(
        consulta,
        parametros
    );

    return resultado.rows;
}

// ============================================================
// OBTENER UNA VENTA
// ============================================================

async function obtenerVenta(ventaId) {
    if (!ventaId) {
        throw crearError(
            "No se proporcionó el identificador de la venta."
        );
    }

    const consultaVenta = `
        SELECT
            v.ventas_id,
            v.usuario_id,
            v.subtotal,
            v.descuento,
            v.impuesto,
            v.total,
            v.metodo_pago,
            v.estado,
            v.observacion,
            v.mesa_numero,
            v.created_at,
            COALESCE(
                u.nombre,
                u.email,
                'Usuario'
            ) AS usuario_nombre
        FROM ventas.ventas v
        LEFT JOIN seguridad.usuarios u
            ON u.usuarios_id = v.usuario_id
        WHERE v.ventas_id = $1
    `;

    const resultadoVenta = await db.query(
        consultaVenta,
        [ventaId]
    );

    if (!resultadoVenta.rows.length) {
        throw crearError("La venta no existe.", 404);
    }

    const consultaDetalles = `
        SELECT
            d.venta_detalle_id,
            d.producto_id,
            p.nombre AS producto_nombre,
            p.tipo AS producto_tipo,
            d.cantidad,
            d.precio_unitario,
            d.costo_unitario,
            d.total_linea
        FROM ventas.venta_detalle d
        JOIN catalogo.productos p
            ON p.productos_id = d.producto_id
        WHERE d.venta_id = $1
        ORDER BY p.nombre
    `;

    const resultadoDetalles = await db.query(
        consultaDetalles,
        [ventaId]
    );

    return {
        ...resultadoVenta.rows[0],
        detalles: resultadoDetalles.rows
    };
}

// ============================================================
// OBTENER PRODUCTO Y BLOQUEARLO
// ============================================================

async function obtenerProductoBloqueado(
    cliente,
    productoId
) {
    const resultado = await cliente.query(
        `
        SELECT
            productos_id,
            nombre,
            tipo,
            unidad_medida,
            precio,
            costo_promedio,
            activo
        FROM catalogo.productos
        WHERE productos_id = $1
        FOR UPDATE
        `,
        [productoId]
    );

    if (!resultado.rows.length) {
        throw crearError(
            `No existe el producto ${productoId}.`,
            404
        );
    }

    const producto = resultado.rows[0];

    if (!producto.activo) {
        throw crearError(
            `El producto "${producto.nombre}" está inactivo.`
        );
    }

    return producto;
}

// ============================================================
// OBTENER RECETA ACTIVA
// ============================================================

async function obtenerRecetaActiva(
    cliente,
    productoId
) {
    const resultado = await cliente.query(
        `
        SELECT
            recetas_id,
            producto_id,
            descripcion
        FROM catalogo.recetas
        WHERE producto_id = $1
          AND activa = TRUE
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [productoId]
    );

    if (!resultado.rows.length) {
        throw crearError(
            "El producto preparado no tiene una receta activa."
        );
    }

    const receta = resultado.rows[0];

    const detalles = await cliente.query(
        `
        SELECT
            rd.insumo_id,
            rd.cantidad,
            p.unidad_medida
        FROM catalogo.receta_detalle rd
        INNER JOIN catalogo.productos p
            ON p.productos_id = rd.insumo_id
        WHERE rd.receta_id = $1
        ORDER BY rd.insumo_id
        `,
        [receta.recetas_id]
    );

    if (!detalles.rows.length) {
        throw crearError(
            "La receta no contiene ingredientes registrados."
        );
    }

    return {
        ...receta,
        ingredientes: detalles.rows
    };
}

// ============================================================
// CALCULAR COSTO DE UNA RECETA
//
// No registra movimientos de inventario.
// El consumo lo gestiona PostgreSQL mediante sus triggers.
// ============================================================

async function calcularCostoReceta(
    cliente,
    receta,
    cantidadVendida
) {
    let costoTotal = 0;

    for (const ingrediente of receta.ingredientes) {
        const cantidadReceta = Number(
            ingrediente.cantidad
        );

        if (
            !Number.isFinite(cantidadReceta) ||
            cantidadReceta <= 0
        ) {
            throw crearError(
                "La receta contiene cantidades de ingredientes no válidas."
            );
        }

        const producto = await obtenerProductoBloqueado(
            cliente,
            ingrediente.insumo_id
        );

        if (!TIPOS_INVENTARIABLES.has(producto.tipo)) {
            throw crearError(
                `El ingrediente "${producto.nombre}" debe ser ` +
                "un insumo o una botella."
            );
        }

        const unidadReceta = ingrediente.unidad_medida
            || producto.unidad_medida;

        if (unidadReceta !== producto.unidad_medida) {
            throw crearError(
                `La unidad de la receta para "${producto.nombre}" ` +
                `(${unidadReceta}) no coincide con la unidad del ` +
                `producto (${producto.unidad_medida}). ` +
                "Corrige la unidad del ingrediente en la receta."
            );
        }

        if (
            producto.tipo === "botella" &&
            producto.unidad_medida !== "ml"
        ) {
            throw crearError(
                `La botella "${producto.nombre}" debe utilizar ml.`
            );
        }

        const cantidadConsumida = redondearCantidad(
            cantidadReceta * cantidadVendida
        );

        if (
            !Number.isFinite(cantidadConsumida) ||
            cantidadConsumida <= 0
        ) {
            throw crearError(
                `No se pudo calcular el consumo de "${producto.nombre}".`
            );
        }

        /*
         * Se conserva la interpretación de costo_promedio
         * utilizada por el modelo actual. Verifica que dicho
         * campo represente el costo por la misma unidad de
         * medida que utiliza la receta.
         */
        const costoIngrediente = Math.max(
            0,
            Number(producto.costo_promedio) || 0
        );

        costoTotal += cantidadConsumida * costoIngrediente;
    }

    return costoTotal;
}

// ============================================================
// VALIDAR Y CONSOLIDAR PRODUCTOS
// ============================================================

function validarProductosSolicitados(datos) {
    const productosSolicitados = obtenerArray(
        datos.productos
    );

    if (!productosSolicitados.length) {
        throw crearError(
            "La venta debe contener al menos un producto."
        );
    }

    const consolidado = new Map();

    for (const item of productosSolicitados) {
        if (!item || typeof item !== "object") {
            throw crearError(
                "La lista contiene un producto no válido."
            );
        }

        const productoId = String(
            item.producto_id ?? item.productos_id ?? ""
        ).trim();

        const cantidad = Number(item.cantidad);

        if (!productoId) {
            throw crearError(
                "Hay un producto sin identificador."
            );
        }

        if (
            !Number.isFinite(cantidad) ||
            cantidad <= 0
        ) {
            throw crearError(
                "Todas las cantidades deben ser mayores que cero."
            );
        }

        consolidado.set(
            productoId,
            (consolidado.get(productoId) || 0) + cantidad
        );
    }

    // La columna de detalle usa numeric(12,3). Normalizar antes de
    // calcular costos mantiene las cantidades iguales a las que reciben
    // los triggers de inventario.
    for (const [productoId, cantidad] of consolidado) {
        const cantidadNormalizada = redondearCantidad(cantidad);

        if (cantidadNormalizada <= 0) {
            throw crearError(
                "La cantidad debe ser al menos 0.001."
            );
        }

        consolidado.set(productoId, cantidadNormalizada);
    }

    return consolidado;
}

// ============================================================
// CREAR VENTA
//
// El inventario se actualiza exclusivamente mediante:
// - inventario.fn_descontar_venta_directa()
// - inventario.fn_consumir_receta_venta()
//
// No se insertan movimientos manuales desde Node.js.
// ============================================================

async function crearVenta(datos, usuarioId) {
    if (
        !datos ||
        typeof datos !== "object" ||
        Array.isArray(datos)
    ) {
        throw crearError(
            "Los datos de la venta no son válidos."
        );
    }

    if (!usuarioId) {
        throw crearError(
            "No se pudo identificar al usuario de la sesión.",
            401
        );
    }

    const metodoPago = String(
        datos.metodo_pago || ""
    ).trim().toLowerCase();

    if (!METODOS_PAGO.has(metodoPago)) {
        throw crearError(
            "El método de pago no es válido."
        );
    }

    let mesaNumero = null;

    if (
        datos.mesa_numero !== undefined &&
        datos.mesa_numero !== null &&
        datos.mesa_numero !== ""
    ) {
        mesaNumero = Number(datos.mesa_numero);

        if (
            !Number.isInteger(mesaNumero) ||
            mesaNumero < 1
        ) {
            throw crearError(
                "El número de mesa debe ser un entero positivo."
            );
        }
    }

    const consolidado = validarProductosSolicitados(datos);

    const cliente = await db.connect();

    let transaccionIniciada = false;

    try {
        await cliente.query("BEGIN");
        transaccionIniciada = true;

        const items = [];

        let subtotal = 0;
        let costoTotal = 0;

        // ----------------------------------------------------
        // VALIDAR PRODUCTOS Y CALCULAR IMPORTES
        // ----------------------------------------------------

        for (const [productoId, cantidad] of consolidado) {
            const producto = await obtenerProductoBloqueado(
                cliente,
                productoId
            );

            const precioUnitario = Number(
                producto.precio
            );

            if (
                !Number.isFinite(precioUnitario) ||
                precioUnitario < 0
            ) {
                throw crearError(
                    `El precio de "${producto.nombre}" no es válido.`
                );
            }

            if (
                producto.tipo === "botella" &&
                !Number.isInteger(cantidad)
            ) {
                throw crearError(
                    `La cantidad de "${producto.nombre}" ` +
                    "debe ser un número entero de botellas."
                );
            }

            let costoUnitario = Math.max(
                0,
                Number(producto.costo_promedio) || 0
            );

            if (producto.tipo === "trago_preparado") {
                const receta = await obtenerRecetaActiva(
                    cliente,
                    producto.productos_id
                );

                const costoTotalReceta = await calcularCostoReceta(
                    cliente,
                    receta,
                    cantidad
                );

                costoUnitario = costoTotalReceta / cantidad;
            }

            const totalLinea = redondear(
                precioUnitario * cantidad
            );

            subtotal += totalLinea;
            costoTotal += costoUnitario * cantidad;

            items.push({
                producto,
                cantidad,
                precioUnitario,
                costoUnitario,
                totalLinea
            });
        }

        subtotal = redondear(subtotal);

        const descuento = 0;
        const impuesto = 0;

        const total = redondear(
            subtotal - descuento + impuesto
        );

        // ----------------------------------------------------
        // INSERTAR ENCABEZADO
        // ----------------------------------------------------

        const resultadoVenta = await cliente.query(
            `
            INSERT INTO ventas.ventas (
                usuario_id,
                subtotal,
                descuento,
                impuesto,
                total,
                metodo_pago,
                estado,
                observacion,
                mesa_numero
            )
            VALUES (
                $1, $2, $3, $4, $5, $6,
                'finalizada', $7, $8
            )
            RETURNING
                ventas_id,
                usuario_id,
                subtotal,
                descuento,
                impuesto,
                total,
                metodo_pago,
                estado,
                observacion,
                mesa_numero,
                created_at
            `,
            [
                usuarioId,
                subtotal,
                descuento,
                impuesto,
                total,
                metodoPago,
                datos.observacion || null,
                mesaNumero
            ]
        );

        const venta = resultadoVenta.rows[0];

        // ----------------------------------------------------
        // INSERTAR DETALLES
        //
        // Los triggers de PostgreSQL validan y descuentan
        // el inventario. Si uno falla, se revierte la venta.
        // ----------------------------------------------------

        for (const item of items) {
            const {
                producto,
                cantidad,
                precioUnitario,
                costoUnitario,
                totalLinea
            } = item;

            await cliente.query(
                `
                INSERT INTO ventas.venta_detalle (
                    venta_id,
                    producto_id,
                    cantidad,
                    precio_unitario,
                    costo_unitario,
                    total_linea
                )
                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [
                    venta.ventas_id,
                    producto.productos_id,
                    cantidad,
                    precioUnitario,
                    costoUnitario,
                    totalLinea
                ]
            );
        }

        await cliente.query("COMMIT");
        transaccionIniciada = false;

        return {
            ...venta,
            costo_total_estimado: redondear(costoTotal)
        };
    } catch (error) {
        console.error(
            "[VENTAS] Error al crear la venta:",
            {
                message: error.message,
                code: error.code || null,
                detail: error.detail || null,
                constraint: error.constraint || null,
                schema: error.schema || null,
                table: error.table || null,
                column: error.column || null,
                where: error.where || null,
                stack: error.stack || null
            }
        );

        if (transaccionIniciada) {
            try {
                await cliente.query("ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "[VENTAS] Error al ejecutar ROLLBACK:",
                    rollbackError.message
                );
            }
        }

        /*
         * Los errores de restricciones de PostgreSQL se
         * registran con sus detalles en el servidor. Se
         * devuelve un error controlado al cliente para no
         * exponer detalles internos de la base de datos.
         */
        if (error.code === "23514") {
            throw crearError(
                "No se pudo registrar la venta debido a una " +
                "regla de integridad del inventario. " +
                "Revisa los registros del servidor.",
                409
            );
        }

        if (error.code === "23503") {
            throw crearError(
                "La venta contiene una referencia a un registro " +
                "que no existe o que ya no está disponible.",
                409
            );
        }

        throw error;
    } finally {
        cliente.release();
    }
}

// ============================================================
// EXPORTACIONES
// ============================================================

module.exports = {
    listarProductos,
    listarVentas,
    obtenerVenta,
    crearVenta
};
