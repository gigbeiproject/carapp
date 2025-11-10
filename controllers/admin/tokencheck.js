const jwt = require("jsonwebtoken");
const db = require("../../config/db");

// JWT Secret (move to .env ideally)
const JWT_SECRET = "mySuperSecretKey123";

// ✅ Validate Session Controller
exports.verifySession = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided.",
      });
    }

    const token = authHeader.split(" ")[1];

    // ✅ Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // ✅ Check if user exists in DB
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ?", [decoded.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const user = rows[0];

    // ✅ Check if user is banned or on hold
    if (user.permStatus === "ban") {
      return res.status(403).json({ success: false, message: "Account is banned." });
    }
    if (user.permStatus === "hold") {
      return res.status(403).json({ success: false, message: "Account is on hold." });
    }

    // ✅ Token and user are valid
    return res.status(200).json({
      success: true,
      message: "Session valid.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permStatus: user.permStatus,
      },
    });
  } catch (error) {
    console.error("Session validation error:", error);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};
