const db = require("../../config/db");
const s3 = require("../../config/s3");
const { v4: uuidv4 } = require("uuid");

// ✅ Helper: Upload file to S3
const uploadToS3 = async (fileBuffer, fileName, folder = "bookings") => {
  const params = {
    Bucket: "florestawud-assets",
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
      return res.status(400).json({ success: false, message: "Missing reservation ID" });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    // 1️⃣ Get current reservation
    const [rows] = await db.query("SELECT status FROM reservations WHERE id = ?", [reservationId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
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

    // 3️⃣ Upload photos
    const uploadedPhotos = [];
    for (const file of req.files) {
      const uploadResult = await uploadToS3(file.buffer, file.originalname, "pickupPhotos");
      uploadedPhotos.push(uploadResult.Location);

      await db.query(
        `INSERT INTO reservation_photos (id, reservationId, photoUrl, photoType, createdAt)
         VALUES (?, ?, ?, 'PICKUP', NOW())`,
        [uuidv4(), reservationId, uploadResult.Location]
      );
    }

    // 4️⃣ Update reservation: set START + record bookingStartDateTime
    await db.query(
      `UPDATE reservations 
       SET status = 'START', 
           bookingStartDateTime = NOW(), 
           updatedAt = NOW() 
       WHERE id = ?`,
      [reservationId]
    );

    res.json({
      success: true,
      message: "Pickup photos uploaded & reservation started successfully",
      photos: uploadedPhotos,
    });
  } catch (error) {
    console.error("startBooking error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};



// ✅ Upload drop photos (complete booking)
const completeBooking = async (req, res) => {
  try {
    const { reservationId } = req.body;

    // 1️⃣ Validate reservationId
    if (!reservationId) {
      return res.status(400).json({ success: false, message: "Missing reservation ID" });
    }

    // 2️⃣ Validate files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded" });
    }

    // 3️⃣ Get reservation and check status
    const [rows] = await db.query("SELECT status FROM reservations WHERE id = ?", [reservationId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Reservation not found" });
    }

    const currentStatus = rows[0].status;

    // ✅ Only allow if reservation is in START state
    if (currentStatus !== "START") {
      return res.status(400).json({
        success: false,
        message: `Booking cannot be completed because current status is '${currentStatus}'. It must be 'START'.`,
      });
    }

    // 4️⃣ Upload drop photos to S3
    const uploadedPhotos = [];

    for (const file of req.files) {
      const uploadResult = await uploadToS3(file.buffer, file.originalname, "dropPhotos");
      uploadedPhotos.push(uploadResult.Location);

      // Save each photo record in DB
      await db.query(
        `INSERT INTO reservation_photos (id, reservationId, photoUrl, photoType, createdAt)
         VALUES (?, ?, ?, 'DROP', NOW())`,
        [uuidv4(), reservationId, uploadResult.Location]
      );
    }

    // 5️⃣ Update reservation to COMPLETED and set bookingEndDateTime
    await db.query(
      `UPDATE reservations 
       SET status = 'COMPLETED',
           bookingEndDateTime = NOW(),
           updatedAt = NOW() 
       WHERE id = ?`,
      [reservationId]
    );

    res.json({
      success: true,
      message: "Drop photos uploaded & booking marked as COMPLETED successfully",
      photos: uploadedPhotos,
    });
  } catch (error) {
    console.error("completeBooking error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};



module.exports = {
  startBooking,
  completeBooking,
};
