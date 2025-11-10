const express = require("express");
const router = express.Router();
const { getHostReservations } = require("../../controllers/Host/getHostBookingController");
const { protect } = require("../../middleware/auth");

router.get("/mybooking", protect, getHostReservations);

module.exports = router;
