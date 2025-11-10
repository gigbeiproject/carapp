const db = require("../config/db");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const twilio = require("twilio");

require("dotenv").config({ path: "../.env" }); // if .env is in parent folder


// Twilio client setup
console.log("SID:", process.env.TWILIO_ACCOUNT_SID);
console.log("TOKEN:", process.env.TWILIO_AUTH_TOKEN);
console.log("PHONE:", process.env.TWILIO_PHONE_NUMBER);

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);


// Generate 4-digit OTP
const generateOTP = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

/**
 * Send OTP Controller
 */
exports.sendOtp = async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  try {
    const otp = generateOTP();

    // ✅ Send OTP via Twilio SMS
    await client.messages.create({
      body: `Your verification code is ${otp}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber.startsWith("+") ? phoneNumber : `+91${phoneNumber}`, // auto add +91 if missing
    });

    // ✅ Store OTP in DB
    await db.execute(
      `INSERT INTO otps (phoneNumber, otp, expiresAt) 
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 5 MINUTE))
       ON DUPLICATE KEY UPDATE otp = VALUES(otp), expiresAt = VALUES(expiresAt)`,
      [phoneNumber, otp]
    );

    res.json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};


exports.verifyOtp = async (req, res) => {
  const { phoneNumber, otp } = req.body;

  if (!phoneNumber || !otp) {
    return res.status(400).json({ error: "Phone number and OTP are required" });
  }

  try {
    const [rows] = await db.execute(
      "SELECT * FROM otps WHERE phoneNumber = ? AND otp = ? AND expiresAt > NOW()",
      [phoneNumber, otp]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    // Check if user already exists
    const [userRows] = await db.execute(
      "SELECT * FROM users WHERE phoneNumber = ?",
      [phoneNumber]
    );

    let user;
    if (userRows.length === 0) {
      // New user → register
      const id = uuidv4();
      await db.execute(
        "INSERT INTO users (id, phoneNumber, isVerified, role) VALUES (?, ?, ?, ?)",
        [id, phoneNumber, 1, "USER"]
      );
      user = { id, phoneNumber, role: "USER" };
    } else {
      user = userRows[0];
    }

    // Generate JWT
    console.log("JWT_SECRET check:", process.env.JWT_SECRET);

    const token = jwt.sign(
      { id: user.id, phoneNumber: user.phoneNumber, role: user.role },
      "mySuperSecretKey123",   // <-- direct secret key here
      { expiresIn: "7d" }
    );


    res.json({
      success: true,
      message: userRows.length === 0 ? "User registered" : "User logged in",
      token,
      user,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: "Server error" });
  }
};



exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id; // from vehrifyToken middleware

    // 1️⃣ Fetch basic user info
    const [rows] = await db.execute(
      "SELECT id, phoneNumber, role,name,email,dob,  isVerified FROM users WHERE id = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const user = rows[0];

    // 2️⃣ Check if user has added any car
    const [cars] = await db.execute(
      "SELECT id FROM cars WHERE userId = ? LIMIT 1",
      [userId]
    );

    user.isHost = cars.length > 0; // true if user has any car, false otherwise

    res.json({ success: true, user });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id; // ✅ Get user ID from token
    const { name, email, phoneNumber, profileImage } = req.body;

    // ✅ Validate input
    if (!name && !email && !phoneNumber && !profileImage) {
      return res.status(400).json({
        success: false,
        message: "No update fields provided",
      });
    }

    // ✅ Build dynamic update query
    const fields = [];
    const values = [];

    if (name) {
      fields.push("name = ?");
      values.push(name);
    }
    if (email) {
      fields.push("email = ?");
      values.push(email);
    }
    if (phoneNumber) {
      fields.push("phoneNumber = ?");
      values.push(phoneNumber);
    }
    if (profileImage) {
      fields.push("profileImage = ?");
      values.push(profileImage);
    }

    values.push(userId); // for WHERE clause

    const sql = `UPDATE users SET ${fields.join(", ")} WHERE id = ?`;

    await db.execute(sql, values);

    // ✅ Fetch updated user data
    const [updatedUser] = await db.execute(
      "SELECT id, name, email, phoneNumber, role, isVerified, profileImage FROM users WHERE id = ?",
      [userId]
    );

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: updatedUser[0],
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};


exports.deleteAccount = async (req, res) => {
  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const userId = req.user.id; // from JWT middleware

    // 1️⃣ Check for active bookings (CONFIRMED or START)
    const [activeBookings] = await connection.execute(
      `SELECT COUNT(*) AS count FROM reservations 
       WHERE userId = ? AND status IN ('CONFIRMED', 'START')`,
      [userId]
    );

    if (activeBookings[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your account while you have active bookings.",
      });
    }

    // 2️⃣ Delete related data (optional cleanup)
    await connection.execute("DELETE FROM reservations WHERE userId = ?", [userId]);
    await connection.execute("DELETE FROM car_reviews WHERE userId = ?", [userId]);
    await connection.execute("DELETE FROM car_favorites WHERE userId = ?", [userId]);
    await connection.execute("DELETE FROM cars WHERE userId = ?", [userId]);

    // 3️⃣ Delete user account
    await connection.execute("DELETE FROM users WHERE id = ?", [userId]);

    await connection.commit();
    res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    await connection.rollback();
    console.error("Error deleting account:", err);
    res.status(500).json({
      success: false,
      message: "Error deleting account",
      error: err.message,
    });
  } finally {
    connection.release();
  }
};
