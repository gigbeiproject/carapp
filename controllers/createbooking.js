const { v4: uuidv4 } = require("uuid");
const razorpay = require("../config/razorpay");
const crypto = require("crypto");
const db = require("../config/db"); // ✅ Add this

const createBookingOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { carId, startDate, endDate, amount, totalHours } = req.body;

    if (!carId || !startDate || !endDate || !amount) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // ✅ Create Razorpay Order
    const options = {
      amount: Math.round(amount * 100), // amount in paise
      currency: "INR",
      receipt: uuidv4(),
      payment_capture: 1,
    };

    const order = await razorpay.orders.create(options);

    // You can temporarily save this order with status PENDING
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

    // ✅ Verify Razorpay signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", "TwDaASCKy0D6jAYWpS9L1SkF") // use process.env.RAZORPAY_KEY_SECRET in production
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    // ✅ Get car's owner (hostId)
    const [carRows] = await db.query("SELECT userId FROM cars WHERE id = ?", [carId]);
    if (carRows.length === 0) {
      return res.status(404).json({ success: false, message: "Car not found" });
    }

    const hostId = carRows[0].userId;

    // ✅ Create booking with hostId & settlementStatus
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
        razorpay_payment_id,
        razorpay_order_id,
        hostId,
      ]
    );

    return res.json({
      success: true,
      message: "Payment verified & booking confirmed",
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



const getUserBookings = async (req, res) => {
  try {
    const userId = req.user.id;

    // 1️⃣ Upcoming bookings
    const [upcoming] = await db.execute(
      `SELECT r.*, c.title AS carTitle, c.pricePerHour, c.city, c.fuelType, c.transmissionType,
              c.seats, c.doors, c.luggageCapacity, c.userId AS hostId, u.name AS hostName, u.phoneNumber AS hostPhone
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users u ON c.userId = u.id
       WHERE r.userId = ? AND r.status IN ('PENDING','CONFIRMED') AND r.endDate >= NOW()
       ORDER BY r.startDate ASC`,
      [userId]
    );

    // 2️⃣ Completed bookings
    const [completed] = await db.execute(
      `SELECT r.*, c.title AS carTitle, c.pricePerHour, c.city, c.fuelType, c.transmissionType,
              c.seats, c.doors, c.luggageCapacity, c.userId AS hostId, u.name AS hostName, u.phoneNumber AS hostPhone
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users u ON c.userId = u.id
       WHERE r.userId = ? AND (r.status = 'COMPLETED' OR r.endDate < NOW())
       ORDER BY r.endDate DESC`,
      [userId]
    );

    // Function to enrich bookings with images, features, ratings
    const enrichBookings = async (bookings) => {
      for (const r of bookings) {
        // Images
        const [images] = await db.execute("SELECT imagePath FROM car_images WHERE carId = ?", [r.carId]);
        r.images = images.map((i) => i.imagePath);

        // Features
        const [features] = await db.execute("SELECT feature FROM car_features WHERE carId = ?", [r.carId]);
        r.features = features.map((f) => f.feature);

        // Ratings
        const [ratingResult] = await db.execute(
          "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
          [r.carId]
        );
        r.avgRating = ratingResult[0].avgRating ? parseFloat(ratingResult[0].avgRating.toFixed(1)) : 0;
        r.totalReviews = ratingResult[0].totalReviews;
      }
      return bookings;
    };

    const enrichedUpcoming = await enrichBookings(upcoming);
    const enrichedCompleted = await enrichBookings(completed);

    res.status(200).json({
      success: true,
      upcoming: enrichedUpcoming,
      completed: enrichedCompleted
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
};


// *
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params; // booking ID
    const userId = req.user.id; // from token middleware

    // 1️⃣ Fetch booking details + car + host + user info (including securityDeposit)
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
          h.name AS hostName, 
          h.phoneNumber AS hostPhone,
          h.email AS hostEmail,
          u.name AS userName,
          u.phoneNumber AS userPhone,
          u.email AS userEmail
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       JOIN users h ON c.userId = h.id  -- host details
       JOIN users u ON r.userId = u.id  -- user details
       WHERE r.id = ? AND r.userId = ?`,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Booking not found" });
    }

    const booking = rows[0];

    // 2️⃣ Fetch car images
    const [images] = await db.execute(
      "SELECT imagePath FROM car_images WHERE carId = ?",
      [booking.carId]
    );
    booking.images = images.map((i) => i.imagePath);

    // 3️⃣ Fetch car features
    const [features] = await db.execute(
      "SELECT feature FROM car_features WHERE carId = ?",
      [booking.carId]
    );
    booking.features = features.map((f) => f.feature);

    // 4️⃣ Fetch average rating
    const [ratingResult] = await db.execute(
      "SELECT AVG(rating) AS avgRating, COUNT(*) AS totalReviews FROM car_reviews WHERE carId = ?",
      [booking.carId]
    );
    booking.avgRating = ratingResult[0].avgRating
      ? parseFloat(ratingResult[0].avgRating.toFixed(1))
      : 0;
    booking.totalReviews = ratingResult[0].totalReviews;

    // 5️⃣ Fetch pickup & drop photos separately
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

    // 6️⃣ Include securityDeposit clearly
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




module.exports = { createBookingOrder, verifyBookingPayment, getUserBookings,cancelBooking,getBookingById };


