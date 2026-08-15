const express = require("express");
const router = express.Router();
const { createCoupon, getAllCoupons, applyCoupon } = require("../controllers/couponController");
const { protect } = require("../middleware/auth");
const { adminOnly } = require("../middleware/authMiddlewareAdmin");

// Admin: create coupon
router.post("/create", protect, adminOnly, createCoupon);

// Get all coupons — consumed by both the Admin panel and the mobile app's
// checkout coupon list, so any authenticated user (not admin-only).
router.get("/all", protect, getAllCoupons);

// User: apply coupon
router.post("/apply",protect, applyCoupon);

module.exports = router;
