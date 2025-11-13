const express = require("express");
const db = require("../config/db"); // ✅ your MySQL connection file
const axios = require("axios");
const { protect } = require("../middleware/auth");


const router = express.Router();

/**
 * 1️⃣ Register device token
 */
router.post("/register-device", protect, async (req, res) => {
  const { expoPushToken } = req.body;
  const userId = req.user.id; // ✅ Extracted from protect middleware

  if (!expoPushToken || !expoPushToken.startsWith("ExponentPushToken")) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Expo push token" });
  }

  try {
    // ✅ Create table if not exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS user_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId INT NOT NULL,
        expoPushToken VARCHAR(255) UNIQUE NOT NULL
      )
    `);

    // ✅ Upsert token
    await db.execute(
      `
      INSERT INTO user_tokens (userId, expoPushToken)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE expoPushToken = VALUES(expoPushToken)
    `,
      [userId, expoPushToken]
    );

    res.json({ success: true, message: "Token registered successfully" });
  } catch (err) {
    console.error("❌ Token registration error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

/**
 * 2️⃣ Send notification to single device
 */
router.post("/send-notification", async (req, res) => {
  const { to, title, body } = req.body;

  if (!to || !to.startsWith("ExponentPushToken")) {
    return res.status(400).json({ error: "Invalid Expo push token" });
  }

  try {
    const response = await axios.post(
      "https://exp.host/--/api/v2/push/send",
      [
        {
          to,
          sound: "default",
          title,
          body,
        },
      ],
      {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
      }
    );

    res.json({ success: true, data: response.data });
  } catch (error) {
    console.error("❌ Notification error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 3️⃣ Send notification to all users (optional)
 */
router.post("/send-notification-to-all", async (req, res) => {
  const { title, body } = req.body;

  try {
    const [tokens] = await db.execute("SELECT expoPushToken FROM user_tokens");

    if (!tokens.length)
      return res.status(404).json({ message: "No registered devices" });

    // Send in batches of 100 (Expo rate limit)
    const batches = [];
    for (let i = 0; i < tokens.length; i += 100) {
      batches.push(tokens.slice(i, i + 100));
    }

    for (const batch of batches) {
      const messages = batch.map((t) => ({
        to: t.expoPushToken,
        sound: "default",
        title,
        body,
      }));

      await axios.post("https://exp.host/--/api/v2/push/send", messages, {
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
      });
    }

    res.json({ success: true, message: "Notifications sent to all users" });
  } catch (err) {
    console.error("❌ Error sending to all:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
