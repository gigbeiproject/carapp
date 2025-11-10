const express = require("express");
const router = express.Router();
const { addToWishlist,getFavorites,removeFromFavorites } = require("../controllers/wishlistController");
const { protect } = require("../middleware/auth");

// Protected route
router.post("/add-favorites", protect, addToWishlist);
// Get all favorites (for logged-in user)
router.get("/my-favorites", protect, getFavorites);

// Remove from favorites (by carId)
router.delete("/remove/:carId", protect, removeFromFavorites);

module.exports = router;
