const { v4: uuidv4 } = require("uuid");
const db = require("../config/db");

exports.addCarReview = async (req, res) => {
  try {
    const userId = req.user.id; // assuming JWT middleware sets req.user
    const { carId, rating, comment } = req.body;

    if (!carId || !rating) {
      return res.status(400).json({ success: false, message: "carId and rating are required" });
    }

    const reviewId = uuidv4();

    await db.execute(
      `INSERT INTO car_reviews (id, carId, userId, rating, comment, createdAt)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [reviewId, carId, userId, rating, comment || ""]
    );

    res.status(201).json({ success: true, message: "Review added successfully", reviewId });
  } catch (err) {
    console.error("Error adding review:", err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};
exports.getCarReviews = async (req, res) => {
  try {
    const { carId } = req.params;

    if (!carId) {
      return res.status(400).json({ success: false, message: "carId is required" });
    }

    const [reviews] = await db.execute(
      `SELECT r.id AS reviewId, r.rating, r.comment, r.createdAt, u.id AS userId, u.name AS userName
       FROM car_reviews r
       JOIN users u ON r.userId = u.id
       WHERE r.carId = ?
       ORDER BY r.createdAt DESC`,
      [carId]
    );

    res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};
