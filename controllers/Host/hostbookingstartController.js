const db = require("../../config/db");
const s3 = require("../../config/s3");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
// ✅ Helper: Upload file to S3
const uploadToS3 = async (fileBuffer, fileName, folder = "bookings") => {
  const params = {
    Bucket: "carapprent",
    Key: `${folder}/${Date.now()}-${uuidv4()}-${fileName}`,
    Body: fileBuffer,
  };
  return await s3.upload(params).promise(); // Returns { Location: 'https://...' }
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

    if (!req.files || req.files.length === 0) {
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

    for (const file of req.files) {
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

    const [tokenRows] = await db.query(
      "SELECT expoPushToken FROM user_tokens WHERE userId = ?",
      [customerId]
    );

    if (tokenRows.length > 0 && tokenRows[0].expoPushToken) {
      const expoPushToken = tokenRows[0].expoPushToken;

      const message = {
        to: expoPushToken,
        sound: "default",
        title: "🚗 Booking Started",
        body: `Your booking for "${carTitle}" has been started by the host.`,
        data: {
          reservationId,
          carId: reservation.carId,
          type: "BOOKING_STARTED",
        },
      };

      try {
        const expoResponse = await axios.post(
          "https://exp.host/--/api/v2/push/send",
          message,
          {
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "gzip, deflate",
              "Content-Type": "application/json",
            },
          }
        );

        console.log(
          `✅ Booking start notification sent to customer (${customerId})`
        );
        console.log("Expo Response:", expoResponse.data);
      } catch (notificationError) {
        console.error(
          "Notification sending failed:",
          notificationError.response?.data || notificationError.message
        );
      }
    } else {
      console.log(
        `⚠️ No Expo token found for customerId: ${customerId}`
      );
    }

    // ==================================================
    // SUCCESS RESPONSE
    // ==================================================

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
    if (!req.files || req.files.length === 0) {
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

    for (const file of req.files) {
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

    const [tokenRows] = await db.query(
      "SELECT expoPushToken FROM user_tokens WHERE userId = ?",
      [customerId]
    );

    if (tokenRows.length > 0 && tokenRows[0].expoPushToken) {
      const expoPushToken = tokenRows[0].expoPushToken;

      const message = {
        to: expoPushToken,
        sound: "default",
        title: "✅ Booking Completed",
        body: `Your booking for "${carTitle}" has been completed successfully.`,
        data: {
          reservationId,
          carId: reservation.carId,
          type: "BOOKING_COMPLETED",
        },
      };

      try {
        const expoResponse = await axios.post(
          "https://exp.host/--/api/v2/push/send",
          message,
          {
            headers: {
              Accept: "application/json",
              "Accept-Encoding": "gzip, deflate",
              "Content-Type": "application/json",
            },
          }
        );

        console.log(
          `✅ Booking completion notification sent to customer (${customerId})`
        );
        console.log("Expo Response:", expoResponse.data);
      } catch (notificationError) {
        console.error(
          "Notification sending failed:",
          notificationError.response?.data || notificationError.message
        );
      }
    } else {
      console.log(
        `⚠️ No Expo token found for customerId: ${customerId}`
      );
    }

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
