const express = require("express");
const router = express.Router();
const userController = require("../../controllers/admin/userController");
const tokencheck = require("../../controllers/admin/tokencheck");
const {adminOnly } = require("../../middleware/authMiddlewareAdmin");
const { protect } = require("../../middleware/auth");


// ✅ Get all users (admin only)
router.get("/all", protect, adminOnly, userController.getAllUsers);
router.post("/admin/login", userController.adminLogin);
router.get("/session/validate", tokencheck.verifySession);


router.put("/:id/verify", protect, adminOnly, userController.updateUserVerification);
router.put("/:id/status", protect, adminOnly, userController.updateUserPermStatus);


// booking 

router.get("/booking/all", protect, adminOnly, userController.getAllReservations);

router.get("/car/permit", protect, adminOnly, userController.getAllCars);


router.put("/:id/approval", protect, adminOnly, userController.updateCarApprovalStatus);


router.get("/transactions/completed", protect, adminOnly, userController.getCompletedReservations);

// ✅ PUT - Update settlementStatus (Admin Only)
router.put("/:id/settlement-status", protect, adminOnly, userController.updateSettlementStatus);


module.exports = router;


