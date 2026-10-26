"use strict";

const pool = require("../db");

const TIPOS_PRODUCTO = new Set([
    "insumo", "botella", "trago_preparado", "servicio"
]);

const UNIDADES = new Set([
    "unidad", "ml", "litro", "gramo", "kilogramo"
]);

const POSITIVOS = new Set([
    "entrada", "ajuste_entrada", "devolucion"
]);

const NEGATIVOS = new Set([
    "salida", "ajuste_salida"
]);

const TIPOS_MOVIMIENTO = new Set([...POSITIVOS, ...NEGATIVOS]);
const TIPOS_CON_INVENTARIO = new Set(["insumo", "botella"]);

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EPSILON = 0.0001;

// ============================================================
// VALIDACIONES Y ERRORES
// ============================================================

function errorValidacion(mensaje, status = 400) {
    const error = new Error(mensaje);
    error.status = status;
    error.esValidacion = true;
    return error;
}

function validarUUID(valor, nombre, { opcional = false } = {}) {
    if (
        opcional &&
        (valor === undefined || valor === null || valor === "")
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
    const { minimo, maximo, entero, opcional } = opciones;

    if (valor === undefined || valor === null || String(valor).trim() === "") {
        if (opcional) return null;
        throw errorValidacion(`${nombre} es obligatorio.`);
    }

    const resultado = Number(valor);

    if (!Number.isFinite(resultado)) {
        throw errorValidacion(`${nombre} debe ser un número válido.`);
    }

    if (minimo !== undefined && resultado < minimo) {
        throw errorValidacion(`${nombre} debe ser como mínimo ${minimo}.`);
    }

    if (maximo !== undefined && resultado > maximo) {
        throw errorValidacion(`${nombre} no puede superar ${maximo}.`);
    }

    if (entero && !Number.isInteger(resultado)) {
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
        opciones.maximo !== undefined &&
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
            'Los productos de tipo "botella" deben utilizar "ml".'
        );
    }

    if (
        ["trago_preparado", "servicio"].includes(tipo) &&
        unidad !== "unidad"
    ) {
        throw errorValidacion(
            'Los tragos preparados y servicios deben utilizar "unidad".'
        );
    }
}

function obtenerCategoriaId(datos, valorActual = null) {
    if (!Object.prototype.hasOwnProperty.call(datos, "categoria_id")) {
        return valorActual;
    }

    return validarUUID(datos.categoria_id, "La categoría", {
        opcional: true
    });
}

function costoEnviado(datos, predeterminado, nombre) {
    const valor =
        datos.costo_compra ??
        datos.costo_unitario ??
        datos.costo;

    return numero(
        valor === undefined || valor === null || String(valor).trim() === ""
            ? predeterminado
            : valor,
        nombre,
        { minimo: 0 }
    );
}

function traducirErrorBD(error) {
    if (!error || error.esValidacion) return error;

    const errores = {
        "23505": ["Ya existe un registro con esos datos.", 409],
        "23503": [
            "No se puede completar la operación porque el registro está relacionado con otros datos.",
            409
        ],
        "23514": [
            "Los datos enviados no cumplen las validaciones de la base de datos.",
            400
        ],
        "22P02": [
            "Los datos enviados tienen un formato no válido.",
            400
        ],
        "22003": [
            "Uno de los valores numéricos está fuera del rango permitido.",
            400
        ],
        "22001": [
            "Uno de los campos supera la longitud permitida.",
            400
        ],
        "23502": ["Falta un dato obligatorio.", 400],
        "40001": [
            "La operación tuvo un conflicto de concurrencia. Inténtalo nuevamente.",
            409
        ],
        "40P01": [
            "La operación tuvo un conflicto de concurrencia. Inténtalo nuevamente.",
            409
        ],
        ECONNREFUSED: [
            "No fue posible comunicarse con la base de datos.",
            503
        ],
        ECONNRESET: [
            "Se perdió la conexión con la base de datos.",
            503
        ],
        ETIMEDOUT: [
            "La conexión con la base de datos agotó el tiempo de espera.",
            503
        ]
    };

    const traducido = errores[error.code];

    return traducido
        ? errorValidacion(traducido[0], traducido[1])
        : error;
}

// ============================================================
// BASE DE DATOS
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
        } catch (rollbackError) {
            console.error("Error al revertir la transacción:", rollbackError);
        }

        const traducido = traducirErrorBD(error);

        if (traducido === error) {
            console.error("Error en inventario:", error);
        }

        throw traducido;
    } finally {
        client.release();
    }
}

async function consultar(sql, parametros = []) {
    try {
        return await pool.query(sql, parametros);
    } catch (error) {
        const traducido = traducirErrorBD(error);

        if (traducido === error) {
            console.error("Error en consulta de inventario:", error);
        }

        throw traducido;
    }
}

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

    if (!rows.length) {
        throw errorValidacion("El producto solicitado no existe.", 404);
    }

    return rows[0];
}

async function validarProveedorActivo(client, proveedorId) {
    if (!proveedorId) return;

    const { rowCount } = await client.query(
        `
        SELECT proveedores_id
        FROM catalogo.proveedores
        WHERE proveedores_id = $1 AND activo = TRUE
        `,
        [proveedorId]
    );

    if (!rowCount) {
        throw errorValidacion(
            "El proveedor no existe o está inactivo."
        );
    }
}

async function productoTieneReferencias(client, productoId) {
    const { rows } = await client.query(
        `
        SELECT
            EXISTS (
                SELECT 1 FROM inventario.movimientos_stock
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1 FROM inventario.envases
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1 FROM catalogo.receta_detalle
                WHERE insumo_id = $1
            )
            OR EXISTS (
                SELECT 1 FROM catalogo.recetas
                WHERE producto_id = $1
            )
            OR EXISTS (
                SELECT 1 FROM ventas.venta_detalle
                WHERE producto_id = $1
            ) AS tiene_referencias
        `,
        [productoId]
    );

    return rows[0].tiene_referencias;
}

async function validarCategoriaActiva(client, categoriaId) {
    if (!categoriaId) return;

    const { rowCount } = await client.query(
        `
        SELECT categorias_id
        FROM catalogo.categorias
        WHERE categorias_id = $1 AND activo = TRUE
        `,
        [categoriaId]
    );

    if (!rowCount) {
        throw errorValidacion(
            "La categoría seleccionada no existe o está inactiva."
        );
    }
}

// ============================================================
// RESUMEN, CATEGORÍAS Y PROVEEDORES
// ============================================================

async function obtenerResumen() {
    const { rows } = await consultar(`
        WITH stock AS (
            SELECT
                productos_id,
                stock_actual,
                stock_minimo,
                tipo,
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
                  AND tipo IN ('insumo', 'botella')
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
                    SUM(stock_actual * COALESCE(costo_promedio, 0)), 0
                )
                FROM stock
                WHERE activo = TRUE
                  AND tipo IN ('insumo', 'botella')
            ) AS valor_inventario
    `);

    return rows[0];
}

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
                p.stock_minimo - COALESCE(s.stock_actual, 0), 0
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
    const unidad = texto(datos.unidad_medida, "La unidad de medida", {
        requerido: true
    });

    validarUnidadYTipo(tipo, unidad);

    if (tipo === "trago_preparado") {
        throw errorValidacion(
            "Los tragos preparados se crean desde la gestión de recetas."
        );
    }

    const precio = numero(datos.precio ?? 0, "El precio", { minimo: 0 });
    const costo = numero(
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
        await validarCategoriaActiva(client, categoriaId);

        const { rows } = await client.query(
            `
            INSERT INTO catalogo.productos (
                categoria_id, nombre, tipo, unidad_medida,
                precio, costo_promedio, stock_minimo, activo
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
            RETURNING *
            `,
            [
                categoriaId, nombre, tipo, unidad,
                precio, costo, stockMinimo
            ]
        );

        return rows[0];
    });
}

async function crearProductoConEntrada(datos = {}, usuarioId) {
    const nombre = texto(datos.nombre, "El nombre", {
        requerido: true,
        maximo: 150
    });
    const tipo = texto(datos.tipo, "El tipo", { requerido: true });
    const unidad = texto(datos.unidad_medida, "La unidad de medida", {
        requerido: true
    });

    validarUnidadYTipo(tipo, unidad);

    if (!TIPOS_CON_INVENTARIO.has(tipo)) {
        throw errorValidacion(
            "El producto nuevo debe ser un insumo o una botella."
        );
    }

    const precio = numero(datos.precio ?? 0, "El precio", { minimo: 0 });
    const stockMinimo = numero(
        datos.stock_minimo ?? 0,
        "El stock mínimo",
        { minimo: 0 }
    );
    const categoriaId = obtenerCategoriaId(datos);
    const idUsuario = validarUUID(usuarioId, "El usuario");

    return transaccion(async (client) => {
        await validarCategoriaActiva(client, categoriaId);

        const { rows } = await client.query(
            `
            INSERT INTO catalogo.productos (
                categoria_id, nombre, tipo, unidad_medida,
                precio, costo_promedio, stock_minimo, activo
            )
            VALUES ($1, $2, $3, $4, $5, 0, $6, TRUE)
            RETURNING *
            `,
            [
                categoriaId, nombre, tipo, unidad,
                precio, stockMinimo
            ]
        );

        const productoId = rows[0].productos_id;
        const movimiento = prepararMovimiento({
            ...datos,
            producto_id: productoId,
            tipo: "entrada"
        });
        const producto = await obtenerProductoBloqueado(
            client,
            productoId
        );
        const resultadoMovimiento = await ejecutarMovimiento(
            client,
            movimiento,
            idUsuario,
            producto
        );
        const { rows: productoActualizado } = await client.query(
            `
            SELECT *
            FROM catalogo.productos
            WHERE productos_id = $1
            `,
            [productoId]
        );

        return {
            producto: productoActualizado[0],
            movimiento: resultadoMovimiento
        };
    });
}

async function actualizarProducto(productoId, datos = {}) {
    const id = validarUUID(productoId, "El producto");

    return transaccion(async (client) => {
        const actual = await obtenerProductoBloqueado(client, id);

        const nombre = Object.hasOwn(datos, "nombre")
            ? texto(datos.nombre, "El nombre", {
                requerido: true,
                maximo: 150
            })
            : actual.nombre;

        const tipo = Object.hasOwn(datos, "tipo")
            ? texto(datos.tipo, "El tipo", { requerido: true })
            : actual.tipo;

        const unidad = Object.hasOwn(datos, "unidad_medida")
            ? texto(datos.unidad_medida, "La unidad de medida", {
                requerido: true
            })
            : actual.unidad_medida;

        validarUnidadYTipo(tipo, unidad);

        if (
            (tipo !== actual.tipo || unidad !== actual.unidad_medida) &&
            await productoTieneReferencias(client, id)
        ) {
            throw errorValidacion(
                "No se puede cambiar el tipo o la unidad de un producto que ya tiene movimientos, envases, recetas o ventas."
            );
        }

        const precio = numero(
            datos.precio ?? actual.precio,
            "El precio",
            { minimo: 0 }
        );

        const costo = numero(
            datos.costo_promedio ?? actual.costo_promedio,
            "El costo promedio",
            { minimo: 0 }
        );

        const stockMinimo = numero(
            datos.stock_minimo ?? actual.stock_minimo,
            "El stock mínimo",
            { minimo: 0 }
        );

        const categoriaId = obtenerCategoriaId(
            datos,
            actual.categoria_id
        );

        await validarCategoriaActiva(client, categoriaId);

        const { rows } = await client.query(
            `
            UPDATE catalogo.productos
            SET categoria_id = $2,
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
                id, categoriaId, nombre, tipo,
                unidad, precio, costo, stockMinimo
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
        SET activo = $2,
            updated_at = NOW()
        WHERE productos_id = $1
        RETURNING *
        `,
        [id, activo]
    );

    if (!rows.length) {
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
                WHEN 'vendida' THEN 3
                ELSE 4
            END,
            e.contenido_actual_ml,
            e.created_at
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
    tipo,
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

    if (POSITIVOS.has(tipo)) {
        if (!Number.isInteger(cantidad)) {
            throw errorValidacion(
                "La cantidad de envases que ingresan debe ser un número entero."
            );
        }

        const contenido = numero(
            datos.contenido_inicial_ml,
            "El contenido inicial de cada botella",
            { minimo: Number.EPSILON }
        );

        const stockAnterior = Number(producto.stock_actual || 0);
        const costoAnterior = Number(producto.costo_promedio || 0);
        const costoEnvase = costoEnviado(
            datos,
            costoAnterior * contenido,
            "El costo de cada botella"
        );
        const costoMl = costoEnvase / contenido;
        const movimientos = [];

        for (let i = 0; i < cantidad; i += 1) {
            const { rows: envases } = await client.query(
                `
                INSERT INTO inventario.envases (
                    producto_id, proveedor_id,
                    contenido_inicial_ml, contenido_actual_ml,
                    estado, costo_compra, observacion
                )
                VALUES ($1, $2, $3, $3, 'cerrada', $4, $5)
                RETURNING envases_id
                `,
                [
                    productoId, proveedorId, contenido,
                    costoEnvase, observacion
                ]
            );

            const { rows } = await client.query(
                `
                INSERT INTO inventario.movimientos_stock (
                    producto_id, usuario_id, proveedor_id,
                    envase_id, tipo, cantidad, costo, observacion
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                `,
                [
                    productoId,
                    usuarioId,
                    proveedorId,
                    envases[0].envases_id,
                    tipo,
                    contenido,
                    costoMl,
                    observacion
                ]
            );

            movimientos.push(rows[0]);
        }

        const stockNuevo = stockAnterior + cantidad * contenido;
        const costoNuevo = stockNuevo > 0
            ? (
                stockAnterior * costoAnterior +
                cantidad * contenido * costoMl
            ) / stockNuevo
            : costoMl;

        await client.query(
            `
            UPDATE catalogo.productos
            SET costo_promedio = $2,
                updated_at = NOW()
            WHERE productos_id = $1
            `,
            [productoId, costoNuevo]
        );

        return {
            producto_id: productoId,
            tipo,
            envases_registrados: cantidad,
            cantidad_ml: cantidad * contenido,
            movimientos
        };
    }

    if (!NEGATIVOS.has(tipo)) {
        throw errorValidacion(
            "El tipo de movimiento no está permitido para botellas."
        );
    }

    const { rows: envases } = await client.query(
        `
        SELECT envases_id, contenido_actual_ml, estado
        FROM inventario.envases
        WHERE producto_id = $1
          AND estado IN ('abierta', 'cerrada')
          AND contenido_actual_ml > 0
        ORDER BY
            CASE WHEN estado = 'abierta' THEN 0 ELSE 1 END,
            contenido_actual_ml,
            created_at,
            envases_id
        FOR UPDATE
        `,
        [productoId]
    );

    const disponible = envases.reduce(
        (suma, e) => suma + Number(e.contenido_actual_ml),
        0
    );

    if (disponible + EPSILON < cantidad) {
        throw errorValidacion(
            `Contenido insuficiente. Disponible: ${disponible} ml; solicitado: ${cantidad} ml.`
        );
    }

    let restante = cantidad;
    const movimientos = [];

    for (const envase of envases) {
        if (restante <= 0) break;

        const contenido = Number(envase.contenido_actual_ml);
        const descontar = Math.min(restante, contenido);

        await client.query(
            `
            UPDATE inventario.envases
            SET
                contenido_actual_ml = CASE
                    WHEN contenido_actual_ml <= $2 THEN 0
                    ELSE contenido_actual_ml - $2
                END,
                estado = CASE
                    WHEN contenido_actual_ml <= $2 THEN 'vacia'
                    ELSE 'abierta'
                END,
                fecha_apertura = COALESCE(fecha_apertura, NOW()),
                updated_at = NOW()
            WHERE envases_id = $1
            `,
            [envase.envases_id, descontar]
        );

        const { rows } = await client.query(
            `
            INSERT INTO inventario.movimientos_stock (
                producto_id, usuario_id, proveedor_id,
                envase_id, tipo, cantidad, costo, observacion
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            `,
            [
                productoId,
                usuarioId,
                proveedorId,
                envase.envases_id,
                tipo,
                descontar,
                Number(producto.costo_promedio || 0),
                observacion
            ]
        );

        movimientos.push(rows[0]);
        restante -= descontar;
    }

    if (restante > EPSILON) {
        throw errorValidacion(
            "No fue posible completar la salida con el contenido disponible."
        );
    }

    return {
        producto_id: productoId,
        tipo,
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
    tipo,
    cantidad,
    proveedorId,
    observacion
) {
    if (producto.tipo !== "insumo") {
        throw errorValidacion(
            "Solo los productos de tipo insumo admiten movimientos ordinarios."
        );
    }

    if (
        producto.unidad_medida === "unidad" &&
        !Number.isInteger(cantidad)
    ) {
        throw errorValidacion(
            "La cantidad debe ser entera cuando la unidad de medida es unidad."
        );
    }

    const stock = Number(producto.stock_actual || 0);
    const esPositivo = POSITIVOS.has(tipo);
    const esNegativo = NEGATIVOS.has(tipo);

    if (!esPositivo && !esNegativo) {
        throw errorValidacion("El tipo de movimiento no está permitido.");
    }

    if (esNegativo && stock + EPSILON < cantidad) {
        throw errorValidacion(
            `Existencias insuficientes. Disponible: ${stock} ${producto.unidad_medida}; solicitado: ${cantidad} ${producto.unidad_medida}.`
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
            producto_id, usuario_id, proveedor_id,
            tipo, cantidad, costo, observacion
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
            producto.productos_id,
            usuarioId,
            proveedorId,
            tipo,
            cantidad,
            costo,
            observacion
        ]
    );

    if (esPositivo) {
        const stockNuevo = stock + cantidad;
        const costoAnterior = Number(producto.costo_promedio || 0);

        const costoNuevo = stockNuevo > 0
            ? (
                stock * costoAnterior + cantidad * costo
            ) / stockNuevo
            : costo;

        await client.query(
            `
            UPDATE catalogo.productos
            SET costo_promedio = $2,
                updated_at = NOW()
            WHERE productos_id = $1
            `,
            [producto.productos_id, costoNuevo]
        );
    }

    return rows[0];
}

function prepararMovimiento(datos = {}) {
    const productoId = validarUUID(datos.producto_id, "El producto");
    const tipo = texto(datos.tipo, "El tipo de movimiento", {
        requerido: true
    });

    if (!TIPOS_MOVIMIENTO.has(tipo)) {
        throw errorValidacion("El tipo de movimiento no está permitido.");
    }

    const entrada = tipo === "entrada";
    const cajas = entrada
        ? numero(datos.cajas, "La cantidad de cajas", {
            minimo: 1,
            maximo: 999999999,
            entero: true
        })
        : null;
    const unidadesPorCaja = entrada
        ? numero(datos.unidades_por_caja, "Las unidades por caja", {
            minimo: 1,
            maximo: 999999999,
            entero: true
        })
        : null;
    const cantidad = entrada
        ? numero(cajas * unidadesPorCaja, "El total de unidades", {
            minimo: 1,
            maximo: 999999999,
            entero: true
        })
        : numero(datos.cantidad, "La cantidad", {
            minimo: Number.EPSILON
        });
    const proveedorId = validarUUID(
        datos.proveedor_id,
        "El proveedor",
        { opcional: !entrada }
    );
    const nota = texto(datos.observacion, "La observación", {
        maximo: 1000
    });
    const costoPorCaja = entrada
        ? numero(datos.costo_por_caja, "El costo por caja", {
            minimo: 0
        })
        : null;
    const costoUnitario = entrada
        ? costoPorCaja / unidadesPorCaja
        : null;

    if (entrada && !Number.isFinite(costoUnitario)) {
        throw errorValidacion("El costo por caja no es válido.");
    }

    const observacion = entrada
        ? `Compra: ${cajas} cajas × ${unidadesPorCaja} unidades/caja = ${cantidad} unidades; costo por caja: $${costoPorCaja.toFixed(2)}.${nota ? ` ${nota}` : ""}`
        : nota;
    const datosMovimiento = entrada
        ? {
            ...datos,
            costo_compra: costoUnitario,
            costo_unitario: costoUnitario,
            costo: costoUnitario
        }
        : datos;

    return {
        productoId,
        tipo,
        cantidad,
        proveedorId,
        observacion,
        datos: datosMovimiento
    };
}

async function ejecutarMovimiento(client, movimiento, usuarioId, producto) {
    const {
        tipo,
        cantidad,
        proveedorId,
        observacion,
        datos
    } = movimiento;

    await validarProveedorActivo(client, proveedorId);

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

    const argumentos = [
        client,
        datos,
        usuarioId,
        producto,
        tipo,
        cantidad,
        proveedorId,
        observacion
    ];

    return producto.tipo === "botella"
        ? registrarMovimientoBotella(...argumentos)
        : registrarMovimientoInsumo(...argumentos);
}

async function registrarMovimiento(datos = {}, usuarioId) {
    const movimiento = prepararMovimiento(datos);
    const idUsuario = usuarioId
        ? validarUUID(usuarioId, "El usuario")
        : null;

    return transaccion(async (client) => {
        const producto = await obtenerProductoBloqueado(
            client,
            movimiento.productoId
        );

        return ejecutarMovimiento(
            client,
            movimiento,
            idUsuario,
            producto
        );
    });
}

// ============================================================
// RECETAS
// ============================================================

function normalizarIngredientes(ingredientes) {
    if (!Array.isArray(ingredientes) || !ingredientes.length) {
        throw errorValidacion(
            "La receta debe tener al menos un ingrediente."
        );
    }

    const vistos = new Set();

    return ingredientes.map((item, i) => {
        if (!item || typeof item !== "object") {
            throw errorValidacion(
                `El ingrediente de la fila ${i + 1} no es válido.`
            );
        }

        const id = validarUUID(
            item.insumo_id || item.producto_id,
            `El producto ingrediente de la fila ${i + 1}`
        );

        if (vistos.has(id.toLowerCase())) {
            throw errorValidacion(
                "No repitas el mismo producto en una receta. Suma sus cantidades."
            );
        }

        vistos.add(id.toLowerCase());

        return {
            insumo_id: id,
            cantidad: numero(item.cantidad, `La cantidad del ingrediente ${i + 1}`, {
                minimo: Number.EPSILON
            })
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

        if (!rows.length) {
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
    for (const item of ingredientes) {
        await client.query(
            `
            INSERT INTO catalogo.receta_detalle (
                receta_id, insumo_id, cantidad
            )
            VALUES ($1, $2, $3)
            `,
            [
                recetaId,
                item.insumo_id,
                item.cantidad
            ]
        );
    }
}

async function obtenerRecetas() {
    const { rows } = await consultar(`
        SELECT
            r.recetas_id,
            r.producto_id,
            p.nombre AS producto,
            p.activo AS producto_activo,
            r.descripcion,
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
                            'cantidad', rd.cantidad
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

async function crearReceta(datos = {}) {
    const productoNuevo = datos.producto_nuevo;
    let productoId = null;

    if (productoNuevo !== undefined && productoNuevo !== null) {
        if (
            typeof productoNuevo !== "object" ||
            Array.isArray(productoNuevo)
        ) {
            throw errorValidacion(
                "Los datos del nuevo trago preparado no son válidos."
            );
        }

        productoNuevo.nombre = texto(
            productoNuevo.nombre,
            "El nombre del trago preparado",
            { requerido: true, maximo: 150 }
        );
        productoNuevo.categoria_id = validarUUID(
            productoNuevo.categoria_id,
            "La categoría del trago preparado"
        );
        productoNuevo.precio = numero(
            productoNuevo.precio,
            "El precio del trago preparado",
            { minimo: 0 }
        );
    } else {
        productoId = validarUUID(
            datos.producto_id,
            "El producto preparado"
        );
    }

    const descripcion = texto(datos.descripcion, "La descripción", {
        maximo: 1000
    });

    const ingredientes = normalizarIngredientes(datos.ingredientes);

    return transaccion(async (client) => {
        if (productoNuevo) {
            await validarCategoriaActiva(
                client,
                productoNuevo.categoria_id
            );

            const { rows: productos } = await client.query(
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
                VALUES ($1, $2, 'trago_preparado', 'unidad', $3, 0, 0, TRUE)
                RETURNING productos_id
                `,
                [
                    productoNuevo.categoria_id,
                    productoNuevo.nombre,
                    productoNuevo.precio
                ]
            );

            productoId = productos[0].productos_id;
        }

        const { rows } = await client.query(
            `
            SELECT productos_id, nombre, tipo, activo
            FROM catalogo.productos
            WHERE productos_id = $1
            FOR UPDATE
            `,
            [productoId]
        );

        if (!rows.length) {
            throw errorValidacion(
                "El producto preparado no existe.",
                404
            );
        }

        const producto = rows[0];

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

        if (existente.rowCount) {
            throw errorValidacion(
                "Este producto ya tiene una receta. Utiliza la opción de editar.",
                409
            );
        }

        const { rows: recetas } = await client.query(
            `
            INSERT INTO catalogo.recetas (
                producto_id, descripcion, activa
            )
            VALUES ($1, $2, TRUE)
            RETURNING *
            `,
            [productoId, descripcion]
        );

        const receta = recetas[0];

        await insertarIngredientes(
            client,
            receta.recetas_id,
            ingredientes
        );

        return receta;
    });
}

async function actualizarReceta(recetaId, datos = {}) {
    const id = validarUUID(recetaId, "La receta");

    const descripcion = texto(datos.descripcion, "La descripción", {
        maximo: 1000
    });

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

        if (!rows.length) {
            throw errorValidacion(
                "La receta solicitada no existe.",
                404
            );
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
                updated_at = NOW()
            WHERE recetas_id = $1
            `,
            [id, descripcion]
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
            activa: receta.activa
        };
    });
}

async function desactivarReceta(recetaId) {
    const id = validarUUID(recetaId, "La receta");

    const { rows } = await consultar(
        `
        UPDATE catalogo.recetas
        SET activa = FALSE,
            updated_at = NOW()
        WHERE recetas_id = $1
        RETURNING *
        `,
        [id]
    );

    if (!rows.length) {
        throw errorValidacion(
            "La receta solicitada no existe.",
            404
        );
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
    crearProductoConEntrada,
    actualizarProducto,
    cambiarEstadoProducto,

    obtenerEnvases,
    registrarMovimiento,

    obtenerRecetas,
    crearReceta,
    actualizarReceta,
    desactivarReceta
};
