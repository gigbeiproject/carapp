const db = require("../../config/db");
const { sendPushToUser } = require("../../utils/pushNotification");
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
    const docs = (req.query.docs || "ALL").toUpperCase(); // ALL | UPLOADED | MISSING
    const verified = (req.query.verified || "ALL").toUpperCase(); // ALL | VERIFIED | UNVERIFIED
    const status = (req.query.status || "ALL").toLowerCase(); // all | active | ban | hold
    const sort = req.query.sort === "oldest" ? "ASC" : "DESC";

    // A user "has documents" if any licence / ID image is uploaded.
    const HAS_DOCS = `(
      COALESCE(u.drivingLicenseImg, '') <> '' OR COALESCE(u.drivingLicenseBackImg, '') <> '' OR
      COALESCE(u.idProofImg, '') <> '' OR COALESCE(u.idProofBackImg, '') <> ''
    )`;
    // Host = owns at least one car (EXISTS instead of GROUP BY over a join).
    const IS_HOST = "EXISTS (SELECT 1 FROM cars c WHERE c.userId = u.id)";

    const searchParts = [];
    const searchParams = [];
    if (search) {
      const like = `%${search}%`;
      searchParts.push("(u.name LIKE ? OR u.email LIKE ? OR u.phoneNumber LIKE ? OR u.id LIKE ?)");
      searchParams.push(like, like, like, like);
    }

    const whereParts = [...searchParts];
    const whereParams = [...searchParams];
    if (role !== "ALL") { whereParts.push("u.role = ?"); whereParams.push(role); }
    if (host === "HOST") whereParts.push(IS_HOST);
    else if (host === "NON_HOST") whereParts.push(`NOT ${IS_HOST}`);
    if (docs === "UPLOADED") whereParts.push(HAS_DOCS);
    else if (docs === "MISSING") whereParts.push(`NOT ${HAS_DOCS}`);
    if (verified === "VERIFIED") whereParts.push("u.isVerified = 1");
    else if (verified === "UNVERIFIED") whereParts.push("(u.isVerified = 0 OR u.isVerified IS NULL)");
    if (["active", "ban", "hold"].includes(status)) { whereParts.push("u.permStatus = ?"); whereParams.push(status); }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM users u ${whereClause}`, whereParams);
    const total = countRows[0].total;

    // Summary cards (search applied, other filters not).
    const summaryWhere = searchParts.length ? `WHERE ${searchParts.join(" AND ")}` : "";
    const [[summary]] = await db.query(
      `SELECT
         COUNT(*) AS total,
         COALESCE(SUM(${IS_HOST}), 0) AS hosts,
         COALESCE(SUM(u.isVerified = 1), 0) AS verified,
         COALESCE(SUM(${HAS_DOCS}), 0) AS withDocuments,
         COALESCE(SUM(${HAS_DOCS} AND (u.isVerified = 0 OR u.isVerified IS NULL)), 0) AS awaitingVerification,
         COALESCE(SUM(u.permStatus = 'ban'), 0) AS banned
       FROM users u ${summaryWhere}`,
      searchParams
    );

    const [users] = await db.query(
      `SELECT
         u.id, u.phoneNumber, u.name, u.email, u.dob,
         u.drivingLicenseImg, u.drivingLicenseBackImg, u.idProofImg, u.idProofBackImg, u.profilePic,
         u.isVerified, u.role, u.permStatus, u.createdAt, u.updatedAt,
         ${IS_HOST} AS host,
         ${HAS_DOCS} AS hasDocuments,
         (SELECT COUNT(*) FROM cars c WHERE c.userId = u.id) AS carsCount,
         (SELECT COUNT(*) FROM reservations r WHERE r.userId = u.id AND r.status <> 'SELFBOOK') AS bookingsCount
       FROM users u
       ${whereClause}
       ORDER BY u.createdAt ${sort}
       LIMIT ? OFFSET ?`,
      [...whereParams, limit, offset]
    );

    // Normalise MySQL 0/1 results to numbers.
    const data = users.map((u) => ({
      ...u,
      host: Number(u.host),
      hasDocuments: Number(u.hasDocuments),
      carsCount: Number(u.carsCount),
      bookingsCount: Number(u.bookingsCount),
    }));
    const summaryOut = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v)]));

    res.json({
      success: true,
      count: data.length,
      data,
      summary: summaryOut,
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
    const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "START", "COMPLETED", "CANCELLED", "SELFBOOK"];
    const status = (req.query.status || "ALL").toUpperCase();
    const sort = req.query.sort === "oldest" ? "ASC" : "DESC"; // newest first by default

    const whereParts = [];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push(
        "(c.title LIKE ? OR c.city LIKE ? OR c.numberPlate LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR h.name LIKE ? OR h.phoneNumber LIKE ? OR r.id LIKE ?)"
      );
      whereParams.push(like, like, like, like, like, like, like, like);
    }
    // Per-status counts for the filter pills (search applied, status not).
    const countsWhere = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const countsParams = [...whereParams];

    if (BOOKING_STATUSES.includes(status)) {
      whereParts.push("r.status = ?");
      whereParams.push(status);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

    // Joins without CONVERT() on both sides so MySQL can use the primary
    // keys. Only reservations.hostId has a different collation from users.id.
    const joins = `
      FROM reservations r
      LEFT JOIN users u ON u.id = r.userId
      LEFT JOIN users h ON h.id = r.hostId COLLATE utf8mb4_unicode_ci
      LEFT JOIN cars c ON c.id = r.carId
    `;
    const fromClause = `${joins} ${whereClause}`;

    const [statusRows] = await db.query(
      `SELECT r.status, COUNT(*) AS n ${joins} ${countsWhere} GROUP BY r.status`,
      countsParams
    );
    const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, row.n]));
    statusCounts.ALL = statusRows.reduce((sum, row) => sum + row.n, 0);

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
        u.email AS userEmail,
        u.drivingLicenseImg AS userDrivingLicenseImg,
        u.idProofImg AS userIdProofImg,
        u.profilePic AS userProfilePic,
        r.carId,
        c.title AS carTitle,
        c.city AS carCity,
        c.numberPlate AS carNumberPlate,
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
        h.email AS hostEmail,
        r.createdAt,
        r.updatedAt
      ${fromClause}
      ORDER BY r.createdAt ${sort}
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );

    if (reservations.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        statusCounts,
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
      statusCounts,
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
    const sort = req.query.sort === "oldest" ? "ASC" : "DESC";

    const whereParts = [];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push(
        "(c.title LIKE ? OR c.city LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR c.fuelType LIKE ? OR c.transmissionType LIKE ? OR c.numberPlate LIKE ? OR cat.name LIKE ?)"
      );
      whereParams.push(like, like, like, like, like, like, like, like);
    }
    // Per-status counts for the filter pills (search applied, status not).
    const countsWhere = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const countsParams = [...whereParams];
    if (status !== "ALL") {
      whereParts.push("c.carApprovalStatus = ?");
      whereParams.push(status);
    }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
    const joins = `FROM cars c
      LEFT JOIN users u ON c.userId = u.id
      LEFT JOIN car_categories cat ON cat.id = c.carCategoryId`;
    const fromClause = `${joins} ${whereClause}`;

    const [statusRows] = await db.query(
      `SELECT c.carApprovalStatus AS status, COUNT(*) AS n ${joins} ${countsWhere} GROUP BY c.carApprovalStatus`,
      countsParams
    );
    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, Number(r.n)]));
    statusCounts.ALL = statusRows.reduce((sum, r) => sum + Number(r.n), 0);

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
        u.email AS hostEmail,
        u.isVerified AS hostVerified,
        u.createdAt AS hostJoinedAt,
        (SELECT COUNT(*) FROM cars c2 WHERE c2.userId = c.userId) AS hostCarsCount,
        c.title,
        c.numberPlate,
        c.city,
        c.carCategoryId,
        cat.name AS categoryName,
        c.pricePerHour,
        c.securityDeposit,
        c.activeFastag,
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
      ORDER BY c.createdAt ${sort}
      LIMIT ? OFFSET ?
      `,
      [...whereParams, limit, offset]
    );

    if (cars.length === 0) {
      return res.json({
        success: true,
        count: 0,
        data: [],
        statusCounts,
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
      statusCounts,
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
    // Newest bookings first by default; "oldest" flips it.
    const sort = req.query.sort === "oldest" ? "oldest" : "newest";

    const whereParts = ["r.status = 'COMPLETED'"];
    const whereParams = [];
    if (search) {
      const like = `%${search}%`;
      whereParts.push("(c.title LIKE ? OR c.city LIKE ? OR u.name LIKE ? OR u.phoneNumber LIKE ? OR r.hostId LIKE ? OR h.name LIKE ? OR h.phoneNumber LIKE ? OR r.id LIKE ?)");
      whereParams.push(like, like, like, like, like, like, like, like);
    }
    if (settlementStatus !== "ALL") {
      whereParts.push("r.settlementStatus = ?");
      whereParams.push(settlementStatus);
    }
    const whereClause = `WHERE ${whereParts.join(" AND ")}`;
    const fromClause = `
      FROM reservations r
      LEFT JOIN users u ON r.userId = u.id
      -- reservations.hostId and users.id use different collations
      LEFT JOIN users h ON h.id = r.hostId COLLATE utf8mb4_unicode_ci
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
        u.email AS userEmail,
        h.name AS hostName,
        h.phoneNumber AS hostPhone,
        h.email AS hostEmail,
        EXISTS(SELECT 1 FROM bank_accounts b WHERE b.userId = r.hostId) AS hostHasBankAccount,
        c.title AS carTitle,
        c.numberPlate AS carNumberPlate,
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
      ORDER BY r.createdAt ${sort === "oldest" ? "ASC" : "DESC"}
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




// GET /admin/users/:userId/bank-accounts — a host's payout bank details,
// for settling transactions from the admin panel.
exports.getUserBankAccounts = async (req, res) => {
  try {
    const { userId } = req.params;
    const [users] = await db.query("SELECT id, name, phoneNumber, email FROM users WHERE id = ? LIMIT 1", [userId]);
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const [accounts] = await db.query(
      `SELECT id, accountHolderName, accountNumber, ifscCode, bankName, branchName, createdAt, updatedAt
         FROM bank_accounts WHERE userId = ? ORDER BY updatedAt DESC`,
      [userId]
    );
    res.json({ success: true, user: users[0], data: accounts });
  } catch (err) {
    console.error("Error fetching bank accounts:", err);
    res.status(500).json({ success: false, message: "Error fetching bank accounts", error: err.message });
  }
};


// GET /admin/dashboard — overview numbers for the admin Dashboard page.
exports.getDashboard = async (req, res) => {
  try {
    const n = (v) => Number(v || 0);
    const [
      [[users]],
      [[cars]],
      [bookingRows],
      [[money]],
      [monthly],
      [recent],
    ] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) AS total,
          SUM(createdAt >= NOW() - INTERVAL 7 DAY) AS newThisWeek,
          SUM(EXISTS (SELECT 1 FROM cars c WHERE c.userId = u.id)) AS hosts,
          SUM(isVerified = 1) AS verified,
          SUM((COALESCE(drivingLicenseImg,'') <> '' OR COALESCE(drivingLicenseBackImg,'') <> ''
               OR COALESCE(idProofImg,'') <> '' OR COALESCE(idProofBackImg,'') <> '')
              AND (isVerified = 0 OR isVerified IS NULL)) AS awaitingVerification,
          SUM(permStatus = 'ban') AS banned
        FROM users u`),
      db.query(`
        SELECT
          COUNT(*) AS total,
          SUM(carApprovalStatus = 'APPROVED') AS approved,
          SUM(carApprovalStatus = 'PENDING') AS pending,
          SUM(carApprovalStatus = 'REJECTED') AS rejected,
          SUM(carApprovalStatus = 'APPROVED' AND carEnabled = 1 AND repairMode = 0) AS live
        FROM cars`),
      db.query(`SELECT status, COUNT(*) AS n FROM reservations GROUP BY status`),
      db.query(`
        SELECT
          SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END) AS completedRevenue,
          SUM(CASE WHEN status IN ('CONFIRMED','START','COMPLETED') AND createdAt >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN amount ELSE 0 END) AS thisMonthBookings,
          SUM(CASE WHEN status = 'COMPLETED' AND settlementStatus = 'PENDING' THEN amount ELSE 0 END) AS pendingSettlementAmount,
          SUM(status = 'COMPLETED' AND settlementStatus = 'PENDING') AS pendingSettlements,
          SUM(CASE WHEN status = 'COMPLETED' AND settlementStatus = 'SETTLED' THEN amount ELSE 0 END) AS settledAmount,
          SUM(status = 'START') AS ongoing,
          SUM(status = 'CONFIRMED' AND startDate >= NOW()) AS upcoming
        FROM reservations`),
      db.query(`
        SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month,
               COUNT(*) AS bookings,
               SUM(amount) AS amount
          FROM reservations
         WHERE status IN ('CONFIRMED','START','COMPLETED')
           AND createdAt >= DATE_FORMAT(NOW() - INTERVAL 5 MONTH, '%Y-%m-01')
         GROUP BY month ORDER BY month`),
      db.query(`
        SELECT r.id, r.status, r.amount, r.startDate, r.endDate, r.createdAt,
               c.title AS carTitle, c.city AS carCity, u.name AS userName, u.phoneNumber AS userPhone
          FROM reservations r
          LEFT JOIN cars c ON c.id = r.carId
          LEFT JOIN users u ON u.id = r.userId
         WHERE r.status <> 'SELFBOOK'
         ORDER BY r.createdAt DESC
         LIMIT 6`),
    ]);

    const bookings = Object.fromEntries(bookingRows.map((r) => [r.status, n(r.n)]));
    res.json({
      success: true,
      users: Object.fromEntries(Object.entries(users).map(([k, v]) => [k, n(v)])),
      cars: Object.fromEntries(Object.entries(cars).map(([k, v]) => [k, n(v)])),
      bookings: { ...bookings, total: Object.entries(bookings).filter(([s]) => s !== 'SELFBOOK').reduce((a, [, v]) => a + v, 0) },
      money: Object.fromEntries(Object.entries(money).map(([k, v]) => [k, n(v)])),
      monthly: monthly.map((m) => ({ month: m.month, bookings: n(m.bookings), amount: n(m.amount) })),
      recentBookings: recent,
      refunds: await (async () => {
        const [[r]] = await db.query("SELECT COUNT(*) AS pending, COALESCE(SUM(amount), 0) AS pendingAmount FROM refund_requests WHERE status = 'PENDING'");
        return { pending: Number(r.pending), pendingAmount: Number(r.pendingAmount) };
      })(),
    });
  } catch (err) {
    console.error("Error building dashboard:", err);
    res.status(500).json({ success: false, message: "Error loading dashboard", error: err.message });
  }
};


// GET /admin/refunds — refund requests from customers who skipped KYC.
exports.getRefundRequests = async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = (req.query.status || "ALL").toUpperCase();
    const search = (req.query.search || "").trim();

    const where = [];
    const params = [];
    if (["PENDING", "REFUNDED", "REJECTED"].includes(status)) { where.push("rr.status = ?"); params.push(status); }
    if (search) {
      const like = `%${search}%`;
      where.push("(u.name LIKE ? OR u.phoneNumber LIKE ? OR c.title LIKE ? OR rr.paymentId LIKE ? OR rr.reservationId LIKE ?)");
      params.push(like, like, like, like, like);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const joins = `
      FROM refund_requests rr
      JOIN reservations r ON r.id = rr.reservationId
      LEFT JOIN users u ON u.id = rr.userId
      LEFT JOIN users h ON h.id = r.hostId COLLATE utf8mb4_unicode_ci
      LEFT JOIN cars c ON c.id = r.carId`;

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${joins} ${whereClause}`, params);
    const [statusRows] = await db.query(`SELECT rr.status, COUNT(*) AS n, SUM(rr.amount) AS amount FROM refund_requests rr GROUP BY rr.status`);
    const statusCounts = { ALL: 0 };
    const statusAmounts = {};
    statusRows.forEach((row) => {
      statusCounts[row.status] = Number(row.n);
      statusCounts.ALL += Number(row.n);
      statusAmounts[row.status] = Number(row.amount || 0);
    });

    const [rows] = await db.query(
      `SELECT rr.*, r.startDate, r.endDate, r.totalHours, r.orderId, r.createdAt AS bookedAt,
              c.title AS carTitle, c.city AS carCity, c.numberPlate AS carNumberPlate,
              u.name AS userName, u.phoneNumber AS userPhone, u.email AS userEmail,
              h.name AS hostName, h.phoneNumber AS hostPhone
       ${joins} ${whereClause}
       ORDER BY (rr.status = 'PENDING') DESC, rr.createdAt DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: rows, statusCounts, statusAmounts, pagination: buildPaginationMeta(page, limit, total) });
  } catch (err) {
    console.error("Error fetching refund requests:", err);
    res.status(500).json({ success: false, message: "Error fetching refund requests", error: err.message });
  }
};

// PUT /admin/refunds/:id  { status: REFUNDED | REJECTED, adminNote }
// Records the outcome — the money itself is refunded from the Razorpay
// dashboard using the payment ID shown in the admin panel.
exports.updateRefundRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "").toUpperCase();
    const adminNote = req.body?.adminNote ? String(req.body.adminNote).slice(0, 500) : null;
    if (!["REFUNDED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be REFUNDED, REJECTED or PENDING" });
    }
    const [result] = await db.query(
      `UPDATE refund_requests
          SET status = ?, adminNote = ?, processedBy = ?, processedAt = ${status === "PENDING" ? "NULL" : "NOW()"}
        WHERE id = ?`,
      [status, adminNote, req.user?.id || null, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "Refund request not found" });

    const [[rr]] = await db.query("SELECT userId, amount FROM refund_requests WHERE id = ?", [id]);
    if (rr && status === "REFUNDED") {
      sendPushToUser(rr.userId, {
        title: "💰 Refund Processed",
        body: `Your refund of ₹${Number(rr.amount).toLocaleString("en-IN")} has been processed. It may take 5–7 working days to reach your account.`,
        data: { type: "REFUND_PROCESSED", refundId: id },
      });
    }
    res.json({ success: true, message: `Refund marked ${status}` });
  } catch (err) {
    console.error("Error updating refund request:", err);
    res.status(500).json({ success: false, message: "Error updating refund request", error: err.message });
  }
};
