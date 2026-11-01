CREATE DATABASE Biox_OLTP;
\connect biox_oltp

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE SCHEMA catalogo;
CREATE SCHEMA comun;
CREATE SCHEMA experiencia;
CREATE SCHEMA inventario;
CREATE SCHEMA operaciones;
CREATE SCHEMA seguridad;
CREATE SCHEMA ventas;

CREATE TYPE seguridad.user_role AS ENUM (
    'administrador',
    'barra',
    'bodega',
    'pendiente'
);

CREATE TABLE catalogo.categorias (
    categorias_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre varchar(100) NOT NULL UNIQUE,
    descripcion text,
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT categorias_nombre_check CHECK (length(trim(nombre)) > 0)
);

CREATE TABLE catalogo.productos (
    productos_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    categoria_id uuid NOT NULL,
    nombre varchar(150) NOT NULL,
    tipo varchar(30) NOT NULL DEFAULT 'botella',
    unidad_medida varchar(20) NOT NULL DEFAULT 'unidad',
    precio numeric(12,2) NOT NULL DEFAULT 0,
    costo_promedio numeric(12,4) NOT NULL DEFAULT 0,
    stock_minimo numeric(12,3) NOT NULL DEFAULT 0,
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT productos_nombre_check CHECK (length(trim(nombre)) > 0),
    CONSTRAINT productos_tipo_check CHECK (tipo IN ('insumo', 'botella', 'trago_preparado', 'servicio')),
    CONSTRAINT productos_unidad_medida_check CHECK (unidad_medida IN ('unidad', 'ml', 'litro', 'gramo', 'kilogramo')),
    CONSTRAINT productos_precio_check CHECK (precio >= 0),
    CONSTRAINT productos_costo_promedio_check CHECK (costo_promedio >= 0),
    CONSTRAINT productos_stock_minimo_check CHECK (stock_minimo >= 0)
);

CREATE TABLE catalogo.proveedores (
    proveedores_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre varchar(150) NOT NULL,
    nit varchar(30) UNIQUE,
    nrc varchar(30) UNIQUE,
    razon_social_denominacion varchar(180),
    telefono varchar(30),
    email varchar(254),
    ubicacion varchar(250),
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT proveedores_nombre_check CHECK (length(trim(nombre)) > 0),
    CONSTRAINT proveedores_nit_check CHECK (nit IS NULL OR length(trim(nit)) > 0),
    CONSTRAINT proveedores_nrc_check CHECK (nrc IS NULL OR length(trim(nrc)) > 0)
);

CREATE TABLE catalogo.recetas (
    recetas_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_id uuid NOT NULL UNIQUE,
    descripcion text,
    activa boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalogo.receta_detalle (
    receta_detalle_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    receta_id uuid NOT NULL,
    insumo_id uuid NOT NULL,
    cantidad numeric(12,3) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT receta_detalle_cantidad_check CHECK (cantidad > 0),
    CONSTRAINT receta_detalle_receta_insumo_key UNIQUE (receta_id, insumo_id)
);

CREATE TABLE seguridad.usuarios (
    usuarios_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre varchar(120) NOT NULL,
    telefono varchar(30),
    email varchar(254) UNIQUE,
    password_hash text NOT NULL,
    role seguridad.user_role NOT NULL DEFAULT 'pendiente',
    activo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT usuarios_nombre_check CHECK (length(trim(nombre)) > 0)
);

CREATE TABLE ventas.ventas (
    ventas_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    usuario_id uuid NOT NULL,
    subtotal numeric(12,2) NOT NULL DEFAULT 0,
    descuento numeric(12,2) NOT NULL DEFAULT 0,
    impuesto numeric(12,2) NOT NULL DEFAULT 0,
    total numeric(12,2) NOT NULL DEFAULT 0,
    metodo_pago varchar(20) NOT NULL DEFAULT 'efectivo',
    estado varchar(20) NOT NULL DEFAULT 'finalizada',
    observacion text,
    mesa_numero integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ventas_subtotal_check CHECK (subtotal >= 0),
    CONSTRAINT ventas_descuento_check CHECK (descuento >= 0),
    CONSTRAINT ventas_impuesto_check CHECK (impuesto >= 0),
    CONSTRAINT ventas_total_check CHECK (total >= 0),
    CONSTRAINT ventas_estado_check CHECK (estado IN ('finalizada', 'anulada')),
    CONSTRAINT ventas_metodo_pago_check CHECK (metodo_pago IN ('efectivo', 'tarjeta', 'transferencia', 'otro')),
    CONSTRAINT ventas_mesa_numero_check CHECK (mesa_numero IS NULL OR mesa_numero > 0)
);

CREATE TABLE ventas.venta_detalle (
    venta_detalle_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    venta_id uuid NOT NULL,
    producto_id uuid NOT NULL,
    cantidad numeric(12,3) NOT NULL,
    precio_unitario numeric(12,2) NOT NULL,
    costo_unitario numeric(12,2) NOT NULL DEFAULT 0,
    total_linea numeric(12,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT venta_detalle_cantidad_check CHECK (cantidad > 0),
    CONSTRAINT venta_detalle_precio_check CHECK (precio_unitario >= 0),
    CONSTRAINT venta_detalle_costo_check CHECK (costo_unitario >= 0),
    CONSTRAINT venta_detalle_total_check CHECK (total_linea >= 0)
);

CREATE TABLE inventario.envases (
    envases_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_id uuid NOT NULL,
    proveedor_id uuid,
    contenido_inicial_ml numeric(12,3) NOT NULL,
    contenido_actual_ml numeric(12,3) NOT NULL,
    estado varchar(10) NOT NULL DEFAULT 'cerrada',
    fecha_apertura timestamptz,
    costo_compra numeric(12,4) NOT NULL DEFAULT 0,
    observacion text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT envases_check CHECK (contenido_actual_ml >= 0 AND contenido_actual_ml <= contenido_inicial_ml),
    CONSTRAINT envases_contenido_inicial_ml_check CHECK (contenido_inicial_ml > 0),
    CONSTRAINT envases_costo_compra_check CHECK (costo_compra >= 0),
    CONSTRAINT envases_estado_check CHECK (estado IN ('cerrada', 'abierta', 'vacia', 'baja', 'vendida')),
    CONSTRAINT envases_estado_contenido_check CHECK (
        (estado = 'vacia' AND contenido_actual_ml = 0)
        OR (estado IN ('cerrada', 'abierta') AND contenido_actual_ml > 0)
        OR estado = 'baja'
        OR (estado = 'vendida' AND contenido_actual_ml > 0)
    )
);

CREATE TABLE inventario.movimientos_stock (
    movimientos_stock_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    producto_id uuid NOT NULL,
    usuario_id uuid,
    proveedor_id uuid,
    venta_id uuid,
    tipo varchar(30) NOT NULL,
    cantidad numeric(12,3) NOT NULL,
    costo numeric(12,4) NOT NULL DEFAULT 0,
    observacion text,
    created_at timestamptz NOT NULL DEFAULT now(),
    envase_id uuid,
    reversa_de_movimiento_id uuid,
    unidad_medida varchar(20),
    CONSTRAINT movimientos_stock_cantidad_check CHECK (cantidad > 0),
    CONSTRAINT movimientos_stock_costo_check CHECK (costo >= 0),
    CONSTRAINT movimientos_stock_tipo_check CHECK (tipo IN ('entrada', 'salida', 'ajuste_entrada', 'ajuste_salida', 'devolucion', 'consumo_receta'))
);

CREATE TABLE operaciones.registros_afluencia (
    registros_afluencia_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    usuario_id uuid,
    tipo_movimiento varchar(10) NOT NULL,
    cantidad integer NOT NULL DEFAULT 1,
    observacion text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT afluencia_cantidad_check CHECK (cantidad > 0),
    CONSTRAINT afluencia_tipo_check CHECK (tipo_movimiento IN ('entrada', 'salida'))
);

CREATE TABLE experiencia.satisfaccion_encuestas (
    satisfaccion_encuestas_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    venta_id uuid,
    mesa_numero integer,
    calificacion_general smallint NOT NULL,
    ambiente smallint NOT NULL,
    musica smallint NOT NULL,
    atencion smallint NOT NULL,
    seguridad smallint NOT NULL,
    limpieza smallint NOT NULL,
    tiempo_espera smallint NOT NULL,
    recomendacion smallint NOT NULL,
    comentario text,
    canal varchar(20) NOT NULL DEFAULT 'qr',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT satisfaccion_calificacion_general_check CHECK (calificacion_general BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_ambiente_check CHECK (ambiente BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_musica_check CHECK (musica BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_atencion_check CHECK (atencion BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_seguridad_check CHECK (seguridad BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_limpieza_check CHECK (limpieza BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_tiempo_espera_check CHECK (tiempo_espera BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_recomendacion_check CHECK (recomendacion BETWEEN 1 AND 5),
    CONSTRAINT satisfaccion_canal_check CHECK (canal IN ('qr', 'web', 'manual', 'otro')),
    CONSTRAINT satisfaccion_mesa_numero_check CHECK (mesa_numero IS NULL OR mesa_numero > 0)
);

ALTER TABLE catalogo.productos
    ADD CONSTRAINT fk_producto_categoria
    FOREIGN KEY (categoria_id) REFERENCES catalogo.categorias(categorias_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE catalogo.recetas
    ADD CONSTRAINT fk_receta_producto
    FOREIGN KEY (producto_id) REFERENCES catalogo.productos(productos_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE catalogo.receta_detalle
    ADD CONSTRAINT fk_receta_detalle_insumo
    FOREIGN KEY (insumo_id) REFERENCES catalogo.productos(productos_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE catalogo.receta_detalle
    ADD CONSTRAINT fk_receta_detalle_receta
    FOREIGN KEY (receta_id) REFERENCES catalogo.recetas(recetas_id)
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE ventas.ventas
    ADD CONSTRAINT fk_venta_usuario
    FOREIGN KEY (usuario_id) REFERENCES seguridad.usuarios(usuarios_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ventas.venta_detalle
    ADD CONSTRAINT fk_vd_producto
    FOREIGN KEY (producto_id) REFERENCES catalogo.productos(productos_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ventas.venta_detalle
    ADD CONSTRAINT fk_vd_venta
    FOREIGN KEY (venta_id) REFERENCES ventas.ventas(ventas_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE experiencia.satisfaccion_encuestas
    ADD CONSTRAINT fk_satisfaccion_venta
    FOREIGN KEY (venta_id) REFERENCES ventas.ventas(ventas_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE inventario.envases
    ADD CONSTRAINT envases_producto_id_fkey
    FOREIGN KEY (producto_id) REFERENCES catalogo.productos(productos_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE inventario.envases
    ADD CONSTRAINT envases_proveedor_id_fkey
    FOREIGN KEY (proveedor_id) REFERENCES catalogo.proveedores(proveedores_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT fk_mov_producto
    FOREIGN KEY (producto_id) REFERENCES catalogo.productos(productos_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT fk_mov_proveedor
    FOREIGN KEY (proveedor_id) REFERENCES catalogo.proveedores(proveedores_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT fk_mov_usuario
    FOREIGN KEY (usuario_id) REFERENCES seguridad.usuarios(usuarios_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT fk_mov_venta
    FOREIGN KEY (venta_id) REFERENCES ventas.ventas(ventas_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT movimientos_stock_envase_fk
    FOREIGN KEY (envase_id) REFERENCES inventario.envases(envases_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE inventario.movimientos_stock
    ADD CONSTRAINT movimientos_stock_reversa_fk
    FOREIGN KEY (reversa_de_movimiento_id) REFERENCES inventario.movimientos_stock(movimientos_stock_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE operaciones.registros_afluencia
    ADD CONSTRAINT fk_afluencia_usuario
    FOREIGN KEY (usuario_id) REFERENCES seguridad.usuarios(usuarios_id)
    ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX idx_productos_categoria ON catalogo.productos (categoria_id);
CREATE INDEX idx_productos_nombre ON catalogo.productos (nombre);
CREATE INDEX idx_productos_tipo ON catalogo.productos (tipo);
CREATE INDEX idx_proveedores_nombre ON catalogo.proveedores (nombre);
CREATE INDEX idx_receta_detalle_insumo ON catalogo.receta_detalle (insumo_id);
CREATE INDEX idx_receta_detalle_receta ON catalogo.receta_detalle (receta_id);
CREATE INDEX idx_satisfaccion_fecha ON experiencia.satisfaccion_encuestas (created_at);
CREATE INDEX idx_satisfaccion_venta ON experiencia.satisfaccion_encuestas (venta_id);
CREATE INDEX idx_envases_producto_estado ON inventario.envases (producto_id, estado, contenido_actual_ml);
CREATE INDEX idx_envases_proveedor ON inventario.envases (proveedor_id);
CREATE INDEX idx_mov_stock_fecha ON inventario.movimientos_stock (created_at);
CREATE INDEX idx_mov_stock_producto_fecha ON inventario.movimientos_stock (producto_id, created_at);
CREATE INDEX idx_mov_stock_proveedor ON inventario.movimientos_stock (proveedor_id);
CREATE INDEX idx_mov_stock_usuario ON inventario.movimientos_stock (usuario_id);
CREATE INDEX idx_mov_stock_venta ON inventario.movimientos_stock (venta_id);
CREATE INDEX idx_movimientos_stock_envase ON inventario.movimientos_stock (envase_id);
CREATE INDEX idx_movimientos_stock_venta_tipo ON inventario.movimientos_stock (venta_id, tipo);
CREATE UNIQUE INDEX uq_movimientos_stock_reversa
    ON inventario.movimientos_stock (reversa_de_movimiento_id)
    WHERE reversa_de_movimiento_id IS NOT NULL;
CREATE INDEX idx_afluencia_fecha ON operaciones.registros_afluencia (created_at);
CREATE INDEX idx_afluencia_tipo_fecha ON operaciones.registros_afluencia (tipo_movimiento, created_at);
CREATE INDEX idx_usuarios_role ON seguridad.usuarios (role);
CREATE INDEX idx_venta_detalle_producto ON ventas.venta_detalle (producto_id);
CREATE INDEX idx_venta_detalle_venta ON ventas.venta_detalle (venta_id);
CREATE INDEX idx_ventas_fecha_finalizadas ON ventas.ventas (created_at) WHERE estado = 'finalizada';
CREATE INDEX idx_ventas_usuario ON ventas.ventas (usuario_id);

CREATE FUNCTION comun.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION inventario.fn_envases_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION inventario.fn_consumir_receta_venta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id uuid;
    v_estado_venta text;
    v_tipo_producto text;
    v_producto_activo boolean;
    v_receta_id uuid;
    v_det record;
    v_envase record;
    v_consumo numeric(12,3);
    v_restante numeric(12,3);
    v_tomar numeric(12,3);
    v_stock numeric(14,3);
BEGIN
    SELECT v.usuario_id, v.estado::text
    INTO v_usuario_id, v_estado_venta
    FROM ventas.ventas v
    WHERE v.ventas_id = NEW.venta_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la venta asociada al detalle.';
    END IF;

    IF v_estado_venta <> 'finalizada' THEN
        RETURN NEW;
    END IF;

    SELECT p.tipo, p.activo
    INTO v_tipo_producto, v_producto_activo
    FROM catalogo.productos p
    WHERE p.productos_id = NEW.producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto de la venta no existe.';
    END IF;

    IF v_tipo_producto <> 'trago_preparado' THEN
        RETURN NEW;
    END IF;

    IF NOT v_producto_activo THEN
        RAISE EXCEPTION 'No se puede vender un trago preparado inactivo.';
    END IF;

    SELECT r.recetas_id
    INTO v_receta_id
    FROM catalogo.recetas r
    WHERE r.producto_id = NEW.producto_id
      AND r.activa = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto preparado no tiene una receta activa.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM catalogo.receta_detalle rd
        WHERE rd.receta_id = v_receta_id
    ) THEN
        RAISE EXCEPTION 'La receta no tiene ingredientes registrados.';
    END IF;

    FOR v_det IN
        SELECT
            rd.insumo_id,
            rd.cantidad,
            p.nombre AS nombre_ingrediente,
            p.tipo AS tipo_ingrediente,
            p.unidad_medida,
            p.costo_promedio,
            p.activo AS ingrediente_activo
        FROM catalogo.receta_detalle rd
        JOIN catalogo.productos p ON p.productos_id = rd.insumo_id
        WHERE rd.receta_id = v_receta_id
        ORDER BY rd.insumo_id
    LOOP
        IF v_det.tipo_ingrediente NOT IN ('insumo', 'botella') THEN
            RAISE EXCEPTION 'El ingrediente "%" debe ser un insumo o una botella.', v_det.nombre_ingrediente;
        END IF;

        IF NOT v_det.ingrediente_activo THEN
            RAISE EXCEPTION 'El ingrediente "%" está inactivo.', v_det.nombre_ingrediente;
        END IF;

        IF v_det.tipo_ingrediente = 'botella' AND v_det.unidad_medida <> 'ml' THEN
            RAISE EXCEPTION 'El producto botella "%" debe utilizar ml como unidad de medida.', v_det.nombre_ingrediente;
        END IF;

        v_consumo := ROUND((v_det.cantidad * NEW.cantidad)::numeric, 3);

        IF v_consumo <= 0 THEN
            CONTINUE;
        END IF;

        PERFORM 1
        FROM catalogo.productos p
        WHERE p.productos_id = v_det.insumo_id
        FOR UPDATE;

        IF v_det.tipo_ingrediente = 'botella' THEN
            SELECT COALESCE(SUM(e.contenido_actual_ml), 0)
            INTO v_stock
            FROM inventario.envases e
            WHERE e.producto_id = v_det.insumo_id
              AND e.estado IN ('abierta', 'cerrada')
              AND e.contenido_actual_ml > 0;

            IF v_stock + 0.0001 < v_consumo THEN
                RAISE EXCEPTION 'Stock insuficiente de "%". Disponible: % ml; requerido: % ml.',
                    v_det.nombre_ingrediente, ROUND(v_stock, 3), ROUND(v_consumo, 3);
            END IF;

            v_restante := v_consumo;

            FOR v_envase IN
                SELECT e.envases_id, e.contenido_actual_ml, e.estado, e.contenido_inicial_ml
                FROM inventario.envases e
                WHERE e.producto_id = v_det.insumo_id
                  AND e.estado IN ('abierta', 'cerrada')
                  AND e.contenido_actual_ml > 0
                ORDER BY
                    CASE WHEN e.estado = 'abierta' THEN 0 ELSE 1 END,
                    e.contenido_actual_ml ASC,
                    e.created_at ASC,
                    e.envases_id ASC
                FOR UPDATE
            LOOP
                EXIT WHEN v_restante <= 0;

                v_tomar := LEAST(v_restante, v_envase.contenido_actual_ml);

                UPDATE inventario.envases
                SET
                    contenido_actual_ml = GREATEST(contenido_actual_ml - v_tomar, 0),
                    estado = CASE
                        WHEN contenido_actual_ml - v_tomar <= 0 THEN 'vacia'
                        ELSE 'abierta'
                    END,
                    fecha_apertura = COALESCE(fecha_apertura, now())
                WHERE envases_id = v_envase.envases_id;

                INSERT INTO inventario.movimientos_stock (
                    producto_id, usuario_id, proveedor_id, venta_id, envase_id,
                    tipo, cantidad, costo, observacion
                )
                VALUES (
                    v_det.insumo_id, v_usuario_id, NULL, NEW.venta_id, v_envase.envases_id,
                    'consumo_receta', v_tomar,
                    GREATEST(COALESCE(v_det.costo_promedio, 0), 0),
                    'Consumo automático por venta de trago preparado'
                );

                v_restante := v_restante - v_tomar;
            END LOOP;

            IF v_restante > 0.001 THEN
                RAISE EXCEPTION 'No fue posible completar el consumo de "%".', v_det.nombre_ingrediente;
            END IF;
        ELSE
            SELECT COALESCE(
                SUM(
                    CASE
                        WHEN ms.tipo IN ('entrada', 'ajuste_entrada', 'devolucion') THEN ms.cantidad
                        WHEN ms.tipo IN ('salida', 'ajuste_salida', 'consumo_receta') THEN -ms.cantidad
                        ELSE 0
                    END
                ),
                0
            )
            INTO v_stock
            FROM inventario.movimientos_stock ms
            WHERE ms.producto_id = v_det.insumo_id;

            IF v_stock + 0.0001 < v_consumo THEN
                RAISE EXCEPTION 'Stock insuficiente de "%". Disponible: % %; requerido: % %.',
                    v_det.nombre_ingrediente,
                    ROUND(v_stock, 3), v_det.unidad_medida,
                    ROUND(v_consumo, 3), v_det.unidad_medida;
            END IF;

            INSERT INTO inventario.movimientos_stock (
                producto_id, usuario_id, proveedor_id, venta_id, envase_id,
                tipo, cantidad, costo, observacion
            )
            VALUES (
                v_det.insumo_id, v_usuario_id, NULL, NEW.venta_id, NULL,
                'consumo_receta', v_consumo,
                GREATEST(COALESCE(v_det.costo_promedio, 0), 0),
                'Consumo automático por venta de trago preparado'
            );
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

CREATE FUNCTION inventario.fn_descontar_venta_directa()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_usuario_id uuid;
    v_estado_venta text;
    v_tipo_producto text;
    v_nombre_producto text;
    v_unidad_medida text;
    v_costo_promedio numeric;
    v_stock numeric(14,3);
    v_envase record;
    v_unidades integer;
    v_disponibles integer;
    v_procesadas integer := 0;
BEGIN
    SELECT v.usuario_id, v.estado::text
    INTO v_usuario_id, v_estado_venta
    FROM ventas.ventas v
    WHERE v.ventas_id = NEW.venta_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe la venta asociada al detalle.';
    END IF;

    IF v_estado_venta <> 'finalizada' THEN
        RETURN NEW;
    END IF;

    SELECT p.tipo, p.nombre, p.unidad_medida, p.costo_promedio
    INTO v_tipo_producto, v_nombre_producto, v_unidad_medida, v_costo_promedio
    FROM catalogo.productos p
    WHERE p.productos_id = NEW.producto_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El producto de la venta no existe.';
    END IF;

    IF NEW.cantidad IS NULL OR NEW.cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad vendida debe ser mayor que cero.';
    END IF;

    IF v_tipo_producto IN ('trago_preparado', 'servicio') THEN
        RETURN NEW;
    END IF;

    IF v_tipo_producto = 'insumo' THEN
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN ms.tipo IN ('entrada', 'ajuste_entrada', 'devolucion') THEN ms.cantidad
                    WHEN ms.tipo IN ('salida', 'ajuste_salida', 'consumo_receta') THEN -ms.cantidad
                    ELSE 0
                END
            ),
            0
        )
        INTO v_stock
        FROM inventario.movimientos_stock ms
        WHERE ms.producto_id = NEW.producto_id;

        IF v_stock + 0.0001 < NEW.cantidad THEN
            RAISE EXCEPTION 'Stock insuficiente de "%". Disponible: % %; requerido: % %.',
                v_nombre_producto,
                ROUND(v_stock, 3), v_unidad_medida,
                ROUND(NEW.cantidad, 3), v_unidad_medida;
        END IF;

        INSERT INTO inventario.movimientos_stock (
            producto_id, usuario_id, venta_id, tipo, cantidad,
            unidad_medida, costo, observacion
        )
        VALUES (
            NEW.producto_id, v_usuario_id, NEW.venta_id, 'salida',
            NEW.cantidad, v_unidad_medida,
            GREATEST(COALESCE(v_costo_promedio, 0), 0),
            'Salida automática por venta directa de insumo'
        );
    ELSIF v_tipo_producto = 'botella' THEN
        IF NEW.cantidad <> TRUNC(NEW.cantidad) THEN
            RAISE EXCEPTION 'La cantidad de botellas vendidas debe ser un número entero.';
        END IF;

        v_unidades := NEW.cantidad::integer;

        SELECT COUNT(*)::integer
        INTO v_disponibles
        FROM inventario.envases e
        WHERE e.producto_id = NEW.producto_id
          AND e.estado = 'cerrada'
          AND e.contenido_actual_ml > 0;

        IF v_disponibles < v_unidades THEN
            RAISE EXCEPTION 'Botellas insuficientes de "%". Disponibles: %; requeridas: %.',
                v_nombre_producto, v_disponibles, v_unidades;
        END IF;

        FOR v_envase IN
            SELECT e.envases_id
            FROM inventario.envases e
            WHERE e.producto_id = NEW.producto_id
              AND e.estado = 'cerrada'
              AND e.contenido_actual_ml > 0
            ORDER BY e.created_at ASC, e.envases_id ASC
            FOR UPDATE
        LOOP
            EXIT WHEN v_procesadas >= v_unidades;

            UPDATE inventario.envases
            SET estado = 'vendida'
            WHERE envases_id = v_envase.envases_id;

            INSERT INTO inventario.movimientos_stock (
                producto_id, usuario_id, venta_id, envase_id,
                tipo, cantidad, unidad_medida, costo, observacion
            )
            VALUES (
                NEW.producto_id, v_usuario_id, NEW.venta_id, v_envase.envases_id,
                'salida', 1, 'unidad',
                GREATEST(COALESCE(v_costo_promedio, 0), 0),
                'Salida automática por venta de botella cerrada'
            );

            v_procesadas := v_procesadas + 1;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

CREATE FUNCTION inventario.fn_revertir_consumo_venta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_mov record;
BEGIN
    IF OLD.estado = 'finalizada' AND NEW.estado = 'anulada' THEN
        FOR v_mov IN
            SELECT ms.*
            FROM inventario.movimientos_stock ms
            WHERE ms.venta_id = NEW.ventas_id
              AND ms.tipo = 'consumo_receta'
              AND NOT EXISTS (
                  SELECT 1
                  FROM inventario.movimientos_stock rev
                  WHERE rev.reversa_de_movimiento_id = ms.movimientos_stock_id
              )
            ORDER BY ms.movimientos_stock_id
            FOR UPDATE
        LOOP
            IF v_mov.envase_id IS NOT NULL THEN
                UPDATE inventario.envases
                SET
                    contenido_actual_ml = LEAST(
                        contenido_inicial_ml,
                        contenido_actual_ml + v_mov.cantidad
                    ),
                    estado = CASE
                        WHEN LEAST(
                            contenido_inicial_ml,
                            contenido_actual_ml + v_mov.cantidad
                        ) <= 0 THEN 'vacia'
                        ELSE 'abierta'
                    END,
                    fecha_apertura = COALESCE(fecha_apertura, now())
                WHERE envases_id = v_mov.envase_id;
            END IF;

            INSERT INTO inventario.movimientos_stock (
                producto_id, usuario_id, proveedor_id, venta_id, envase_id,
                tipo, cantidad, costo, observacion, reversa_de_movimiento_id
            )
            VALUES (
                v_mov.producto_id, v_mov.usuario_id, v_mov.proveedor_id,
                NEW.ventas_id, v_mov.envase_id, 'devolucion',
                v_mov.cantidad, v_mov.costo,
                'Reversión automática por anulación de venta',
                v_mov.movimientos_stock_id
            );
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;

CREATE VIEW inventario.v_stock_actual AS
SELECT
    p.productos_id,
    p.nombre AS producto,
    p.tipo,
    p.unidad_medida,
    c.categorias_id,
    c.nombre AS categoria,
    p.precio,
    p.costo_promedio,
    p.stock_minimo,
    p.activo,
    CASE
        WHEN p.tipo = 'botella' THEN COALESCE(env.stock_ml, 0)
        ELSE COALESCE(mov.stock_actual, 0)
    END AS stock_actual,
    CASE
        WHEN p.tipo = 'botella' THEN COALESCE(env.stock_ml, 0)
        ELSE NULL::numeric
    END AS contenido_total_ml,
    COALESCE(env.envases_abiertos, 0) AS envases_abiertos,
    COALESCE(env.envases_cerrados, 0) AS envases_cerrados
FROM catalogo.productos p
JOIN catalogo.categorias c ON c.categorias_id = p.categoria_id
LEFT JOIN LATERAL (
    SELECT SUM(
        CASE
            WHEN ms.tipo IN ('entrada', 'ajuste_entrada', 'devolucion') THEN ms.cantidad
            WHEN ms.tipo IN ('salida', 'ajuste_salida', 'consumo_receta') THEN -ms.cantidad
            ELSE 0
        END
    ) AS stock_actual
    FROM inventario.movimientos_stock ms
    WHERE ms.producto_id = p.productos_id
) mov ON true
LEFT JOIN LATERAL (
    SELECT
        SUM(e.contenido_actual_ml) AS stock_ml,
        COUNT(*) FILTER (WHERE e.estado = 'abierta') AS envases_abiertos,
        COUNT(*) FILTER (WHERE e.estado = 'cerrada') AS envases_cerrados
    FROM inventario.envases e
    WHERE e.producto_id = p.productos_id
      AND e.estado IN ('abierta', 'cerrada')
      AND e.contenido_actual_ml > 0
) env ON true
WHERE p.tipo IN ('insumo', 'botella');

CREATE TRIGGER trg_categorias_updated_at
BEFORE UPDATE ON catalogo.categorias
FOR EACH ROW EXECUTE FUNCTION comun.set_updated_at();

CREATE TRIGGER trg_productos_updated_at
BEFORE UPDATE ON catalogo.productos
FOR EACH ROW EXECUTE FUNCTION comun.set_updated_at();

CREATE TRIGGER trg_proveedores_updated_at
BEFORE UPDATE ON catalogo.proveedores
FOR EACH ROW EXECUTE FUNCTION comun.set_updated_at();

CREATE TRIGGER trg_recetas_updated_at
BEFORE UPDATE ON catalogo.recetas
FOR EACH ROW EXECUTE FUNCTION comun.set_updated_at();

CREATE TRIGGER trg_envases_updated_at
BEFORE UPDATE ON inventario.envases
FOR EACH ROW EXECUTE FUNCTION inventario.fn_envases_updated_at();

CREATE TRIGGER trg_usuarios_updated_at
BEFORE UPDATE ON seguridad.usuarios
FOR EACH ROW EXECUTE FUNCTION comun.set_updated_at();

CREATE TRIGGER trg_consumir_receta_venta
AFTER INSERT ON ventas.venta_detalle
FOR EACH ROW EXECUTE FUNCTION inventario.fn_consumir_receta_venta();

CREATE TRIGGER trg_descontar_venta_directa
AFTER INSERT ON ventas.venta_detalle
FOR EACH ROW EXECUTE FUNCTION inventario.fn_descontar_venta_directa();

CREATE TRIGGER trg_revertir_consumo_venta
AFTER UPDATE OF estado ON ventas.ventas
FOR EACH ROW EXECUTE FUNCTION inventario.fn_revertir_consumo_venta();

COMMIT;