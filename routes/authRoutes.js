const express = require("express");
const router = express.Router();

const upload = require('../middleware/upload'); // multer setup
const { protect } = require("../middleware/auth");
const authController = require("../controllers/authController");

// Auth Routes
router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.get("/profile", protect, authController.getProfile);

// ✅ Update profile with optional profile image
router.put(
  "/profile/update",
  protect,
  upload.single("profileImage"), // multer middleware
  authController.updateProfile
);

router.delete("/delete-account", protect, authController.deleteAccount);

router.delete("/device-token", protect, authController.deleteDeviceToken);



module.exports = router;
