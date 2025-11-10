const db = require("../../config/db");





exports.getCarsByUser = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId; // Handles both formats

    // ✅ Debug log
    console.log("User ID from token:", userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User ID not found in token.",
      });
    }

    const [cars] = await db.execute(
      `SELECT 
         id, title, city, pricePerHour, seats, doors, luggageCapacity,
         fuelType, transmissionType, carLocation, carCategoryId,
         lat, lng, driverAvailable, pickupDropAvailable,
         carApprovalStatus, repairMode, carEnabled,
         createdAt, updatedAt
       FROM cars
       WHERE userId = ?`,
      [userId]
    );

    if (cars.length === 0) {
      console.log("No cars found for user:", userId); // ✅ Debug log
      return res.json({
        success: true,
        message: "No cars found for this user.",
        cars: [],
      });
    }

    console.log("Cars found for user:", userId, cars.length); // ✅ Debug log

    res.json({
      success: true,
      message: "Cars fetched successfully.",
      cars,
    });
  } catch (err) {
    console.error("Error fetching cars by user:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching cars.",
      error: err.message,
    });
  }
};



