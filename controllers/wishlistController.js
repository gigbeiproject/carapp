const db = require("../config/db");

// ➕ Add to Favorites
exports.addToWishlist = async (req, res) => {
  try {
    const user_id = req.user.id; // ✅ get user ID from token
    const { car_id } = req.body;

    // ✅ 1. Validate input
    if (!car_id) {
      return res.status(400).json({ message: "car_id is required" });
    }

    // ✅ 2. Check if already exists
    const [existing] = await db.query(
      "SELECT id FROM wishlist WHERE user_id = ? AND car_id = ?",
      [user_id, car_id]
    );

    if (existing.length > 0) {
      return res.status(200).json({ message: "Already in wishlist" });
    }

    // ✅ 3. Insert into wishlist
    await db.query(
      "INSERT INTO wishlist (user_id, car_id, created_at) VALUES (?, ?, NOW())",
      [user_id, car_id]
    );

    return res.status(201).json({ message: "Added to wishlist successfully" });

  } catch (error) {
    console.error("❌ Wishlist Error:", error);
    return res.status(500).json({
      message: "Server error while adding to wishlist",
      error: error.message,
    });
  }
};
// ❌ Remove from Favorites
 exports.removeFromFavorites = async (req, res) => {
  try {
    const userId = req.user.id; // from token
    const { carId } = req.params; // from URL parameter

    if (!carId) {
      return res.status(400).json({ error: "carId is required" });
    }

    const [result] = await db.query(
      "DELETE FROM wishlist WHERE user_id = ? AND car_id = ?",
      [userId, carId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Not found in favorites" });
    }

    res.status(200).json({ message: "Removed from favorites successfully" });
  } catch (error) {
    console.error("Error removing from favorites:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// 📜 Get Favorites by Token
exports.getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch wishlist with car info and host info
    const [favorites] = await db.query(
      `SELECT 
          w.id AS wishlist_id,
          w.car_id,
          c.title AS car_title,
          c.pricePerHour,
          c.city,
          c.fuelType,
          c.transmissionType,
          c.seats,
          c.doors,
          c.luggageCapacity,
          c.userId AS hostId,
          u.name AS hostName,
          u.phoneNumber AS hostPhone
       FROM wishlist w
       LEFT JOIN cars c ON w.car_id = c.id
       LEFT JOIN users u ON c.userId = u.id
       WHERE w.user_id = ?`,
      [userId]
    );

    for (const fav of favorites) {
      // Fetch all images for this car
      const [images] = await db.execute(
        "SELECT imagePath FROM car_images WHERE carId = ?",
        [fav.car_id]
      );
      fav.images = images.map((i) => i.imagePath);

      // Fetch features
      const [features] = await db.execute(
        "SELECT feature FROM car_features WHERE carId = ?",
        [fav.car_id]
      );
      fav.features = features.map((f) => f.feature);

      // Fetch average rating and total reviews
      const [ratingResult] = await db.execute(
        "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
        [fav.car_id]
      );
      fav.avgRating = ratingResult[0].avgRating ? parseFloat(ratingResult[0].avgRating.toFixed(1)) : 0;
      fav.totalReviews = ratingResult[0].totalReviews;

      // Fetch total bookings
      const [bookingResult] = await db.execute(
        "SELECT COUNT(*) AS bookingCount FROM reservations WHERE carId = ?",
        [fav.car_id]
      );
      fav.bookingCount = bookingResult[0].bookingCount;
    }

    res.status(200).json({ success: true, data: favorites });
  } catch (error) {
    console.error("Error fetching favorites:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};


  