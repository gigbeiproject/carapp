const express = require("express");
const { protect } = require("../../middleware/auth");
// const upload = require("../middleware/upload");
const { getCarsByUser } = require("../../controllers/Host/HostCarController");

const router = express.Router(); // ✅ this line is missing
// get car by host
router.get("/my-cars", protect, getCarsByUser);

module.exports = router;
