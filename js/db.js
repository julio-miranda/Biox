
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "Biox_OLTP",
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on("connect", () => {
    console.log("Conexión establecida con PostgreSQL.");
});

pool.on("error", (error) => {
    console.error("Error inesperado en PostgreSQL:", error.message);
});

module.exports = pool;