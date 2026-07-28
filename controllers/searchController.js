const db = require("../config/db");

exports.searchCars = async (req, res) => {
  try {
    const { city, pickupDateTime, dropDateTime } = req.query;

    if (!city || !pickupDateTime || !dropDateTime) {
      return res.status(400).json({ success: false, message: "city, pickupDateTime and dropDateTime are required" });
    }

    // 1️⃣ Fetch ONLY APPROVED cars in the city
    const [cars] = await db.execute(
      "SELECT * FROM cars WHERE city = ? AND carApprovalStatus = 'APPROVED'",
      [city]
    );

    const availableCars = [];
    const notAvailableCars = [];

    for (const car of cars) {
      // 2️⃣ Check if the car has conflicting reservations (Including PENDING, CONFIRMED, and SELFBOOK)
      const [reservations] = await db.execute(
        `SELECT startDate, endDate 
         FROM reservations 
         WHERE carId = ? 
           AND status IN ('PENDING', 'CONFIRMED', 'SELFBOOK')
           AND NOT (endDate <= ? OR startDate >= ?)`,
        [car.id, pickupDateTime, dropDateTime]
      );

      // =====================================
      // 3. CHECK CURRENT ACTIVE SELF BOOKING (For UI metadata)
      // =====================================
      car.selfBook = false;
      car.freeAfter = null;

      const [activeSelfBooking] = await db.execute(
        `
        SELECT endDate
        FROM reservations
        WHERE carId = ?
        AND status = 'SELFBOOK'
        AND endDate >= NOW()
        ORDER BY endDate ASC
        LIMIT 1
        `,
        [car.id]
      );

      if (activeSelfBooking.length > 0) {
        car.selfBook = true;
        car.freeAfter = activeSelfBooking[0].endDate;
      }

      // Fetch images and features
      const [images] = await db.execute("SELECT imagePath FROM car_images WHERE carId = ?", [car.id]);
      const [features] = await db.execute("SELECT feature FROM car_features WHERE carId = ?", [car.id]);
      car.images = images.map(i => i.imagePath);
      car.features = features.map(f => f.feature);

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