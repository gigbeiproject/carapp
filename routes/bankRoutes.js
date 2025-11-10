const express = require("express");
const router = express.Router();
const { addBankAccount, getMyBankAccount,updateBankAccount } = require("../controllers/bankController");
const { protect } = require("../middleware/auth");

// Add or update bank account
router.post("/add", protect, addBankAccount);

// Get logged-in user bank account
router.get("/my", protect, getMyBankAccount);

router.put("/update", protect, updateBankAccount);

module.exports = router;
