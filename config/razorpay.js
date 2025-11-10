const Razorpay = require("razorpay");
const dotenv = require("dotenv");
const path = require("path");

// Load .env file (ensure correct path)
require("dotenv").config({ path: "../.env" }); // if .env is in parent folder

// Debug check (optional)
console.log("🔑 Razorpay ENV:", {
  key_id: process.env.RAZORPAY_KEY_ID ? "✅ Loaded" : "❌ Missing",
  key_secret: process.env.RAZORPAY_KEY_SECRET ? "✅ Loaded" : "❌ Missing"
});

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
