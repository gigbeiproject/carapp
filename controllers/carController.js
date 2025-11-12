const db = require("../config/db");
const s3 = require("../config/s3");
const { v4: uuidv4 } = require("uuid");

// Upload to S3
const uploadToS3 = (fileBuffer, fileName, folder = "cars") => {
  const params = {
    Bucket: "florestawud-assets",
    Key: `${folder}/${Date.now()}-${fileName}`,
    Body: fileBuffer,
  };

  return s3.upload(params).promise();
};

exports.createListing = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const carId = uuidv4();
    const userId = req.user.id; // from JWT middleware

    // Parse carData (JSON string from multipart/form-data)
    const carData = JSON.parse(req.body.carData);

    // Destructure fields with default carCategoryId = null if not provided
    const {
      title,
      city,
      pricePerHour,
      securityDeposit = 0, // ✅ added field
      seats,
      doors,
      luggageCapacity,
      fuelType,
      transmissionType,
      carLocation,
      carCategoryId, // optional
      lat,
      long,
      driverAvailable = false,
      pickupDropAvailable = false,
      carFeatures = [],
    } = carData;

    // ✅ Insert into cars table including the new column
    await connection.execute(
      `INSERT INTO cars 
      (id, userId, title, city, pricePerHour, securityDeposit, seats, doors, luggageCapacity, fuelType, transmissionType, carLocation, carCategoryId, lat, lng, driverAvailable, pickupDropAvailable)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        carId,
        userId,
        title,
        city,
        pricePerHour,
        securityDeposit, // ✅ new value added here
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
      ]
    );

    // Upload Car Images (optional)
    if (req.files && req.files.carImages) {
      for (let file of req.files.carImages) {
        const upload = await uploadToS3(file.buffer, file.originalname, "car-images");
        await connection.execute(
          `INSERT INTO car_images (carId, imagePath) VALUES (?, ?)`,
          [carId, upload.Location]
        );
      }
    }

    // Upload Documents (optional)
    const docTypes = ["rc", "insurance", "pollution", "aadhar", "license", "video"];
    if (req.files) {
      for (let type of docTypes) {
        if (req.files[type]) {
          for (let file of req.files[type]) {
            const upload = await uploadToS3(file.buffer, file.originalname, "car-documents");
            await connection.execute(
              `INSERT INTO car_documents (carId, type, filePath) VALUES (?, ?, ?)`,
              [carId, type, upload.Location]
            );
          }
        }
      }
    }

    // Insert Car Features (optional)
    if (carFeatures.length > 0) {
      for (let feature of carFeatures) {
        await connection.execute(
          `INSERT INTO car_features (carId, feature) VALUES (?, ?)`,
          [carId, feature]
        );
      }
    }

    await connection.commit();
    res
      .status(201)
      .json({ success: true, message: "Car listing created successfully", carId });
  } catch (err) {
    await connection.rollback();
    console.error("Error creating listing:", err);
    res
      .status(500)
      .json({ success: false, message: "Error creating car listing", error: err.message });
  } finally {
    connection.release();
  }
};

// get all permit
exports.getAllCars = async (req, res) => {
  try {
    // Fetch only APPROVED cars along with owner details
    const [cars] = await db.execute(
      `SELECT c.*, u.name AS HostName, u.phoneNumber AS ownerPhone
       FROM cars c
       JOIN users u ON c.userId = u.id
       WHERE c.carApprovalStatus = 'APPROVED'`
    );

    for (const car of cars) {
      // Fetch car images
      const [images] = await db.execute(
        "SELECT imagePath FROM car_images WHERE carId = ?",
        [car.id]
      );

      // Fetch car documents
      const [documents] = await db.execute(
        "SELECT type, filePath FROM car_documents WHERE carId = ?",
        [car.id]
      );

      // Fetch car features
      const [features] = await db.execute(
        "SELECT feature FROM car_features WHERE carId = ?",
        [car.id]
      );

      // Fetch average rating and total reviews
      const [ratingResult] = await db.execute(
        "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
        [car.id]
      );

      // Fetch total bookings
      const [bookingResult] = await db.execute(
        "SELECT COUNT(*) AS bookingCount FROM reservations WHERE carId = ?",
        [car.id]
      );

      // Attach related data
      car.images = images.map((i) => i.imagePath);
      car.documents = documents;
      car.features = features.map((f) => f.feature);
      car.avgRating = ratingResult[0].avgRating
        ? parseFloat(ratingResult[0].avgRating.toFixed(1))
        : 0;
      car.totalReviews = ratingResult[0].totalReviews;
      car.bookingCount = bookingResult[0].bookingCount;
    }

    res.json({ success: true, data: cars });
  } catch (err) {
    console.error("Error fetching cars:", err);
    res
      .status(500)
      .json({
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
        "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
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
        ? parseFloat(ratingResult[0].avgRating.toFixed(1))
        : 0;
      car.totalReviews = ratingResult[0].totalReviews;
      car.bookingCount = bookingResult[0].bookingCount;
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

    // Fetch car along with owner's name and phoneNumber
    const [cars] = await db.execute(
      `SELECT c.*, u.name AS hostName, u.phoneNumber AS hostPhone
       FROM cars c
       JOIN users u ON c.userId = u.id
       WHERE c.id = ?`,
      [id]
    );

    if (cars.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const car = cars[0];

    // Fetch images, documents, and features
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

    // Fetch average rating and total reviews
    const [ratingResult] = await db.execute(
      "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
      [id]
    );

    // Fetch total bookings
    const [bookingResult] = await db.execute(
      "SELECT COUNT(*) AS bookingCount FROM reservations WHERE carId = ?",
      [id]
    );

    car.images = images.map((i) => i.imagePath);
    car.documents = documents;
    car.features = features.map((f) => f.feature);
    car.avgRating = ratingResult[0].avgRating ? parseFloat(ratingResult[0].avgRating.toFixed(1)) : 0;
    car.totalReviews = ratingResult[0].totalReviews;
    car.bookingCount = bookingResult[0].bookingCount;

    res.json({ success: true, data: car });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching car", error: err.message });
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
    const userId = req.user.id; // from JWT middleware
    const carData = JSON.parse(req.body.carData);

    const {
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
      long,
      driverAvailable,
      pickupDropAvailable,
      carFeatures = []
    } = carData;

    // Verify car belongs to user (security)
    const [existing] = await connection.execute(
      "SELECT id FROM cars WHERE id = ? AND userId = ?",
      [id, userId]
    );
    if (existing.length === 0) {
      return res.status(403).json({ success: false, message: "Unauthorized or car not found" });
    }

    // Update car details
    await connection.execute(
      `UPDATE cars SET 
        title = ?, city = ?, pricePerHour = ?, seats = ?, doors = ?, luggageCapacity = ?,
        fuelType = ?, transmissionType = ?, carLocation = ?, carCategoryId = ?, lat = ?, lng = ?, 
        driverAvailable = ?, pickupDropAvailable = ? 
      WHERE id = ?`,
      [
        title, city, pricePerHour, seats, doors, luggageCapacity,
        fuelType, transmissionType, carLocation, carCategoryId,
        lat, long, driverAvailable, pickupDropAvailable, id
      ]
    );

    // Replace features
    await connection.execute("DELETE FROM car_features WHERE carId = ?", [id]);
    if (carFeatures.length > 0) {
      for (let feature of carFeatures) {
        await connection.execute(
          `INSERT INTO car_features (carId, feature) VALUES (?, ?)`,
          [id, feature]
        );
      }
    }

    // Add new images if provided
    if (req.files && req.files.carImages) {
      for (let file of req.files.carImages) {
        const upload = await uploadToS3(file.buffer, file.originalname, "car-images");
        await connection.execute(
          `INSERT INTO car_images (carId, imagePath) VALUES (?, ?)`,
          [id, upload.Location]
        );
      }
    }

    // Add new documents if provided
    const docTypes = ["rc", "insurance", "pollution", "aadhar", "license", "video"];
    if (req.files) {
      for (let type of docTypes) {
        if (req.files[type]) {
          for (let file of req.files[type]) {
            const upload = await uploadToS3(file.buffer, file.originalname, "car-documents");
            await connection.execute(
              `INSERT INTO car_documents (carId, type, filePath) VALUES (?, ?, ?)`,
              [id, type, upload.Location]
            );
          }
        }
      }
    }

    await connection.commit();
    res.json({ success: true, message: "Car listing updated successfully" });

  } catch (err) {
    await connection.rollback();
    console.error("Error updating car:", err);
    res.status(500).json({ success: false, message: "Error updating car", error: err.message });
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



