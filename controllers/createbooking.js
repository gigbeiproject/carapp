const { v4: uuidv4 } = require("uuid");
const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const db = require("../config/db"); // ✅ Add this
const axios = require("axios");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination");
const { sendPushToUser } = require("../utils/pushNotification");
const { validateCouponForBooking } = require("./couponController");

const createBookingOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { carId, startDate, endDate, amount, totalHours, couponCode, couponBaseAmount } = req.body;

    if (!carId || !startDate || !endDate || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // 👉 Coupon check on the server: minimum booking amount, validity dates
    // and per-user usage limit (the app used to keep a coupon applied after
    // the booking amount dropped below its minimum).
    if (couponCode) {
      const couponResult = await validateCouponForBooking({
        code: couponCode,
        baseAmount: couponBaseAmount,
        totalHours,
        userId,
      });
      if (!couponResult.ok) {
        return res.status(400).json({ success: false, message: couponResult.message });
      }
    }

    // 👉 STEP 1: Get user status
    const [userRows] = await db.query(
      "SELECT isVerified FROM users WHERE id = ? LIMIT 1",
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const isVerified = userRows[0].isVerified;

    // 👉 STEP 2: Unverified users can book too. After booking they are asked
    // to complete KYC; until then the host's details stay hidden from them
    // (and theirs from the host), and they can request a refund instead.

    // 👉 STEP 3: Create Razorpay Order
    const options = {
      amount: Math.round(amount * 100), // amount in paise
      currency: "INR",
      receipt: uuidv4(),
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      // Public key id of the Razorpay account that created this order, so the
      // app always opens checkout with the matching key (test vs live).
      keyId: process.env.RAZORPAY_KEY_ID,
    });

  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    // Razorpay errors come as { statusCode, error: { description } } — pass
    // the reason through instead of a generic message.
    const reason = err?.error?.description;
    return res.status(500).json({
      message: reason ? `Payment gateway error: ${reason}` : "Internal server error",
    });
  }
};




const verifyBookingPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      carId,
      startDate,
      endDate,
      amount,
      totalHours,
      userLocation,
      userLat,
      userLong,
      doorstepAmount,
      doorstepDistance,
      couponCode,
      customAddress,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    // ✅ Normalize incoming date/time to a real UTC instant before it ever
    // touches the DB. The `reservations` table stores naive DATETIME
    // columns that are treated as UTC wall-clock (see config/db.js
    // `timezone: 'Z'`); this is the single boundary where any client's
    // date string gets converted to that canonical representation.
    const startDateUtc = new Date(startDate);
    const endDateUtc = new Date(endDate);
    if (isNaN(startDateUtc.getTime()) || isNaN(endDateUtc.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid startDate or endDate",
      });
    }

    // ✅ Verify Razorpay signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET) // ⚠️ Replace with process.env.RAZORPAY_KEY_SECRET
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Payment verification failed" });
    }

    // ✅ Get car owner (host)
    const [carRows] = await db.query("SELECT userId, title FROM cars WHERE id = ?", [carId]);
    if (carRows.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const hostId = carRows[0].userId;
    const carTitle = carRows[0].title;

    // ✅ Create booking
    const bookingId = uuidv4();
    await db.query(
      `INSERT INTO reservations 
        (id, userId, carId, startDate, endDate, amount, totalHours, 
         userLocation, userLat, userLong, doorstepAmount, doorstepDistance, 
         couponCode, customAddress, status, paymentId, orderId, 
         settlementStatus, hostId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, 'PENDING', ?, NOW(), NOW())`,
      [
        bookingId,
        userId,
        carId,
        startDateUtc,
        endDateUtc,
        amount,
        totalHours,
        userLocation,
        userLat,
        userLong,
        doorstepAmount,
        doorstepDistance,
        couponCode,
        customAddress,
        razorpay_payment_id,
        razorpay_order_id,
        hostId,
      ]
    );

    // ✅ Notify the host (never fails the booking if the push fails)
    sendPushToUser(hostId, {
      title: "🚗 New Booking Received!",
      body: `Your car "${carTitle}" has been booked. Open the app to see the booking details.`,
      data: { type: "NEW_BOOKING", reservationId: bookingId, carId },
    });

    return res.json({
      success: true,
      message: "Payment verified, booking confirmed, notification sent",
      bookingId,
    });
  } catch (err) {
    console.error("Error verifying booking payment:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};




// Which reservation statuses belong to each of the mobile app's two tabs.
const BOOKING_TAB_STATUSES = {
  upcoming: ["PENDING", "CONFIRMED", "CANCELLED", "START"],
  completed: ["COMPLETED"],
};

const getUserBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 10 });
    const tab = (req.query.tab || "upcoming").toLowerCase();
    const statuses = BOOKING_TAB_STATUSES[tab] || BOOKING_TAB_STATUSES.upcoming;
    const statusPlaceholders = statuses.map(() => "?").join(",");

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM reservations r WHERE r.userId = ? AND r.status IN (${statusPlaceholders})`,
      [userId, ...statuses]
    );
    const total = countRows[0].total;

    // Fetch this page of the user's bookings (for the requested tab) along
    // with car + host details.
    const [bookings] = await db.query(
      `SELECT
          r.*,
          c.title AS carTitle,
          c.pricePerHour,
          c.city,
          c.fuelType,
          c.transmissionType,
          c.seats,
          c.doors,
          c.luggageCapacity,
          c.userId AS hostId,
          u.name AS hostName,
          u.phoneNumber AS hostPhone
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users u ON c.userId = u.id
       WHERE r.userId = ? AND r.status IN (${statusPlaceholders})
       ORDER BY r.startDate DESC
       LIMIT ? OFFSET ?`,
      [userId, ...statuses, limit, offset]
    );

    // Helper to enrich bookings with images, features, and ratings — now
    // only runs across this page's rows rather than every booking the
    // user has ever made.
    const enrichBookings = async (bookings) => {
      for (const r of bookings) {
        // Car images
        const [images] = await db.execute(
          "SELECT imagePath FROM car_images WHERE carId = ?",
          [r.carId]
        );
        r.images = images.map((i) => i.imagePath);

        // Car features
        const [features] = await db.execute(
          "SELECT feature FROM car_features WHERE carId = ?",
          [r.carId]
        );
        r.features = features.map((f) => f.feature);

        // Average rating and review count
        const [ratingResult] = await db.execute(
          "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
          [r.carId]
        );
        r.avgRating = ratingResult[0].avgRating
          ? parseFloat(Number(ratingResult[0].avgRating).toFixed(1))
          : 0;
        r.totalReviews = ratingResult[0].totalReviews;
      }
      return bookings;
    };

    const enrichedBookings = await enrichBookings(bookings);

    res.status(200).json({
      success: true,
      data: enrichedBookings,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Error fetching user bookings:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};



// repire
// *
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params; // booking ID
    const userId = req.user.id; // from token middleware

    // 1️⃣ Fetch booking details + car + host + user info (+ profilePic & new fields)
    const [rows] = await db.execute(
      `SELECT 
          r.*, 
          c.title AS carTitle, 
          c.pricePerHour, 
          c.securityDeposit, 
          c.city, 
          c.fuelType, 
          c.transmissionType,
          c.seats, 
          c.doors, 
          c.luggageCapacity, 
          c.userId AS hostId, 
          
          -- HOST DETAILS
          h.name AS hostName, 
          h.phoneNumber AS hostPhone,
          h.email AS hostEmail,
          h.profilePic AS hostProfilePic,
          h.drivingLicenseImg AS hostDlFront,
          h.drivingLicenseBackImg AS hostDlBack,
          h.idProofImg AS hostIdFront,
          h.idProofBackImg AS hostIdBack,

          -- USER DETAILS
          u.name AS userName,
          u.phoneNumber AS userPhone,
          u.email AS userEmail,
          u.profilePic AS userProfilePic,
          u.drivingLicenseImg AS userDlFront,
          u.drivingLicenseBackImg AS userDlBack,
          u.idProofImg AS userIdFront,
          u.idProofBackImg AS userIdBack,
          u.isVerified AS customerVerified

       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users h ON c.userId = h.id   -- host
       JOIN users u ON r.userId = u.id   -- user
       WHERE r.id = ? AND (r.userId = ? OR c.userId = ?)`,
      [id, userId, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const booking = rows[0];

    // 2️⃣ Car images
    const [images] = await db.execute(
      "SELECT imagePath FROM car_images WHERE carId = ?",
      [booking.carId]
    );
    booking.images = images.map((i) => i.imagePath);

    // 3️⃣ Car features
    const [features] = await db.execute(
      "SELECT feature FROM car_features WHERE carId = ?",
      [booking.carId]
    );
    booking.features = features.map((f) => f.feature);

    // 4️⃣ Car rating
    const [ratingResult] = await db.execute(
      "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
      [booking.carId]
    );
    booking.avgRating = ratingResult[0].avgRating
      ? parseFloat(Number(ratingResult[0].avgRating).toFixed(1))
      : 0;
    booking.totalReviews = ratingResult[0].totalReviews;

    // 5️⃣ Pickup & Drop photos
    const [photos] = await db.execute(
      "SELECT photoUrl, photoType FROM reservation_photos WHERE reservationId = ?",
      [booking.id]
    );

    booking.pickupPhotos = photos
      .filter((p) => p.photoType === "PICKUP")
      .map((p) => p.photoUrl);

    booking.dropPhotos = photos
      .filter((p) => p.photoType === "DROP")
      .map((p) => p.photoUrl);

    // 6️⃣ Ensure security deposit included
    booking.securityDeposit = booking.securityDeposit || 0;

    // 7️⃣ KYC privacy: until the customer is verified, the customer doesn't
    // see the host's details and the host doesn't see the customer's.
    const viewerIsHost = String(booking.hostId) === String(userId) && String(booking.userId) !== String(userId);
    booking.viewerRole = viewerIsHost ? "host" : "customer";
    booking.customerVerified = Number(booking.customerVerified) === 1;
    const [refunds] = await db.query(
      "SELECT status, reason, adminNote, createdAt, processedAt FROM refund_requests WHERE reservationId = ? LIMIT 1",
      [id]
    );
    booking.refundRequest = refunds[0] || null;
    if (!booking.customerVerified) {
      const hide = viewerIsHost
        ? ["userName", "userPhone", "userEmail", "userProfilePic", "userDlFront", "userDlBack", "userIdFront", "userIdBack", "userLocation", "customAddress", "userLat", "userLong"]
        : ["hostName", "hostPhone", "hostEmail", "hostProfilePic", "hostDlFront", "hostDlBack", "hostIdFront", "hostIdBack"];
      hide.forEach((k) => { booking[k] = null; });
      booking[viewerIsHost ? "customerDetailsHidden" : "hostDetailsHidden"] = true;
    }

    res.status(200).json({ success: true, booking });
  } catch (err) {
    console.error("getBookingById error:", err);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });
  }
};




const cancelBooking = async (req, res) => {
  try {
    const { reservationId } = req.params; // booking id passed in URL
    const userId = req.user ? req.user.id : null; // if you use auth

    if (!reservationId) {
      return res.status(400).json({ success: false, message: "Reservation ID is required" });
    }

    // Optional: ensure only the user who booked can cancel
    const [reservations] = await db.execute(
      "SELECT * FROM reservations WHERE id = ?",
      [reservationId]
    );

    if (reservations.length === 0) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }

    const reservation = reservations[0];

    // If using auth, verify user
    if (userId && reservation.userId !== userId) {
      return res.status(403).json({ success: false, message: "You cannot cancel this reservation" });
    }

    // Check if already completed or cancelled
    if (reservation.status === "CANCELLED" || reservation.status === "COMPLETED") {
      return res.status(400).json({ success: false, message: `Cannot cancel a ${reservation.status} reservation` });
    }

    // Update reservation status
    await db.execute(
      "UPDATE reservations SET status = 'CANCELLED', updatedAt = NOW() WHERE id = ?",
      [reservationId]
    );

    res.status(200).json({ success: true, message: "Booking cancelled successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};





// host  api self book



// ===============================
// SELF BOOK CAR API
// ===============================
const selfBookCar = async (req, res) => {
  try {
    // ✅ Logged in owner ID
    const userId = req.user.id;

    // ✅ Request body
    const {
      carId,
      startDate,
      endDate,
      bookingStartDateTime,
      bookingEndDateTime,
    } = req.body;

    // ===============================
    // VALIDATION
    // ===============================
    if (!carId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "carId, startDate and endDate are required",
      });
    }

    // Normalize to a real UTC instant — same boundary/reasoning as
    // verifyBookingPayment above.
    const startDateUtc = new Date(startDate);
    const endDateUtc = new Date(endDate);
    if (isNaN(startDateUtc.getTime()) || isNaN(endDateUtc.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid startDate or endDate",
      });
    }
    const bookingStartUtc = bookingStartDateTime ? new Date(bookingStartDateTime) : startDateUtc;
    const bookingEndUtc = bookingEndDateTime ? new Date(bookingEndDateTime) : endDateUtc;
    if (isNaN(bookingStartUtc.getTime()) || isNaN(bookingEndUtc.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid bookingStartDateTime or bookingEndDateTime",
      });
    }

    // ===============================
    // CHECK CAR EXISTS
    // ===============================
    const [carRows] = await db.query(
      `
      SELECT id, userId, title
      FROM cars
      WHERE id = ?
      LIMIT 1
      `,
      [carId]
    );

    if (carRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    const car = carRows[0];

    // ===============================
    // ONLY OWNER CAN SELF BOOK
    // ===============================
    if (car.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "You can self-book only your own car",
      });
    }

    // ===============================
    // CHECK DATE/TIME OVERLAP
    // ===============================
    const [existingBookings] = await db.query(
      `
      SELECT id, status
      FROM reservations
      WHERE carId = ?
      AND status IN (
        'PENDING',
        'CONFIRMED',
        'START',
        'SELFBOOK'
      )
      AND (
        (? BETWEEN startDate AND endDate)
        OR
        (? BETWEEN startDate AND endDate)
        OR
        (startDate BETWEEN ? AND ?)
      )
      `,
      [
        carId,
        startDateUtc,
        endDateUtc,
        startDateUtc,
        endDateUtc,
      ]
    );

    // ===============================
    // IF ALREADY BOOKED
    // ===============================
    if (existingBookings.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Car already booked/self-booked for selected dates",
      });
    }

    // ===============================
    // CREATE BOOKING ID
    // ===============================
    const bookingId = uuidv4();

    // ===============================
    // INSERT SELF BOOKING
    // ===============================
    await db.query(
      `
      INSERT INTO reservations (
        id,
        userId,
        carId,
        startDate,
        endDate,
        bookingStartDateTime,
        bookingEndDateTime,
        amount,
        totalHours,
        status,
        settlementStatus,
        hostId,
        createdAt,
        updatedAt
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
      )
      `,
      [
        bookingId,
        userId,
        carId,
        startDateUtc,
        endDateUtc,
        bookingStartUtc,
        bookingEndUtc,
        0,
        0,
        "SELFBOOK",
        "PENDING",
        userId,
      ]
    );

    // ===============================
    // SUCCESS RESPONSE
    // ===============================
    return res.status(200).json({
      success: true,
      message: "Car self-booked successfully",
      bookingId,
    });

  } catch (err) {
    console.error("Self booking error:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
};





// =====================================================
// SELF BOOKING MANAGEMENT (host): list / change dates / remove
// Only the car owner, and only reservations with status SELFBOOK.
// =====================================================

// Loads a SELFBOOK reservation owned by the logged-in host, or sends the
// error response and returns null.
const findOwnSelfBooking = async (id, userId, res) => {
  const [rows] = await db.query(
    `SELECT r.id, r.carId, r.startDate, r.endDate, c.userId AS ownerId
       FROM reservations r JOIN cars c ON c.id = r.carId
      WHERE r.id = ? AND r.status = 'SELFBOOK' LIMIT 1`,
    [id]
  );
  if (rows.length === 0) {
    res.status(404).json({ success: false, message: "Self booking not found" });
    return null;
  }
  if (rows[0].ownerId !== userId) {
    res.status(403).json({ success: false, message: "You can manage self bookings only for your own car" });
    return null;
  }
  return rows[0];
};

// GET /api/booking/self-bookings/:carId — active (not yet ended) self bookings
const getCarSelfBookings = async (req, res) => {
  try {
    const { carId } = req.params;
    const [cars] = await db.query("SELECT userId FROM cars WHERE id = ? LIMIT 1", [carId]);
    if (cars.length === 0) return res.status(404).json({ success: false, message: "Car not found" });
    if (cars[0].userId !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can view self bookings only for your own car" });
    }
    const [rows] = await db.query(
      `SELECT id, startDate, endDate FROM reservations
        WHERE carId = ? AND status = 'SELFBOOK' AND endDate >= NOW()
        ORDER BY startDate ASC`,
      [carId]
    );
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Get self bookings error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

// PUT /api/booking/self-book/:id  { startDate, endDate } — change dates/times
const updateSelfBooking = async (req, res) => {
  try {
    const booking = await findOwnSelfBooking(req.params.id, req.user.id, res);
    if (!booking) return;

    const startDateUtc = new Date(req.body.startDate);
    const endDateUtc = new Date(req.body.endDate);
    if (isNaN(startDateUtc.getTime()) || isNaN(endDateUtc.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid startDate or endDate" });
    }
    if (endDateUtc <= startDateUtc) {
      return res.status(400).json({ success: false, message: "End date must be after the start date" });
    }
    if (endDateUtc <= new Date()) {
      return res.status(400).json({ success: false, message: "End date must be in the future" });
    }

    // Same overlap rule as selfBookCar, ignoring this booking itself.
    const [conflicts] = await db.query(
      `SELECT id FROM reservations
        WHERE carId = ? AND id <> ?
          AND status IN ('PENDING','CONFIRMED','START','SELFBOOK')
          AND ((? BETWEEN startDate AND endDate)
            OR (? BETWEEN startDate AND endDate)
            OR (startDate BETWEEN ? AND ?))`,
      [booking.carId, booking.id, startDateUtc, endDateUtc, startDateUtc, endDateUtc]
    );
    if (conflicts.length > 0) {
      return res.status(400).json({ success: false, message: "Car already booked/self-booked for selected dates" });
    }

    await db.query(
      `UPDATE reservations
          SET startDate = ?, endDate = ?, bookingStartDateTime = ?, bookingEndDateTime = ?, updatedAt = NOW()
        WHERE id = ?`,
      [startDateUtc, endDateUtc, startDateUtc, endDateUtc, booking.id]
    );
    return res.json({ success: true, message: "Self booking updated successfully" });
  } catch (err) {
    console.error("Update self booking error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};

// DELETE /api/booking/self-book/:id — remove the block, car is free again.
// (Deleted rather than CANCELLED: CANCELLED rows show up in the owner's own
// Trips list, and a self booking is only a date block with no payment.)
const deleteSelfBooking = async (req, res) => {
  try {
    const booking = await findOwnSelfBooking(req.params.id, req.user.id, res);
    if (!booking) return;
    await db.query("DELETE FROM reservations WHERE id = ? AND status = 'SELFBOOK'", [booking.id]);
    return res.json({ success: true, message: "Self booking removed. The car is available again." });
  } catch (err) {
    console.error("Delete self booking error:", err);
    return res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  }
};


// POST /api/booking/refund-request/:id — an unverified customer who doesn't
// want to complete KYC cancels the booking and asks for a refund. The admin
// processes the refund from the admin panel (Refunds page).
const requestRefund = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const reason = String(req.body?.reason || "Customer did not want to complete KYC").slice(0, 500);

    const [[user]] = await connection.query("SELECT isVerified FROM users WHERE id = ?", [userId]);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (Number(user.isVerified) === 1) {
      return res.status(400).json({ success: false, message: "Your account is verified — refund without KYC is only for unverified accounts." });
    }

    const [[booking]] = await connection.query(
      `SELECT r.id, r.status, r.amount, r.paymentId, r.hostId, c.title AS carTitle
         FROM reservations r JOIN cars c ON c.id = r.carId
        WHERE r.id = ? AND r.userId = ?`,
      [id, userId]
    );
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });
    if (!["CONFIRMED", "PENDING"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: "A refund can only be requested before the trip starts." });
    }

    const [existing] = await connection.query("SELECT status FROM refund_requests WHERE reservationId = ?", [id]);
    if (existing.length) {
      return res.status(400).json({ success: false, message: `A refund request already exists (${existing[0].status}).` });
    }

    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO refund_requests (id, reservationId, userId, amount, paymentId, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`,
      [uuidv4(), id, userId, booking.amount || 0, booking.paymentId || null, reason]
    );
    // Cancel the booking so the car is free again for other customers.
    await connection.query("UPDATE reservations SET status = 'CANCELLED', updatedAt = NOW() WHERE id = ?", [id]);
    await connection.commit();

    res.json({ success: true, message: "Refund requested. Your booking has been cancelled and the amount will be refunded after review." });

    sendPushToUser(booking.hostId, {
      title: "❌ Booking Cancelled",
      body: `The booking for "${booking.carTitle}" was cancelled by the customer.`,
      data: { type: "BOOKING_CANCELLED", reservationId: id },
    });
  } catch (err) {
    try { await connection.rollback(); } catch { /* not in a transaction */ }
    console.error("requestRefund error:", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: "Internal server error", error: err.message });
  } finally {
    connection.release();
  }
};

module.exports = { createBookingOrder, verifyBookingPayment, getUserBookings,cancelBooking,getBookingById,selfBookCar, getCarSelfBookings, updateSelfBooking, deleteSelfBooking, requestRefund };


