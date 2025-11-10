const express = require("express");
const router = express.Router();
const { createCoupon, getAllCoupons, applyCoupon } = require("../controllers/couponController");
const { protect } = require("../middleware/auth"); // optional for admin auth

// Admin: create coupon
router.post("/create", createCoupon);

// Admin: get all coupons
router.get("/all", getAllCoupons);

// User: apply coupon
router.post("/apply",protect, applyCoupon);

module.exports = router;
