const express = require("express");
const router = express.Router();
const { addCarReview, getCarReviews } = require("../controllers/ratingController");
const { protect } = require("../middleware/auth"); // JWT auth middleware

// Add a review
router.post("/reviews", protect, addCarReview);

// Get reviews for a car
router.get("/reviews/:carId", getCarReviews);

module.exports = router;
