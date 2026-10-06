const db = require("../../config/db");





  exports.getCarsByUser = async (req, res) => {
    try {
      const userId = req.user.id || req.user.userId;

      // ✅ Debug log
      console.log("User ID from token:", userId);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "User ID not found in token.",
        });
      }

      // ✅ Fetch user cars
      const [cars] = await db.execute(
        `
        SELECT 
          id,
          title,
          city,
          pricePerHour,
          seats,
          doors,
          luggageCapacity,
          fuelType,
          transmissionType,
          carLocation,
          carCategoryId,
          lat,
          lng,
          driverAvailable,
          pickupDropAvailable,
          carApprovalStatus,
          repairMode,
          carEnabled,
          createdAt,
          updatedAt
        FROM cars
        WHERE userId = ?
        `,
        [userId]
      );

      // ✅ No cars found
      if (cars.length === 0) {

        console.log("No cars found for user:", userId);

        return res.json({
          success: true,
          message: "No cars found for this user.",
          cars: [],
        });
      }

      // ======================================
      // ACTIVE SELF BOOKINGS — one query for all cars (was one per car)
      // ======================================
      const ids = cars.map((c) => c.id);
      const [selfBookings] = await db.query(
        `SELECT carId, MIN(endDate) AS freeAfter
           FROM reservations
          WHERE carId IN (${ids.map(() => "?").join(",")})
            AND status = 'SELFBOOK' AND endDate >= NOW()
          GROUP BY carId`,
        ids
      );
      const freeAfterByCar = new Map(selfBookings.map((r) => [r.carId, r.freeAfter]));
      for (const car of cars) {
        car.freeAfter = freeAfterByCar.get(car.id) ?? null;
        car.selfBook = car.freeAfter !== null;
      }

      console.log("Cars found for user:", userId, cars.length);

      // ✅ Final response
      return res.json({
        success: true,
        message: "Cars fetched successfully.",
        cars,
      });

    } catch (err) {

      console.error("Error fetching cars by user:", err);

      return res.status(500).json({
        success: false,
        message: "Error fetching cars.",
        error: err.message,
      });
    }
  };


