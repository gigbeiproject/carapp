const { v4: uuidv4 } = require("uuid");
const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const db = require("../config/db"); // ✅ Add this
const axios = require("axios");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination");

const createBookingOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { carId, startDate, endDate, amount, totalHours } = req.body;

    if (!carId || !startDate || !endDate || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
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

    // 👉 STEP 2: If user is NOT verified, check booking limits
    if (isVerified === 0) {
      // Check if user has any previous bookings
      const [bookingRows] = await db.query(
        "SELECT status FROM reservations WHERE userId = ? ORDER BY createdAt DESC LIMIT 1",
        [userId]
      );

      if (bookingRows.length > 0) {
        const lastStatus = bookingRows[0].status;

        // ❌ User has previous booking and it's NOT PENDING → BLOCK
        if (lastStatus !== "PENDING") {
          return res.status(404).json({
            success: false,
            message:
              "Your account is not verified. You can book only one time. Please verify your account to continue."
          });
        }

        // ⚠️ User has old booking but status is PENDING → ALLOW only this time
      }
      // ✔ If no old booking → allow first time
    }

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
    });

  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    return res.status(500).json({ message: "Internal server error" });
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

    // ✅ Fetch host Expo token
    const [tokenRows] = await db.query(
      "SELECT expoPushToken FROM user_tokens WHERE userId = ?",
      [hostId]
    );

    if (tokenRows.length > 0) {
      const expoPushToken = tokenRows[0].expoPushToken;

      // ✅ Send notification to host
      const message = {
        to: expoPushToken,
        sound: "default",
        title: "🚗 New Booking Received!",
        body: `Your car "${carTitle}" has been booked successfully.`,
      };

      await axios.post("https://exp.host/--/api/v2/push/send", message, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
      });

      console.log(`✅ Push notification sent to host (${hostId})`);
    } else {
      console.log(`⚠️ No Expo token found for hostId: ${hostId}`);
    }

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
          ? parseFloat(ratingResult[0].avgRating.toFixed(1))
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
          u.idProofBackImg AS userIdBack

       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users h ON c.userId = h.id   -- host
       JOIN users u ON r.userId = u.id   -- user
       WHERE r.id = ? AND r.userId = ?`,
      [id, userId]
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
      ? parseFloat(ratingResult[0].avgRating.toFixed(1))
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




module.exports = { createBookingOrder, verifyBookingPayment, getUserBookings,cancelBooking,getBookingById,selfBookCar };


