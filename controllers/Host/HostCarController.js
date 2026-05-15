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
      // CHECK SELF BOOKING FOR EACH CAR
      // ======================================
      for (let car of cars) {

        // ✅ Default values
        car.selfBook = false;
        car.freeAfter = null;

        // ✅ Check active self booking
        const [selfBooking] = await db.execute(
          `
          SELECT 
            endDate
          FROM reservations
          WHERE carId = ?
          AND status = 'SELFBOOK'
          AND endDate >= NOW()
          ORDER BY endDate ASC
          LIMIT 1
          `,
          [car.id]
        );

        // ✅ If self booked
        if (selfBooking.length > 0) {

          car.selfBook = true;

          car.freeAfter = selfBooking[0].endDate;
        }
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


