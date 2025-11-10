exports.protect = (req, res, next) => {
  // assume JWT verification already adds req.user
  if (!req.user) {
    return res.status(401).json({ success: false, message: "Not authorized" });
  }
  next();
};

exports.adminOnly = (req, res, next) => {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({ success: false, message: "Admin access only" });
  }
  next();
};
