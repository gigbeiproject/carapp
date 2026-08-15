// backend/config/db.js
require("dotenv").config({ path: "../.env" }); // if .env is in parent folder


const mysql = require("mysql2/promise");

console.log("🔍 DB ENV CHECK:", {
  host1: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD ? "✅ Loaded" : "❌ Missing",
  database: process.env.DB_NAME,
});

const connection = mysql.createPool({
  host: process.env.DB_HOST ,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  charset: "utf8mb4",
  // Force UTC interpretation of DATETIME columns so date reads are
  // deterministic regardless of the Node process's own OS timezone.
  // Without this, mysql2 defaults to 'local', meaning the same row can
  // read back as a different instant depending on server deployment TZ.
  timezone: "Z",
});

module.exports = connection;
