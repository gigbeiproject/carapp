// File: routes/host/hostBookingStartRoutes.js
const express = require("express");
const multer = require("multer");
const { startBooking, completeBooking } = require("../../controllers/Host/hostbookingstartController");

const router = express.Router();

// ✅ Use memory storage (no local uploads)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ✅ Routes
router.post("/start-booking", upload.array("photos", 5), startBooking);
router.post("/complete-booking", upload.array("photos", 5), completeBooking);

module.exports = router;
