const db = require("../../config/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { parsePagination, buildPaginationMeta } = require("../../utils/pagination");

// ✅ Get all users
  exports.getAllUsers = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || "").trim();
    const role = (req.query.role || "ALL").toUpperCase();
    const host = (req.query.host || "ALL").toUpperCase(); // ALL | HOST | NON_HOST

    const whereParts = [];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push("(u.name LIKE ? OR u.email LIKE ? OR u.phoneNumber LIKE ?)");
      whereParams.push(like, like, like);
    }
    if (role !== "ALL") {
      whereParts.push("u.role = ?");
      whereParams.push(role);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    let havingClause = "";
    if (host === "HOST") havingClause = "HAVING host = 1";
    else if (host === "NON_HOST") havingClause = "HAVING host = 0";

    // host is an aggregate (COUNT over the LEFT JOIN), so both the count
    // and the page query are built from the same filtered/grouped subquery.
    const filteredQuery = `
      SELECT
        u.id,
        u.phoneNumber,
        u.name,
        u.email,
        u.dob,
        u.drivingLicenseImg,
        u.idProofImg,
        u.profilePic,
        u.isVerified,
        u.role,
        u.permStatus,
        u.createdAt,
        u.updatedAt,
        CASE
          WHEN COUNT(c.id) > 0 THEN 1
          ELSE 0
        END AS host
      FROM users u
      LEFT JOIN cars c ON u.id = c.userId
      ${whereClause}
      GROUP BY
        u.id, u.phoneNumber, u.name, u.email, u.dob, u.drivingLicenseImg,
        u.idProofImg, u.profilePic, u.isVerified, u.role,
        u.permStatus, u.createdAt, u.updatedAt
      ${havingClause}
    `;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM (${filteredQuery}) AS filtered_users`,
      whereParams
    );
    const total = countRows[0].total;

    const [users] = await db.query(
      `${filteredQuery} ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    res.json({
      success: true,
      count: users.length,
      data: users,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching users",
      error: err.message,
    });
  }
};





// ✅ Admin Login Controller
exports.adminLogin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  try {
    // ✅ Find admin by email and role
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE email = ? AND role = 'admin'",
      [email]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin not found or not authorized.",
      });
    }

    const admin = rows[0];

    // ✅ Check account status
    if (admin.permStatus === "ban") {
      return res.status(403).json({ success: false, message: "Account is banned." });
    }

    if (admin.permStatus === "hold") {
      return res.status(403).json({ success: false, message: "Account is on hold." });
    }

    // ✅ Verify password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid password." });
    }

    // ✅ Generate JWT token
    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Admin login successful.",
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permStatus: admin.permStatus,
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


exports.updateUserVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    if (isVerified !== 0 && isVerified !== 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid value for isVerified (must be 0 or 1)",
      });
    }

    const [result] = await db.execute(
      "UPDATE users SET isVerified = ?, updatedAt = NOW() WHERE id = ?",
      [isVerified, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: `User verification status updated to ${isVerified}`,
    });
  } catch (err) {
    console.error("Error updating user verification:", err);
    res.status(500).json({
      success: false,
      message: "Error updating user verification",
      error: err.message,
    });
  }
};

// ✅ 2. Update user permission status (permStatus)
exports.updateUserPermStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { permStatus } = req.body;

    const validStatuses = ["active", "hold", "ban"];
    if (!validStatuses.includes(permStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid permStatus value (must be active, hold, or ban)",
      });
    }

    const [result] = await db.execute(
      "UPDATE users SET permStatus = ?, updatedAt = NOW() WHERE id = ?",
      [permStatus, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: `User permission status changed to '${permStatus}'`,
    });
  } catch (err) {
    console.error("Error updating user permStatus:", err);
    res.status(500).json({
      success: false,
      message: "Error updating user permStatus",
      error: err.message,
    });
  }
};



// booking
exports.getAllReservations = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || "").trim();

    const whereParts = [];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push(
        "(c.title LIKE ? OR c.city LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR h.name LIKE ? OR h.phoneNumber LIKE ? OR r.status LIKE ? OR r.settlementStatus LIKE ?)"
      );
      whereParams.push(like, like, like, like, like, like, like, like);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const fromClause = `
      FROM reservations r
      LEFT JOIN users u ON CONVERT(r.userId USING utf8mb4) = CONVERT(u.id USING utf8mb4)
      LEFT JOIN users h ON CONVERT(r.hostId USING utf8mb4) = CONVERT(h.id USING utf8mb4)
      LEFT JOIN cars c ON CONVERT(r.carId USING utf8mb4) = CONVERT(c.id USING utf8mb4)
      ${whereClause}
    `;

    const [countRows] = await db.query(`SELECT COUNT(*) AS total ${fromClause}`, whereParams);
    const total = countRows[0].total;

    // 1️⃣ Fetch this page of reservations with user, host, and car details
    const [reservations] = await db.query(
      `
      SELECT
        r.id,
        r.userId,
        u.name AS userName,
        u.phoneNumber AS userPhone,
        r.carId,
        c.title AS carTitle,
        c.city AS carCity,
        r.startDate,
        r.endDate,
        r.bookingStartDateTime,
        r.bookingEndDateTime,
        r.amount,
        r.totalHours,
        r.userLocation,
        r.userLat,
        r.userLong,
        r.doorstepAmount,
        r.doorstepDistance,
        r.couponCode,
        r.customAddress,
        r.status,
        r.paymentId,
        r.orderId,
        r.settlementStatus,
        r.hostId,
        h.name AS hostName,
        h.phoneNumber AS hostPhone,
        r.createdAt,
        r.updatedAt
      ${fromClause}
      ORDER BY r.createdAt DESC
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );

    if (reservations.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        pagination: buildPaginationMeta(page, limit, total),
      });
    }

    // 2️⃣ Get reservation IDs
    const reservationIds = reservations.map(r => r.id);

    // 3️⃣ Fetch all photos for these reservations
    const [photos] = await db.execute(
      `SELECT * FROM reservation_photos WHERE reservationId IN (${reservationIds.map(() => "?").join(",")})`,
      reservationIds
    );

    // 4️⃣ Map photos to reservations with separate arrays
    const photosMap = {};
    photos.forEach(p => {
      if (!photosMap[p.reservationId]) photosMap[p.reservationId] = { pickup: [], drop: [] };
      if (p.photoType === 'PICKUP') photosMap[p.reservationId].pickup.push({ photoUrl: p.photoUrl, createdAt: p.createdAt });
      if (p.photoType === 'DROP') photosMap[p.reservationId].drop.push({ photoUrl: p.photoUrl, createdAt: p.createdAt });
    });

    // 5️⃣ Add pickup and drop arrays to each reservation
    const reservationsWithPhotos = reservations.map(r => ({
      ...r,
      photosPickup: photosMap[r.id]?.pickup || [],
      photosDrop: photosMap[r.id]?.drop || [],
    }));

    // ✅ Return
    res.json({
      success: true,
      count: reservationsWithPhotos.length,
      data: reservationsWithPhotos,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Error fetching reservations:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching reservations",
      error: err.message,
    });
  }
};





exports.getAllCars = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || "").trim();
    const status = (req.query.status || "ALL").toUpperCase();

    const whereParts = [];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push(
        "(c.title LIKE ? OR c.city LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR c.fuelType LIKE ? OR c.transmissionType LIKE ?)"
      );
      whereParams.push(like, like, like, like, like, like);
    }
    if (status !== "ALL") {
      whereParts.push("c.carApprovalStatus = ?");
      whereParams.push(status);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const fromClause = `FROM cars c LEFT JOIN users u ON c.userId = u.id ${whereClause}`;

    const [countRows] = await db.query(`SELECT COUNT(*) AS total ${fromClause}`, whereParams);
    const total = countRows[0].total;

    // 1️⃣ Fetch this page of cars with host details
    const [cars] = await db.query(
      `
      SELECT
        c.id,
        c.userId,
        u.name AS hostName,
        u.phoneNumber AS hostPhone,
        c.title,
        c.city,
        c.pricePerHour,
        c.seats,
        c.doors,
        c.luggageCapacity,
        c.fuelType,
        c.transmissionType,
        c.carLocation,
        c.lat,
        c.lng,
        c.driverAvailable,
        c.pickupDropAvailable,
        c.carApprovalStatus,
        c.repairMode,
        c.carEnabled,
        c.createdAt,
        c.updatedAt
      ${fromClause}
      ORDER BY c.createdAt DESC
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );

    if (cars.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        pagination: buildPaginationMeta(page, limit, total),
      });
    }

    // 2️⃣ Collect all car IDs
    const carIds = cars.map((car) => car.id);

    // 3️⃣ Fetch images, documents, and features in parallel
    const [images] = await db.execute(
      `SELECT carId, imagePath FROM car_images WHERE carId IN (${carIds.map(() => "?").join(",")})`,
      carIds
    );

    const [documents] = await db.execute(
      `SELECT carId, type, filePath FROM car_documents WHERE carId IN (${carIds.map(() => "?").join(",")})`,
      carIds
    );

    const [features] = await db.execute(
      `SELECT carId, feature FROM car_features WHERE carId IN (${carIds.map(() => "?").join(",")})`,
      carIds
    );

    // 4️⃣ Merge images, documents, and features into cars
    const carsWithDetails = cars.map((car) => ({
      ...car,
      images: images.filter((img) => img.carId === car.id).map((i) => i.imagePath),
      documents: documents
        .filter((doc) => doc.carId === car.id)
        .map((d) => ({ type: d.type, filePath: d.filePath })),
      features: features.filter((f) => f.carId === car.id).map((f) => f.feature),
    }));

    // 5️⃣ Send response
    res.json({
      success: true,
      count: carsWithDetails.length,
      data: carsWithDetails,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Error fetching cars with details:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching cars with details",
      error: err.message,
    });
  }
};

exports.updateCarApprovalStatus = async (req, res) => {
  try {
    const { id } = req.params; // car ID from URL
    const { carApprovalStatus } = req.body; // new status

    // 1️⃣ Validate status
    const allowedStatuses = ["PENDING", "APPROVED", "REJECTED"];
    if (!allowedStatuses.includes(carApprovalStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid carApprovalStatus. Allowed values: PENDING, APPROVED, REJECTED",
      });
    }

    // 2️⃣ Check if car exists
    const [car] = await db.execute(`SELECT id FROM cars WHERE id = ?`, [id]);
    if (car.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    // 3️⃣ Update car status
    await db.execute(
      `UPDATE cars SET carApprovalStatus = ?, updatedAt = NOW() WHERE id = ?`,
      [carApprovalStatus, id]
    );

    res.json({
      success: true,
      message: `Car status updated to ${carApprovalStatus}`,
    });
  } catch (err) {
    console.error("Error updating car approval status:", err);
    res.status(500).json({
      success: false,
      message: "Error updating car approval status",
      error: err.message,
    });
  }
};


exports.getCompletedReservations = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = (req.query.search || "").trim();
    const settlementStatus = (req.query.settlementStatus || "ALL").toUpperCase();

    const whereParts = ["r.status = 'COMPLETED'"];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push("(c.title LIKE ? OR c.city LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR r.hostId LIKE ?)");
      whereParams.push(like, like, like, like, like);
    }
    if (settlementStatus !== "ALL") {
      whereParts.push("r.settlementStatus = ?");
      whereParams.push(settlementStatus);
    }
    const whereClause = `WHERE ${whereParts.join(" AND ")}`;
    const fromClause = `
      FROM reservations r
      LEFT JOIN users u ON r.userId = u.id
      LEFT JOIN cars c ON r.carId = c.id
      ${whereClause}
    `;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(r.amount), 0) AS totalAmount ${fromClause}`,
      whereParams
    );
    const total = countRows[0].total;
    // Sum across the whole filtered set (not just this page) so the admin
    // sees the true total, not an understated per-page sum.
    const totalAmount = countRows[0].totalAmount;

    const [reservations] = await db.query(
      `
      SELECT
        r.id,
        r.userId,
        u.name AS userName,
        u.phoneNumber AS userPhone,
        c.title AS carTitle,
        c.city AS carCity,
        r.hostId,
        r.startDate,
        r.endDate,
        r.bookingStartDateTime,
        r.bookingEndDateTime,
        r.amount,
        r.totalHours,
        r.status,
        r.settlementStatus,
        r.paymentId,
        r.orderId,
        r.createdAt,
        r.updatedAt
      ${fromClause}
      ORDER BY r.createdAt DESC
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );

    res.json({
      success: true,
      count: reservations.length,
      data: reservations,
      totalAmount,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Error fetching completed reservations:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching completed reservations",
      error: err.message,
    });
  }
};



// ✅ Update settlementStatus (Admin only)
exports.updateSettlementStatus = async (req, res) => {
  try {
    const { id } = req.params; // Reservation ID
    const { settlementStatus } = req.body; // New status

    // ✅ Validate input
    const validStatuses = ["PENDING", "PROCESSING", "SETTLED","REJECTED"];
    if (!validStatuses.includes(settlementStatus)) {
      return res.status(400).json({
        success: false,
        message: "Invalid settlementStatus value",
      });
    }

    // ✅ Update in database
    const [result] = await db.execute(
      `UPDATE reservations SET settlementStatus = ?, updatedAt = NOW() WHERE id = ?`,
      [settlementStatus, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Reservation not found",
      });
    }

    res.json({
      success: true,
      message: `Reservation settlementStatus updated to '${settlementStatus}'`,
    });
  } catch (err) {
    console.error("Error updating settlementStatus:", err);
    res.status(500).json({
      success: false,
      message: "Error updating settlementStatus",
      error: err.message,
    });
  }
};


