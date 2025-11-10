const db = require("../config/db");

exports.searchCars = async (req, res) => {
  try {
    const { city, pickupDateTime, dropDateTime } = req.query;

    if (!city || !pickupDateTime || !dropDateTime) {
      return res.status(400).json({ success: false, message: "city, pickupDateTime and dropDateTime are required" });
    }

    // 1️⃣ Fetch all cars in the city
    const [cars] = await db.execute(
      "SELECT * FROM cars WHERE city = ?",
      [city]
    );

    const availableCars = [];
    const notAvailableCars = [];

    for (const car of cars) {
      // 2️⃣ Check if the car has conflicting reservations
      const [reservations] = await db.execute(
        `SELECT startDate, endDate 
         FROM reservations 
         WHERE carId = ? 
           AND status IN ('PENDING','CONFIRMED')
           AND NOT (endDate <= ? OR startDate >= ?)`,
        [car.id, pickupDateTime, dropDateTime]
      );

      if (reservations.length === 0) {
        // Car is available
        availableCars.push(car);
      } else {
        // Car is not available, add conflicting dates
        const conflictingDates = reservations.map(r => ({
          startDate: r.startDate,
          endDate: r.endDate
        }));
        notAvailableCars.push({
          ...car,
          conflictingDates
        });
      }

      // Optional: fetch images, features
      const [images] = await db.execute("SELECT imagePath FROM car_images WHERE carId = ?", [car.id]);
      const [features] = await db.execute("SELECT feature FROM car_features WHERE carId = ?", [car.id]);
      car.images = images.map(i => i.imagePath);
      car.features = features.map(f => f.feature);
    }

    res.status(200).json({
      success: true,
      available: availableCars,
      notAvailable: notAvailableCars
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};
