// routes/booking.js
const express = require("express");
const { protect } = require("../middleware/auth");
const { createBookingOrder, verifyBookingPayment ,getUserBookings,cancelBooking,getBookingById,selfBookCar, getCarSelfBookings, updateSelfBooking, deleteSelfBooking, requestRefund } = require("../controllers/createbooking");

const router = express.Router();

// Create Razorpay order
router.post("/create-order", protect, createBookingOrder);

// Verify payment & confirm booking
router.post("/verify-payment", protect, verifyBookingPayment);

router.get("/orders", protect, getUserBookings);

router.get("/book/:id", protect, getBookingById);

router.put("/cancel-booking/:reservationId",protect, cancelBooking); // PUT or PATCH




// host  api this 

router.post("/self-book-car", protect, selfBookCar);
// Host: manage existing self bookings of their own car
router.get("/self-bookings/:carId", protect, getCarSelfBookings);

// Unverified customer: cancel + request refund instead of doing KYC
router.post("/refund-request/:id", protect, requestRefund);
router.put("/self-book/:id", protect, updateSelfBooking);
router.delete("/self-book/:id", protect, deleteSelfBooking);

module.exports = router;
