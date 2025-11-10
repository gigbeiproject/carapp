const jwt = require("jsonwebtoken");

const JWT_SECRET = "mySuperSecretKey123"; // use process.env.JWT_SECRET in production

exports.protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    console.log("Decoded token:", decoded); // 👈 Check what fields exist (should include id)

    req.user = decoded; // must contain id
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
