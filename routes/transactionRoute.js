const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { getHostCompletedReservations } = require("../controllers/transactionController");

router.get("/host/completed", protect, getHostCompletedReservations);

module.exports = router;
