const db = require("../config/db");
const s3 = require("../config/s3");
const { v4: uuidv4 } = require("uuid");
const uploadToS3 = require("../config/uploadToS3");

// Upload to S3

exports.createListing = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    console.log("BODY:", req.body);
    console.log("FILES:", req.files);

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!req.body.carData) {
      return res.status(400).json({
        success: false,
        message: "carData is required",
      });
    }

    // ✅ SAFE JSON PARSE
    let carData;
    try {
      carData =
        typeof req.body.carData === "string"
          ? JSON.parse(req.body.carData)
          : req.body.carData;
    } catch {
      return res.status(400).json({
        success: false,
        message: "Invalid carData JSON",
      });
    }

    const carId = uuidv4();

    const {
      title,
      numberPlate,
      city,
      pricePerHour,
      securityDeposit = 0,
      seats,
      doors,
      luggageCapacity = 0,
      fuelType,
      transmissionType,
      carLocation,
      carCategoryId = null,
      lat,
      long,
      driverAvailable = false,
      pickupDropAvailable = false,
      activeFastag = true,
      carFeatures = [],
    } = carData;

    if (
      !title ||
      !numberPlate ||
      !city ||
      !pricePerHour ||
      !seats ||
      !doors ||
      !fuelType ||
      !transmissionType ||
      !carLocation ||
      lat === undefined ||
      long === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // ✅ INSERT CAR
    await connection.execute(
      `INSERT INTO cars (
        id, userId, title, numberPlate, city, pricePerHour,
        securityDeposit, seats, doors, luggageCapacity,
        fuelType, transmissionType, carLocation, carCategoryId,
        lat, lng, driverAvailable, pickupDropAvailable,
        createdAt, updatedAt, carApprovalStatus,
        repairMode, carEnabled, activeFastag
      ) VALUES (
        ?,?,?,?,?,?,
        ?,?,?,?,
        ?,?,?,?,
        ?,?,?,?,
        NOW(), NOW(), 'PENDING',
        0, 1, ?
      )`,
      [
        carId,
        userId,
        title,
        numberPlate,
        city,
        pricePerHour,
        securityDeposit,
        seats,
        doors,
        luggageCapacity,
        fuelType,
        transmissionType,
        carLocation,
        carCategoryId,
        lat,
        long,
        driverAvailable,
        pickupDropAvailable,
        activeFastag,
      ]
    );

    // ✅ UPLOAD CAR IMAGES
    if (req.files?.carImages) {
      for (const file of req.files.carImages) {
        if (!file.buffer) continue;
        const imageUrl = await uploadToS3(file, "car-images");
        await connection.execute(
          "INSERT INTO car_images (carId, imagePath) VALUES (?, ?)",
          [carId, imageUrl]
        );
      }
    }

    // ✅ UPLOAD DOCUMENTS & VIDEO
    const docTypes = ["rc", "insurance", "pollution", "aadhar", "license", "video"];
    for (const type of docTypes) {
      if (!req.files?.[type]) continue;

      for (const file of req.files[type]) {
        if (!file.buffer) continue;

        if (type === "video" && !file.mimetype.startsWith("video/")) continue;

        const docUrl = await uploadToS3(file, "car-documents");
        await connection.execute(
          "INSERT INTO car_documents (carId, type, filePath) VALUES (?, ?, ?)",
          [carId, type, docUrl]
        );
      }
    }

    // ✅ FEATURES
    if (Array.isArray(carFeatures)) {
      for (const feature of carFeatures) {
        await connection.execute(
          "INSERT INTO car_features (carId, feature) VALUES (?, ?)",
          [carId, feature]
        );
      }
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Car listing created successfully",
      carId,
    });

  } catch (error) {
    await connection.rollback();
    console.error("Create listing error:", error);

    return res.status(500).json({
      success: false,
      message: "Error creating car listing",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};


// get all permit
exports.getAllCars = async (req, res) => {
  try {

    // =====================================
    // GET ALL APPROVED CARS
    // =====================================
    const [cars] = await db.execute(
      `
      SELECT 
        c.*,
        u.name AS HostName,
        u.phoneNumber AS ownerPhone
      FROM cars c
      JOIN users u ON c.userId = u.id
      WHERE c.carApprovalStatus = 'APPROVED'
      `
    );

    // =====================================
    // LOOP ALL CARS
    // =====================================
    for (const car of cars) {

      // =====================================
      // GET CAR IMAGES
      // =====================================
      const [images] = await db.execute(
        `
        SELECT imagePath
        FROM car_images
        WHERE carId = ?
        `,
        [car.id]
      );

      // =====================================
      // GET CAR DOCUMENTS
      // =====================================
      const [documents] = await db.execute(
        `
        SELECT type, filePath
        FROM car_documents
        WHERE carId = ?
        `,
        [car.id]
      );

      // =====================================
      // GET CAR FEATURES
      // =====================================
      const [features] = await db.execute(
        `
        SELECT feature
        FROM car_features
        WHERE carId = ?
        `,
        [car.id]
      );

      // =====================================
      // GET RATINGS
      // =====================================
      const [ratingResult] = await db.execute(
        `
        SELECT
          AVG(rating) AS avgRating,
          COUNT(*) AS totalReviews
        FROM car_reviews
        WHERE carId = ?
        `,
        [car.id]
      );

      // =====================================
      // GET BOOKING COUNT
      // =====================================
      const [bookingResult] = await db.execute(
        `
        SELECT COUNT(*) AS bookingCount
        FROM reservations
        WHERE carId = ?
        `,
        [car.id]
      );

      // =====================================
      // DEFAULT VALUES
      // =====================================
      car.selfBook = false;

      car.freeAfter = null;

      // =====================================
      // CHECK ACTIVE SELF BOOKING
      // =====================================
      const [selfBooking] = await db.execute(
        `
        SELECT
          id,
          startDate,
          endDate,
          status
        FROM reservations
        WHERE carId = ?
        AND status = 'SELFBOOK'
        AND endDate >= NOW()
        ORDER BY endDate ASC
        LIMIT 1
        `,
        [car.id]
      );

      // =====================================
      // IF SELF BOOK FOUND
      // =====================================
      if (selfBooking.length > 0) {

        const booking = selfBooking[0];

        const now = new Date();

        const start = new Date(booking.startDate);

        const end = new Date(booking.endDate);

        // =====================================
        // ACTIVE SELF BOOK
        // =====================================
        if (now >= start && now <= end) {

          car.selfBook = true;

          car.freeAfter = booking.endDate;

        } else {

          car.selfBook = false;

          car.freeAfter = null;
        }
      }

      // =====================================
      // FORMAT RESPONSE
      // =====================================
      const avgRatingRaw = ratingResult[0].avgRating;

      car.images = images.map(img => img.imagePath);

      car.documents = documents;

      car.features = features.map(f => f.feature);

      car.avgRating = avgRatingRaw
        ? Number(parseFloat(avgRatingRaw).toFixed(1))
        : 0;

      car.totalReviews =
        ratingResult[0].totalReviews || 0;

      car.bookingCount =
        bookingResult[0].bookingCount || 0;
    }

    // =====================================
    // FINAL RESPONSE
    // =====================================
    return res.json({
      success: true,
      data: cars,
    });

  } catch (err) {

    console.error("Error fetching cars:", err);

    return res.status(500).json({
      success: false,
      message: "Error fetching cars",
      error: err.message,
    });
  }
};



// get all product detiles page 

exports.getCarsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate input
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "Missing userId parameter",
      });
    }

    // Fetch all cars belonging to this user
    const [cars] = await db.execute(
      `SELECT 
         c.id,
         c.userId,
         c.title,
         c.city,
         c.pricePerHour,
         c.securityDeposit,
         c.seats,
         c.doors,
         c.luggageCapacity,
         c.fuelType,
         c.transmissionType,
         c.carLocation,
         c.carCategoryId,
         c.lat,
         c.lng,
         c.driverAvailable,
         c.pickupDropAvailable,
         c.createdAt,
         c.updatedAt,
         c.carApprovalStatus,
         c.repairMode,
         c.carEnabled,
         u.name AS hostName,
         u.phoneNumber AS ownerPhone
       FROM cars c
       JOIN users u ON c.userId = u.id
       WHERE c.userId = ?
       ORDER BY c.createdAt DESC`,
      [userId]
    );

    if (cars.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No cars found for this user",
      });
    }

    // Enrich each car with related info
    for (const car of cars) {

      // Images
      const [images] = await db.execute(
        "SELECT imagePath FROM car_images WHERE carId = ?",
        [car.id]
      );

      // Documents
      const [documents] = await db.execute(
        "SELECT type, filePath FROM car_documents WHERE carId = ?",
        [car.id]
      );

      // Features
      const [features] = await db.execute(
        "SELECT feature FROM car_features WHERE carId = ?",
        [car.id]
      );

      // Ratings
      const [ratingResult] = await db.execute(
        `SELECT 
          AVG(rating) AS avgRating, 
          COUNT(*) AS totalReviews 
         FROM car_reviews 
         WHERE carId = ?`,
        [car.id]
      );

      // Bookings
      const [bookingResult] = await db.execute(
        "SELECT COUNT(*) AS bookingCount FROM reservations WHERE carId = ?",
        [car.id]
      );

      car.images = images.map((i) => i.imagePath);

      car.documents = documents;

      car.features = features.map((f) => f.feature);

      car.avgRating = ratingResult[0].avgRating
        ? parseFloat(Number(ratingResult[0].avgRating).toFixed(1))
        : 0;

      car.totalReviews = Number(ratingResult[0].totalReviews) || 0;

      car.bookingCount = Number(bookingResult[0].bookingCount) || 0;
    }

    res.status(200).json({
      success: true,
      totalCars: cars.length,
      data: cars,
    });

  } catch (err) {
    console.error("Error fetching cars by userId:", err);

    res.status(500).json({
      success: false,
      message: "Error fetching cars by userId",
      error: err.message,
    });
  }
};



exports.getCarById = async (req, res) => {
  try {
    const { id } = req.params;

    const [cars] = await db.execute(
      `SELECT 
          c.*, 
          u.name AS hostName, 
          u.phoneNumber AS hostPhone,
          u.profilePic AS hostProfilePic,
          u.drivingLicenseImg AS hostDlFront,
          u.drivingLicenseBackImg AS hostDlBack,
          u.idProofImg AS hostIdFront,
          u.idProofBackImg AS hostIdBack
       FROM cars c
       JOIN users u ON c.userId = u.id
       WHERE c.id = ?`,
      [id]
    );

    if (cars.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const car = cars[0];

    const [images] = await db.execute(
      "SELECT imagePath FROM car_images WHERE carId = ?",
      [id]
    );

    const [documents] = await db.execute(
      "SELECT type, filePath FROM car_documents WHERE carId = ?",
      [id]
    );

    const [features] = await db.execute(
      "SELECT feature FROM car_features WHERE carId = ?",
      [id]
    );

    const [ratingResult] = await db.execute(
      `SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews
       FROM car_reviews WHERE carId = ?`,
      [id]
    );

    const [bookingResult] = await db.execute(
      "SELECT COUNT(*) AS bookingCount FROM reservations WHERE carId = ?",
      [id]
    );

    // SAFE numeric handling
    const avgRatingRaw = ratingResult[0].avgRating;

    car.images = images.map(i => i.imagePath);
    car.documents = documents;
    car.features = features.map(f => f.feature);
    car.avgRating = avgRatingRaw
      ? Number(parseFloat(avgRatingRaw).toFixed(1))
      : 0;
    car.totalReviews = ratingResult[0].totalReviews || 0;
    car.bookingCount = bookingResult[0].bookingCount || 0;

    res.json({ success: true, data: car });
  } catch (err) {
    console.error("Error fetching car:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching car",
      error: err.message,
    });
  }
};



// ================================
// Update Car Listing
// ================================
exports.updateCar = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params; // carId
    const userId = req.user.id;

    // Parse JSON string
    const carData = JSON.parse(req.body.carData);

    const {
      title,
      city,
      pricePerHour,
      securityDeposit = 0, // ✅ Added new field
      seats,
      doors,
      luggageCapacity,
      fuelType,
      transmissionType,
      carLocation,
      carCategoryId,
      lat,
      long,
      driverAvailable = false,
      pickupDropAvailable = false,
      carFeatures = [],
    } = carData;

    // Check ownership
    const [existing] = await connection.execute(
      "SELECT id FROM cars WHERE id = ? AND userId = ?",
      [id, userId]
    );

    if (existing.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized or car not found",
      });
    }

    // ✅ Update cars table
    await connection.execute(
      `UPDATE cars SET
        title = ?, 
        city = ?, 
        pricePerHour = ?, 
        securityDeposit = ?, 
        seats = ?, 
        doors = ?, 
        luggageCapacity = ?, 
        fuelType = ?, 
        transmissionType = ?, 
        carLocation = ?, 
        carCategoryId = ?, 
        lat = ?, 
        lng = ?, 
        driverAvailable = ?, 
        pickupDropAvailable = ?
      WHERE id = ?`,
      [
        title,
        city,
        pricePerHour,
        securityDeposit, // new field
        seats,
        doors,
        luggageCapacity,
        fuelType,
        transmissionType,
        carLocation,
        carCategoryId,
        lat,
        long,
        driverAvailable,
        pickupDropAvailable,
        id,
      ]
    );

    // ✅ Replace car features
    await connection.execute(
      "DELETE FROM car_features WHERE carId = ?",
      [id]
    );

    if (carFeatures.length > 0) {
      for (let feature of carFeatures) {
        await connection.execute(
          `INSERT INTO car_features (carId, feature) VALUES (?, ?)`,
          [id, feature]
        );
      }
    }

    // ✅ Add new car images (optional)
    if (req.files && req.files.carImages) {
      for (let file of req.files.carImages) {
        const upload = await uploadToS3(
          file.buffer,
          file.originalname,
          "car-images"
        );
        await connection.execute(
          `INSERT INTO car_images (carId, imagePath) VALUES (?, ?)`,
          [id, upload.Location]
        );
      }
    }

    // ✅ Add new documents (optional)
    const docTypes = ["rc", "insurance", "pollution", "aadhar", "license", "video"];
    if (req.files) {
      for (let type of docTypes) {
        if (req.files[type]) {
          for (let file of req.files[type]) {
            const upload = await uploadToS3(
              file.buffer,
              file.originalname,
              "car-documents"
            );
            await connection.execute(
              `INSERT INTO car_documents (carId, type, filePath) VALUES (?, ?, ?)`,
              [id, type, upload.Location]
            );
          }
        }
      }
    }

    await connection.commit();
    res.json({
      success: true,
      message: "Car listing updated successfully",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error updating car:", err);
    res.status(500).json({
      success: false,
      message: "Error updating car",
      error: err.message,
    });
  } finally {
    connection.release();
  }
};



// ================================
// Delete Car Listing
// ================================
exports.deleteCar = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify car ownership
    const [car] = await connection.execute(
      "SELECT id FROM cars WHERE id = ? AND userId = ?",
      [id, userId]
    );
    if (car.length === 0) {
      return res.status(403).json({ success: false, message: "Unauthorized or car not found" });
    }

    // Delete all related data first (to maintain referential integrity)
    await connection.execute("DELETE FROM car_images WHERE carId = ?", [id]);
    await connection.execute("DELETE FROM car_documents WHERE carId = ?", [id]);
    await connection.execute("DELETE FROM car_features WHERE carId = ?", [id]);
    await connection.execute("DELETE FROM car_reviews WHERE carId = ?", [id]);
    await connection.execute("DELETE FROM reservations WHERE carId = ?", [id]);

    // Delete car itself
    await connection.execute("DELETE FROM cars WHERE id = ?", [id]);

    await connection.commit();
    res.json({ success: true, message: "Car deleted successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("Error deleting car:", err);
    res.status(500).json({ success: false, message: "Error deleting car", error: err.message });
  } finally {
    connection.release();
  }
};


// ================================
// Enable / Disable Car (0 or 1)
// ================================
exports.toggleCarEnabled = async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body; // expects 1 or 0
    const userId = req.user.id; // from auth middleware

    // ✅ Validate input
    if (enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid 'enabled' value. Use 1 (enable) or 0 (disable).",
      });
    }

    // ✅ Check ownership
    const [cars] = await db.query("SELECT id FROM cars WHERE id = ? AND userId = ?", [id, userId]);
    if (cars.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found or not owned by user",
      });
    }

    // ✅ Update
    await db.query("UPDATE cars SET carEnabled = ? WHERE id = ?", [enabled, id]);

    res.json({
      success: true,
      message: `Car ${enabled ? "enabled" : "disabled"} successfully`,
    });
  } catch (err) {
    console.error("Error updating carEnabled:", err);
    res.status(500).json({
      success: false,
      message: "Error updating car",
      error: err.message,
    });
  }
};


exports.toggleCarRepairMode = async (req, res) => {
  try {
    const { id } = req.params;
    const { repairMode } = req.body; // expects 1 (enable) or 0 (disable)
    const userId = req.user.id; // from protect middleware

    // ✅ Validate input
    if (repairMode !== 0 && repairMode !== 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid 'repairMode' value. Use 1 (enable) or 0 (disable).",
      });
    }

    // ✅ Check ownership
    const [cars] = await db.query(
      "SELECT id FROM cars WHERE id = ? AND userId = ?",
      [id, userId]
    );

    if (cars.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found or not owned by user.",
      });
    }

    // ✅ Update repairMode
    await db.query("UPDATE cars SET repairMode = ? WHERE id = ?", [
      repairMode,
      id,
    ]);

    // ✅ Respond to client
    res.json({
      success: true,
      message: `Car repair mode ${repairMode ? "enabled" : "disabled"} successfully.`,
    });
  } catch (err) {
    console.error("Error updating repairMode:", err);
    res.status(500).json({
      success: false,
      message: "Error updating car repair mode.",
      error: err.message,
    });
  }
};




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



