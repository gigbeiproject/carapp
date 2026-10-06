const db = require("../../config/db");
const s3 = require("../../config/s3");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const { sendPushToUser } = require("../../utils/pushNotification");
// ✅ Helper: Upload file to S3
const uploadToS3 = async (fileBuffer, fileName, folder = "bookings") => {
  const params = {
    Bucket: "carapprent",
    Key: `${folder}/${Date.now()}-${uuidv4()}-${fileName}`,
    Body: fileBuffer,
  };
  return await s3.upload(params).promise(); // Returns { Location: 'https://...' }
};

// Older app versions (RN and early Flutter) appended every photo twice —
// once as "files" and once as "prePhotos"/"dropPhotos" — and upload.any()
// accepted both, so 6 photos were saved as 12. Use only one field.
const pickTripPhotos = (files, legacyField) => {
  const all = files || [];
  const main = all.filter((f) => f.fieldname === "files");
  return main.length > 0 ? main : all.filter((f) => f.fieldname === legacyField);
};

// ✅ Upload pickup photos (start booking)
const startBooking = async (req, res) => {
  try {
    const { reservationId } = req.body;

    if (!reservationId) {
      return res.status(400).json({
        success: false,
        message: "Missing reservation ID",
      });
    }

    // The customer must complete KYC before the trip can start.
    const [kycRows] = await db.query(
      `SELECT u.isVerified FROM reservations r JOIN users u ON u.id = r.userId WHERE r.id = ?`,
      [reservationId]
    );
    if (kycRows.length && Number(kycRows[0].isVerified) !== 1) {
      return res.status(400).json({
        success: false,
        message: "The customer has not completed verification yet. You can start the trip once they are verified.",
      });
    }

    const tripPhotos = pickTripPhotos(req.files, "prePhotos");
    if (tripPhotos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    // 1️⃣ Get current reservation
    const [rows] = await db.query(
      `SELECT r.status,
              r.userId,
              r.carId,
              c.title
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       WHERE r.id = ?`,
      [reservationId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Reservation not found",
      });
    }

    const reservation = rows[0];
    const currentStatus = reservation.status?.toUpperCase();

    // 2️⃣ Allow only if status is PENDING or CONFIRMED
    if (!["PENDING", "CONFIRMED"].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot start booking because current status is '${currentStatus}'.`,
      });
    }

    // 3️⃣ Upload pickup photos
    const uploadedPhotos = [];

    for (const file of tripPhotos) {
      const uploadResult = await uploadToS3(
        file.buffer,
        file.originalname,
        "pickupPhotos"
      );

      uploadedPhotos.push(uploadResult.Location);

      await db.query(
        `INSERT INTO reservation_photos
          (id, reservationId, photoUrl, photoType, createdAt)
         VALUES (?, ?, ?, 'PICKUP', NOW())`,
        [
          uuidv4(),
          reservationId,
          uploadResult.Location,
        ]
      );
    }

    // 4️⃣ Update reservation status
    await db.query(
      `UPDATE reservations
       SET status = 'START',
           bookingStartDateTime = NOW(),
           updatedAt = NOW()
       WHERE id = ?`,
      [reservationId]
    );

    // ==================================================
    // SEND NOTIFICATION TO CUSTOMER
    // ==================================================

    const customerId = reservation.userId;
    const carTitle = reservation.title;

    sendPushToUser(customerId, {
      title: "🚗 Booking Started",
      body: `Your trip in "${carTitle}" has started. Have a safe drive!`,
      data: { type: "BOOKING_STARTED", reservationId, carId: reservation.carId },
    });

    return res.json({
      success: true,
      message:
        "Pickup photos uploaded, reservation started, notification sent successfully",
      photos: uploadedPhotos,
    });

  } catch (error) {
    console.error("startBooking error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


// ✅ Upload drop photos (complete booking)
const completeBooking = async (req, res) => {
  try {
    const { reservationId } = req.body;

    // 1️⃣ Validate reservationId
    if (!reservationId) {
      return res.status(400).json({
        success: false,
        message: "Missing reservation ID",
      });
    }

    // 2️⃣ Validate files
    const tripPhotos = pickTripPhotos(req.files, "dropPhotos");
    if (tripPhotos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded",
      });
    }

    // 3️⃣ Get reservation details
    const [rows] = await db.query(
      `SELECT r.status,
              r.userId,
              r.carId,
              c.title
       FROM reservations r
       JOIN cars c ON r.carId = c.id
       WHERE r.id = ?`,
      [reservationId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Reservation not found",
      });
    }

    const reservation = rows[0];
    const currentStatus = reservation.status;

    // ✅ Only allow START status
    if (currentStatus !== "START") {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be completed because current status is '${currentStatus}'. It must be 'START'.`,
      });
    }

    // 4️⃣ Upload drop photos
    const uploadedPhotos = [];

    for (const file of tripPhotos) {
      const uploadResult = await uploadToS3(
        file.buffer,
        file.originalname,
        "dropPhotos"
      );

      uploadedPhotos.push(uploadResult.Location);

      await db.query(
        `INSERT INTO reservation_photos
          (id, reservationId, photoUrl, photoType, createdAt)
         VALUES (?, ?, ?, 'DROP', NOW())`,
        [
          uuidv4(),
          reservationId,
          uploadResult.Location,
        ]
      );
    }

    // 5️⃣ Complete booking
    await db.query(
      `UPDATE reservations
       SET status = 'COMPLETED',
           bookingEndDateTime = NOW(),
           updatedAt = NOW()
       WHERE id = ?`,
      [reservationId]
    );

    // ==================================================
    // SEND NOTIFICATION TO CUSTOMER
    // ==================================================

    const customerId = reservation.userId;
    const carTitle = reservation.title;

    sendPushToUser(customerId, {
      title: "✅ Booking Completed",
      body: `Your trip in "${carTitle}" has been completed. Thank you for riding with Carlust!`,
      data: { type: "BOOKING_COMPLETED", reservationId, carId: reservation.carId },
    });

    return res.json({
      success: true,
      message:
        "Drop photos uploaded, booking completed, notification sent successfully",
      photos: uploadedPhotos,
    });

  } catch (error) {
    console.error("completeBooking error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};



module.exports = {
  startBooking,
  completeBooking,
};
