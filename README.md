# BIOX — Diseño de una Solución de Inteligencia de Negocios BiOX para un Establecimiento Comercial.

BIOX es un proyecto académico desarrollado para el curso de especialización en Administración de Bases de Datos e Inteligencia de Negocios de la Universidad de El Salvador.

El proyecto integra la captura de información operativa de un establecimiento comercial con un proceso de integración y transformación de datos, un repositorio analítico y un panel de indicadores. Su propósito es facilitar el análisis de ventas, inventario, afluencia y satisfacción mediante información estructurada y centralizada.

## Objetivo

Diseñar e implementar una solución que permita:

- Registrar y consultar información de las operaciones del establecimiento.
- Centralizar los datos operativos en una base de datos transaccional.
- Transformar los datos para su uso analítico.
- Almacenar la información procesada en un Data Warehouse.
- Visualizar indicadores y tendencias mediante un dashboard.

## Arquitectura

La solución se organiza en las siguientes capas:

```text
Interfaz web
    │
    ▼
Backend Node.js
    │
    ▼
PostgreSQL — BIOX OLTP
    │
    ▼
Proceso ETL con Python
    │
    ▼
PostgreSQL — BIOX DW
    │
    ▼
Dashboard analítico con Streamlit
```

### Componentes

| Componente | Tecnología | Función |
|---|---|---|
| Interfaz de captura | HTML, CSS y JavaScript | Interacción con los módulos operativos |
| Backend | Node.js | Procesamiento de solicitudes y operaciones del sistema |
| Base de datos transaccional | PostgreSQL | Almacenamiento de los registros operativos |
| Integración y transformación | Python | Extracción, transformación y carga de datos |
| Base de datos analítica | PostgreSQL | Almacenamiento de datos preparados para análisis |
| Dashboard | Streamlit | Visualización de indicadores y tendencias |

## Módulos operativos

El sistema contempla los siguientes procesos:

### Ventas
Registro y consulta de transacciones comerciales, incluyendo sus detalles y estado.

### Inventario
Gestión de productos y movimientos de inventario. Las existencias se determinan a partir de los movimientos registrados, en lugar de depender únicamente de un valor de stock almacenado manualmente.

### Afluencia
Registro de cantidades de personas que ingresan y salen del establecimiento, para analizar patrones de afluencia por fecha y hora.

### Satisfacción
Registro de valoraciones relacionadas con la experiencia del cliente, incluyendo aspectos como atención, ambiente, música, limpieza y seguridad.

### Seguridad
Administración de usuarios, roles y permisos de acceso a las funcionalidades del sistema.

## Proceso ETL

El proceso de integración de datos se desarrolla con Python y comprende tres etapas:

1. **Extracción:** obtención de información desde la base de datos transaccional.
2. **Transformación:** preparación de los datos, aplicación de reglas de negocio y cálculo de valores necesarios para el análisis.
3. **Carga:** almacenamiento de los datos transformados en el Data Warehouse.

El repositorio analítico permite consultar la información sin depender exclusivamente de las consultas operativas del sistema.

## Dashboard e indicadores

El dashboard desarrollado con Streamlit presenta información analítica sobre:

- Ventas.
- Inventario.
- Afluencia.
- Satisfacción.
- Indicadores clave de desempeño (KPI).
- Cumplimiento de metas, cuando existen metas definidas.

Entre los indicadores contemplados se encuentran:

| Indicador | Descripción |
|---|---|
| Ingresos netos | Importe neto de las ventas consideradas en el análisis |
| Transacciones | Cantidad de operaciones de venta |
| Unidades vendidas | Cantidad de unidades comercializadas |
| Ticket promedio | Ingreso neto promedio por transacción |
| Satisfacción promedio | Promedio de las valoraciones registradas |

Los resultados dependen de los registros disponibles y de las reglas de cálculo implementadas en el proyecto.

## Bases de datos

La solución utiliza dos bases de datos PostgreSQL independientes:

- **`biox_oltp`**: almacena la información transaccional y operativa.
- **`biox_dw`**: almacena la información preparada para el análisis y la generación de indicadores.

Esta separación permite distinguir las operaciones diarias del procesamiento analítico.

## Requisitos

Para ejecutar el proyecto se requiere contar con:

- PostgreSQL.
- Node.js y npm.
- Python.
- Streamlit.
- Las dependencias definidas para el backend, el proceso ETL y el dashboard.

Las versiones específicas y los comandos de instalación deben consultarse en los archivos de configuración y dependencias incluidos en el repositorio.

## Configuración y ejecución

La ejecución requiere configurar las conexiones a las bases de datos y preparar los componentes del sistema.

De forma general, el proceso es:

1. Crear y configurar las bases de datos `biox_oltp` y `biox_dw`.
2. Ejecutar los scripts SQL correspondientes a cada base de datos.
3. Configurar las variables de entorno requeridas por el backend, el ETL y el dashboard.
4. Instalar las dependencias de cada componente.
5. Iniciar el backend y la interfaz web.
6. Ejecutar el proceso ETL para integrar los datos operativos al Data Warehouse.
7. Iniciar el dashboard de Streamlit.

Los comandos concretos de ejecución deben ajustarse a la estructura actual del repositorio.

## Datos del proyecto

Los datos utilizados para las pruebas y demostraciones pueden ser sintéticos o de ejemplo. Por tanto, los resultados del dashboard no deben interpretarse como información real del establecimiento, salvo que se indique expresamente lo contrario.

## Alcance académico

BIOX se desarrolla como un proyecto académico orientado al diseño e implementación de una solución de gestión operativa e inteligencia de negocios. El alcance comprende la captura de datos, su almacenamiento transaccional, la integración analítica y la visualización de indicadores.

## Autores

Proyecto desarrollado en el marco del curso de especialización en Administración de Bases de Datos e Inteligencia de Negocios de la Universidad de El Salvador.