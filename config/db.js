// backend/config/db.js
require("dotenv").config({
  path: "/home/ubuntu/actions-runner-backend/_work/carapp/carapp/.env"
});


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
});

module.exports = connection;
