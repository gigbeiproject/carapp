// routes/booking.js
const express = require("express");
const { protect } = require("../middleware/auth");
const { createBookingOrder, verifyBookingPayment ,getUserBookings,cancelBooking,getBookingById } = require("../controllers/createbooking");

const router = express.Router();

// Create Razorpay order
router.post("/create-order", protect, createBookingOrder);

// Verify payment & confirm booking
router.post("/verify-payment", protect, verifyBookingPayment);

router.get("/orders", protect, getUserBookings);

router.get("/book/:id", protect, getBookingById);

router.put("/cancel-booking/:reservationId",protect, cancelBooking); // PUT or PATCH

module.exports = router;
