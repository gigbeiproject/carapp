// backend/config/s3.js
const AWS = require("aws-sdk");
const dotenv = require("dotenv");
const path = require("path");

// Load .env from project root
require("dotenv").config({ path: "../.env" }); // if .env is in parent folder

// Debug check (optional)
console.log("🌍 AWS ENV CHECK:", {
  key_id: process.env.AWS_ACCESS_KEY_ID ? "✅ Loaded" : "❌ Missing",
  secret: process.env.AWS_SECRET_ACCESS_KEY ? "✅ Loaded" : "❌ Missing",
  region: process.env.AWS_REGION || "❌ Missing"
});

// Initialize AWS S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

module.exports = s3;
