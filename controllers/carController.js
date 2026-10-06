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
    // 1. GET PAGINATION PARAMETERS
    // =====================================
    const page = parseInt(req.query.page) || 1; 
    const limit = parseInt(req.query.limit) || 10; 
    const offset = (page - 1) * limit;

    // =====================================
    // 2. GET TOTAL COUNT FOR PAGINATION
    // =====================================
    const [countResult] = await db.execute(
      "SELECT COUNT(*) AS totalCars FROM cars WHERE carApprovalStatus = 'APPROVED'"
    );
    const totalCars = countResult[0].totalCars;
    const totalPages = Math.ceil(totalCars / limit);

    // =====================================
    // 3. GET PAGINATED APPROVED CARS
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
      LIMIT ${limit} OFFSET ${offset}
      `
    );

    // =====================================
    // 4. DETAILS FOR ALL CARS ON THIS PAGE IN 5 BATCHED QUERIES
    // =====================================
    // (Was 6 queries per car — ~60 round-trips to the remote DB for a page
    // of 10. Car documents are no longer included: the list doesn't need
    // them and this endpoint is public.)
    const carIds = cars.map((c) => c.id);
    const byCar = (rows) => {
      const map = new Map();
      for (const r of rows) {
        if (!map.has(r.carId)) map.set(r.carId, []);
        map.get(r.carId).push(r);
      }
      return map;
    };

    let imagesByCar = new Map(), featuresByCar = new Map();
    let ratingByCar = new Map(), bookingsByCar = new Map(), selfBookByCar = new Map();

    if (carIds.length > 0) {
      const ph = carIds.map(() => "?").join(",");
      const [[images], [features], [ratings], [bookings], [selfBookings]] = await Promise.all([
        db.query(`SELECT carId, imagePath FROM car_images WHERE carId IN (${ph}) ORDER BY id`, carIds),
        db.query(`SELECT carId, feature FROM car_features WHERE carId IN (${ph}) ORDER BY id`, carIds),
        db.query(`SELECT carId, AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId IN (${ph}) GROUP BY carId`, carIds),
        db.query(`SELECT carId, COUNT(*) AS bookingCount FROM reservations WHERE carId IN (${ph}) GROUP BY carId`, carIds),
        db.query(`SELECT carId, MIN(endDate) AS freeAfter FROM reservations WHERE carId IN (${ph}) AND status = 'SELFBOOK' AND endDate >= NOW() GROUP BY carId`, carIds),
      ]);
      imagesByCar = byCar(images);
      featuresByCar = byCar(features);
      ratingByCar = new Map(ratings.map((r) => [r.carId, r]));
      bookingsByCar = new Map(bookings.map((r) => [r.carId, r.bookingCount]));
      selfBookByCar = new Map(selfBookings.map((r) => [r.carId, r.freeAfter]));
    }

    const formattedCars = cars.map((car) => {
      const rating = ratingByCar.get(car.id);
      const avgRatingRaw = rating?.avgRating;
      const freeAfter = selfBookByCar.get(car.id) ?? null;
      return {
        ...car,
        selfBook: freeAfter !== null,
        freeAfter,
        images: (imagesByCar.get(car.id) || []).map((img) => img.imagePath),
        features: (featuresByCar.get(car.id) || []).map((f) => f.feature),
        avgRating: avgRatingRaw ? Number(parseFloat(avgRatingRaw).toFixed(1)) : 0,
        totalReviews: Number(rating?.totalReviews || 0),
        bookingCount: Number(bookingsByCar.get(car.id) || 0),
      };
    });

    // =====================================
    // 5. SEND FAST PAGINATED RESPONSE
    // =====================================
    return res.status(200).json({
      success: true,
      pagination: {
        totalCars,
        currentPage: page,
        totalPages,
        limit
      },
      data: formattedCars, // Use the fast formatted array here
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
      "SELECT id, carApprovalStatus FROM cars WHERE id = ? AND userId = ?",
      [id, userId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Unauthorized or car not found",
      });
    }

    // A car waiting for admin review can't be edited until it's reviewed.
    if (existing[0].carApprovalStatus === "PENDING") {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "This car is pending admin approval. You can edit it once it has been reviewed.",
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
        pickupDropAvailable = ?,
        carApprovalStatus = 'PENDING'
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

    // A listing must keep at least one photo.
    const newImageCount = req.files?.carImages?.length || 0;
    if (Array.isArray(carData.images) && carData.images.length === 0 && newImageCount === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Please keep at least one car photo.",
      });
    }

    // ✅ Remove images the host deleted in the app. The app sends the
    // already-uploaded URLs it kept in carData.images.
    if (Array.isArray(carData.images)) {
      const [currentImages] = await connection.execute(
        "SELECT id, imagePath FROM car_images WHERE carId = ?",
        [id]
      );
      for (const img of currentImages) {
        if (!carData.images.includes(img.imagePath)) {
          await connection.execute("DELETE FROM car_images WHERE id = ?", [img.id]);
        }
      }
    }

    // ✅ Add new car images (optional)
    if (req.files && req.files.carImages) {
      for (let file of req.files.carImages) {
        // uploadToS3(file, folder) takes the multer file and returns the URL
        const imageUrl = await uploadToS3(file, "car-images");
        await connection.execute(
          `INSERT INTO car_images (carId, imagePath) VALUES (?, ?)`,
          [id, imageUrl]
        );
      }
    }

    // ✅ Add new documents (optional)
    const docTypes = ["rc", "insurance", "pollution", "aadhar", "license", "video"];
    if (req.files) {
      for (let type of docTypes) {
        if (req.files[type]) {
          for (let file of req.files[type]) {
            const docUrl = await uploadToS3(file, "car-documents");
            await connection.execute(
              `INSERT INTO car_documents (carId, type, filePath) VALUES (?, ?, ?)`,
              [id, type, docUrl]
            );
          }
        }
      }
    }

    await connection.commit();
    res.json({
      success: true,
      message: "Car listing updated and sent to admin for approval",
      carApprovalStatus: "PENDING",
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



