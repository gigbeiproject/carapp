const express = require("express");
const router = express.Router();




const upload = require('../middleware/upload');

const { protect } = require("../middleware/auth");

const authController = require("../controllers/authController");

// Auth Routes
router.post("/send-otp", authController.sendOtp);
router.post("/verify-otp", authController.verifyOtp);
router.get("/profile", protect, authController.getProfile);
router.put("/profile/update", protect, authController.updateProfile);

router.delete("/delete-account", protect, authController.deleteAccount);


// Auth routes











module.exports = router;
